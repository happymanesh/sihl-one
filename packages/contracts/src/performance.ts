import { z } from 'zod';

import { idSchema } from './common';

/**
 * Sales performance rating.
 *
 * This file exists in the shape it does because of one specific failure mode.
 *
 * The obvious design — rate reps on conversion rate, then route the best leads
 * to the best-rated rep — is a feedback loop. The strong rep gets better leads,
 * converts more, rates higher, and gets better leads again; the weak rep gets
 * worse leads and sinks. Within two quarters the "rating" is measuring the
 * quality of the leads someone was handed, not how well they sell, and nobody
 * can tell the difference by looking at it.
 *
 * Three defences, all of them here rather than in a service:
 *
 *  1. **Quality adjustment.** A rep is measured against what their *own* leads
 *     should have produced, not against the raw company average. Converting 20%
 *     of cold imports beats converting 30% of hot referrals.
 *  2. **Behaviour is scored separately from outcomes.** Response time and
 *     follow-up discipline are controllable and coachable. Conversion is partly
 *     luck. Blending them into one number destroys the only part a person can
 *     act on.
 *  3. **Shrinkage.** A rep with six leads is not ranked with the same
 *     confidence as one with three hundred. Small samples are pulled toward the
 *     average until there is enough evidence to move them.
 */

// ---------------------------------------------------------------------------
// Expected conversion
// ---------------------------------------------------------------------------

/**
 * The conversion rate a lead of a given score *should* achieve.
 *
 * Deliberately a coarse monotonic curve rather than a fitted model: it is a
 * prior, and it exists to be replaced once SIHL has a few thousand resolved
 * leads to fit against. The exact numbers matter far less than the fact that a
 * score-80 lead is expected to convert several times more often than a score-20
 * one — that ratio is what removes lead quality from the rating.
 *
 * Calibrate against real outcomes after roughly one quarter; the shape should
 * hold, the levels will move.
 */
export function expectedConversionRate(leadScore: number): number {
  const score = Math.max(0, Math.min(100, leadScore));
  // 2% at score 0 rising to ~42% at score 100.
  return 0.02 + (score / 100) ** 1.5 * 0.4;
}

export interface RatedLead {
  /** Score at the time the lead was assigned, not today's score. */
  scoreAtAssignment: number;
  converted: boolean;
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

export interface BehaviourInputs {
  /** Median hours between a lead arriving and the first logged interaction. */
  medianFirstResponseHours: number | null;
  /** Share of open leads with a future follow-up date set, 0–1. */
  followUpCoverage: number;
  /** Share of open leads whose follow-up date has passed, 0–1. */
  overdueRate: number;
  /** Interactions logged per open lead over the period. */
  activitiesPerLead: number;
  /** Share of lost leads that carry a reason, 0–1. */
  lostReasonCoverage: number;
}

export interface BehaviourMetric {
  code: string;
  label: string;
  value: string;
  /** 0–100. What the rep controls, and therefore what coaching targets. */
  score: number;
  target: string;
}

const clamp = (value: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, value));

/**
 * Scores the habits a salesperson can actually change.
 *
 * Every metric here is something a rep can do differently tomorrow morning.
 * That is the test for inclusion: if a bad month of luck moves it, it belongs
 * in the outcome index instead.
 */
export function scoreBehaviour(inputs: BehaviourInputs): {
  score: number;
  metrics: BehaviourMetric[];
} {
  const metrics: BehaviourMetric[] = [];

  // First response is the single strongest controllable driver of conversion.
  const responseScore =
    inputs.medianFirstResponseHours === null
      ? 0
      : clamp(100 - (inputs.medianFirstResponseHours - 1) * 8);
  metrics.push({
    code: 'FIRST_RESPONSE',
    label: 'Speed of first contact',
    value:
      inputs.medianFirstResponseHours === null
        ? 'No leads contacted'
        : `${inputs.medianFirstResponseHours.toFixed(1)} h median`,
    score: Math.round(responseScore),
    target: 'Under 4 hours',
  });

  metrics.push({
    code: 'FOLLOW_UP_COVERAGE',
    label: 'Follow-ups scheduled',
    value: `${Math.round(inputs.followUpCoverage * 100)}% of open leads`,
    score: Math.round(clamp(inputs.followUpCoverage * 100)),
    target: 'Above 85%',
  });

  metrics.push({
    code: 'OVERDUE',
    label: 'Follow-ups kept on time',
    value: `${Math.round(inputs.overdueRate * 100)}% overdue`,
    score: Math.round(clamp(100 - inputs.overdueRate * 200)),
    target: 'Under 10% overdue',
  });

  // Diminishing returns: five interactions is not five times better than one.
  metrics.push({
    code: 'ENGAGEMENT',
    label: 'Interactions logged',
    value: `${inputs.activitiesPerLead.toFixed(1)} per lead`,
    score: Math.round(clamp(Math.log2(inputs.activitiesPerLead + 1) * 40)),
    target: '3 or more per lead',
  });

  metrics.push({
    code: 'LOST_REASONS',
    label: 'Lost reasons recorded',
    value: `${Math.round(inputs.lostReasonCoverage * 100)}%`,
    score: Math.round(clamp(inputs.lostReasonCoverage * 100)),
    target: 'Every lost lead',
  });

  const weights: Record<string, number> = {
    FIRST_RESPONSE: 0.3,
    FOLLOW_UP_COVERAGE: 0.25,
    OVERDUE: 0.25,
    ENGAGEMENT: 0.15,
    LOST_REASONS: 0.05,
  };

  const score = metrics.reduce(
    (total, metric) => total + metric.score * (weights[metric.code] ?? 0),
    0,
  );

  return { score: Math.round(score), metrics };
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

export type RatingBand = 'DEVELOPING' | 'ON_TRACK' | 'STRONG' | 'EXCEPTIONAL';
export type RatingConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RatingInput {
  leads: readonly RatedLead[];
  behaviour: BehaviourInputs;
  /** Converted value attributed in the period, for the target comparison. */
  achievedValue?: number;
  targetValue?: number | null;
}

export interface Rating {
  /**
   * Actual conversions divided by expected conversions for *these* leads,
   * shrunk toward 1.0 for small samples. 1.0 means "exactly as well as these
   * leads should have done".
   */
  outcomeIndex: number;
  behaviourScore: number;
  overall: number;
  band: RatingBand;
  confidence: RatingConfidence;
  leadsAssessed: number;
  actualConversions: number;
  expectedConversions: number;
  targetAttainment: number | null;
  behaviourMetrics: BehaviourMetric[];
  /** Plain-language explanation. A rating nobody can interrogate gets ignored. */
  explanation: string[];
}

/**
 * Pseudo-count for shrinkage.
 *
 * Interpretable as "assume this many leads' worth of average performance before
 * believing what the data says". Twelve is deliberately conservative: it takes
 * roughly a full quarter of a working pipeline before a rep can rank at an
 * extreme, which is the right level of scepticism for a number that will drive
 * lead allocation and be read as a judgement of someone's work.
 */
export const SHRINKAGE_PSEUDO_LEADS = 12;

export function computeRating(input: RatingInput): Rating {
  const leadsAssessed = input.leads.length;
  const actualConversions = input.leads.filter((lead) => lead.converted).length;
  const expectedConversions = input.leads.reduce(
    (total, lead) => total + expectedConversionRate(lead.scoreAtAssignment),
    0,
  );

  // Empirical-Bayes style shrinkage toward parity. With no leads at all the
  // index is exactly 1.0 — "no evidence" must read as average, never as bad.
  const priorWeight = SHRINKAGE_PSEUDO_LEADS * 0.15;
  const outcomeIndex =
    (actualConversions + priorWeight) / (expectedConversions + priorWeight || 1);

  const behaviour = scoreBehaviour(input.behaviour);

  // Outcome converted to a 0–100 scale where parity (1.0) sits at 60, so
  // "exactly as expected" reads as solid rather than as a failing mark.
  const outcomePoints = clamp(60 * outcomeIndex);

  // Behaviour is weighted heavily on purpose. It is the part a rep controls,
  // the part a manager can coach, and the part that is fair to rank on.
  const overall = Math.round(outcomePoints * 0.55 + behaviour.score * 0.45);

  const confidence: RatingConfidence =
    leadsAssessed >= 40 ? 'HIGH' : leadsAssessed >= 15 ? 'MEDIUM' : 'LOW';

  const band: RatingBand =
    overall >= 80 ? 'EXCEPTIONAL' : overall >= 62 ? 'STRONG' : overall >= 45 ? 'ON_TRACK' : 'DEVELOPING';

  const targetAttainment =
    input.targetValue && input.targetValue > 0
      ? Number((((input.achievedValue ?? 0) / input.targetValue) * 100).toFixed(1))
      : null;

  const explanation: string[] = [];

  if (leadsAssessed === 0) {
    explanation.push('No leads assigned in this period, so there is nothing to measure yet.');
  } else {
    explanation.push(
      `Converted ${actualConversions} of ${leadsAssessed} leads. Leads of this quality would ` +
        `typically produce about ${expectedConversions.toFixed(1)}.`,
    );

    if (outcomeIndex >= 1.15) {
      explanation.push('Converting meaningfully above what these leads should yield.');
    } else if (outcomeIndex <= 0.85) {
      explanation.push('Converting below what these leads should yield.');
    } else {
      explanation.push('Converting roughly in line with what these leads should yield.');
    }
  }

  if (confidence === 'LOW') {
    explanation.push(
      'Based on a small number of leads, so this is pulled toward the average until there is ' +
        'more evidence.',
    );
  }

  const weakest = [...behaviour.metrics].sort((a, b) => a.score - b.score)[0];
  if (weakest && weakest.score < 70) {
    explanation.push(`Biggest controllable gap: ${weakest.label.toLowerCase()} (${weakest.value}).`);
  }

  return {
    outcomeIndex: Number(outcomeIndex.toFixed(2)),
    behaviourScore: behaviour.score,
    overall,
    band,
    confidence,
    leadsAssessed,
    actualConversions,
    expectedConversions: Number(expectedConversions.toFixed(1)),
    targetAttainment,
    behaviourMetrics: behaviour.metrics,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Coaching
// ---------------------------------------------------------------------------

export interface CoachingNudge {
  code: string;
  title: string;
  detail: string;
  /** The concrete next action, not an aspiration. */
  action: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Turns behaviour gaps into specific, checkable actions.
 *
 * Only behaviour drives these. Telling someone "convert more" is not coaching;
 * telling them "eleven of your open leads have no follow-up date" is.
 */
export function coachingNudges(rating: Rating): CoachingNudge[] {
  const nudges: CoachingNudge[] = [];
  const by = (code: string): BehaviourMetric | undefined =>
    rating.behaviourMetrics.find((metric) => metric.code === code);

  const response = by('FIRST_RESPONSE');
  if (response && response.score < 60) {
    nudges.push({
      code: 'SPEED_UP_FIRST_CONTACT',
      title: 'Call new leads sooner',
      detail: `Your first contact takes ${response.value}, against a target of ${response.target.toLowerCase()}.`,
      action: 'Work the newest lead in your list first thing each morning.',
      priority: 'HIGH',
    });
  }

  const overdue = by('OVERDUE');
  if (overdue && overdue.score < 60) {
    nudges.push({
      code: 'CLEAR_OVERDUE',
      title: 'Clear your overdue follow-ups',
      detail: `${overdue.value} — those leads are past the date you committed to.`,
      action: 'Filter leads by "Overdue only" and either call them or re-date them.',
      priority: 'HIGH',
    });
  }

  const coverage = by('FOLLOW_UP_COVERAGE');
  if (coverage && coverage.score < 70) {
    nudges.push({
      code: 'SCHEDULE_FOLLOW_UPS',
      title: 'Set a next step on every lead',
      detail: `Only ${coverage.value} have a follow-up date.`,
      action: 'Set the next follow-up date on the same screen where you log the call.',
      priority: 'MEDIUM',
    });
  }

  const engagement = by('ENGAGEMENT');
  if (engagement && engagement.score < 55) {
    nudges.push({
      code: 'LOG_INTERACTIONS',
      title: 'Log what you discuss',
      detail: `${engagement.value} logged. Leads with a recorded history convert better, and an unlogged call cannot be handed over.`,
      action: 'Log the call before you dial the next number.',
      priority: 'MEDIUM',
    });
  }

  const lost = by('LOST_REASONS');
  if (lost && lost.score < 70) {
    nudges.push({
      code: 'RECORD_LOST_REASONS',
      title: 'Record why deals are lost',
      detail: `${lost.value} of your lost leads have a reason.`,
      action: 'Pick a reason when marking a lead lost — it is what tells us where we are losing.',
      priority: 'LOW',
    });
  }

  if (nudges.length === 0 && rating.leadsAssessed > 0) {
    nudges.push({
      code: 'MAINTAIN',
      title: 'Habits are in good shape',
      detail: 'Every behaviour metric is at or above target.',
      action: 'Keep going — focus on lead quality and deal size from here.',
      priority: 'LOW',
    });
  }

  return nudges;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export const TARGET_PERIODS = ['MONTH', 'QUARTER', 'YEAR'] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

export const upsertTargetSchema = z.object({
  userId: idSchema,
  period: z.enum(TARGET_PERIODS),
  /** First day of the period, as a date. */
  periodStart: z.coerce.date(),
  conversionTarget: z.number().int().min(0).max(10_000).optional(),
  valueTarget: z.number().min(0).max(100_000_000_000).optional(),
});
export type UpsertTargetInput = z.infer<typeof upsertTargetSchema>;

export interface Scorecard {
  user: { id: string; fullName: string };
  period: { label: string; from: string; to: string };
  rating: Rating;
  nudges: CoachingNudge[];
  target: {
    conversionTarget: number | null;
    valueTarget: string | null;
    achievedConversions: number;
    achievedValue: string;
    /** Where they should be by now if pacing evenly through the period. */
    expectedPacePercent: number;
  } | null;
  /**
   * Percentile band rather than an exact rank.
   *
   * A leaderboard position demotivates the bottom half and tells them nothing
   * they can act on. The band plus the gap to the top performer gives the same
   * information without publishing a queue of names.
   */
  standing: {
    percentile: number | null;
    teamMedianOverall: number | null;
    topPerformerOverall: number | null;
    peersAssessed: number;
  };
}
