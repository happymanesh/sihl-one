import type { RatingConfidence } from './performance';

/**
 * Smart allocation — which salesperson should be offered a given lead.
 *
 * This engine **recommends**. It never assigns. Automatic routing already
 * exists in `assignment.ts` (rules the business writes and can read back); this
 * sits on top for the judgement call a manager makes on a valuable lead, and
 * the manager stays in the loop deliberately:
 *
 *  - a rating is an estimate with a stated confidence, and silently acting on a
 *    LOW-confidence estimate hides that uncertainty exactly where it matters;
 *  - allocation driven by rating is a feedback loop — the best-rated rep gets
 *    the best leads, converts them, and rates higher still — so it needs a
 *    human able to say "no, give that one to her, she is ready";
 *  - a rep told a machine took their good leads away has no one to argue with.
 *
 * The loop is damped in two ways below: headroom competes with rating in the
 * fit score, and the development floor deliberately routes a share of strong
 * leads to people who are still building a record.
 */

/** At or above this score a lead is worth allocating deliberately. */
export const STRONG_LEAD_SCORE = 70;

/**
 * Share of strong leads reserved for developing reps.
 *
 * Without this, a rating-driven allocator starves newer people of exactly the
 * leads they need to demonstrate anything, and their rating can then only fall.
 * One in four is enough to keep a record growing without materially denting
 * conversion on the other three.
 */
export const DEVELOPMENT_FLOOR_SHARE = 0.25;

/** Overall rating below which someone counts as still developing. */
export const DEVELOPING_RATING_CEILING = 55;

/**
 * Behaviour floor for strong leads.
 *
 * This is the one gate that is not damped, and it keys on **behaviour**, not
 * outcomes. Someone who is slow to first contact and leaves open leads without
 * a follow-up date will drop a valuable lead regardless of talent, and that is
 * a fair thing to withhold work over because it is entirely within their
 * control. Withholding on a poor *outcome* index would punish bad luck.
 */
export const MIN_BEHAVIOUR_FOR_STRONG_LEADS = 55;

/** Open leads beyond which someone is treated as full. */
export const DEFAULT_CAPACITY = 60;

export interface AllocationCandidate {
  userId: string;
  fullName: string;
  /** Overall rating, 0–100. Use 50 when a rating has not been computed. */
  overall: number;
  behaviourScore: number;
  confidence: RatingConfidence;
  openLeads: number;
  /** Maximum concurrent open leads. Falls back to DEFAULT_CAPACITY. */
  capacity?: number;
  /**
   * Availability the caller determined — on leave, serving notice, wrong
   * branch, deactivated. Kept out of this function because it is a database
   * question, not a judgement.
   */
  isAvailable?: boolean;
  unavailableReason?: string;
}

export interface AllocationRecommendation {
  userId: string;
  fullName: string;
  /** 0–100. Higher is a better fit for *this* lead, not a better salesperson. */
  fitScore: number;
  rank: number;
  reasons: string[];
  /** Promoted by the development floor rather than purely on fit. */
  isDevelopmentPick: boolean;
  openLeads: number;
  capacity: number;
}

export interface AllocationExclusion {
  userId: string;
  fullName: string;
  reason: string;
}

export interface AllocationAdvice {
  leadBand: 'STRONG' | 'STANDARD';
  leadScore: number;
  recommendations: AllocationRecommendation[];
  /**
   * Everyone considered and passed over, with the reason. A recommendation
   * list that silently drops people is impossible to challenge, and the first
   * question a manager asks is "why isn't so-and-so on here?".
   */
  excluded: AllocationExclusion[];
  developmentFloorApplied: boolean;
  note: string;
}

export interface AllocationOptions {
  /**
   * Count of strong leads already allocated through this engine, persisted so
   * the development rotation survives a restart and is even across API pods.
   */
  developmentCursor?: number;
  maxRecommendations?: number;
}

/**
 * Pulls a rating toward the neutral 50 in proportion to how little evidence
 * sits behind it, so a LOW-confidence 90 does not outrank a HIGH-confidence 75.
 * The rating already shrinks for small samples; this shrinks its *influence on
 * other people's work*, which is a separate and higher-stakes decision.
 */
function trustedRating(candidate: AllocationCandidate): number {
  const weight =
    candidate.confidence === 'HIGH' ? 1 : candidate.confidence === 'MEDIUM' ? 0.6 : 0.3;
  return 50 + (candidate.overall - 50) * weight;
}

function capacityOf(candidate: AllocationCandidate): number {
  return candidate.capacity ?? DEFAULT_CAPACITY;
}

/** 1 when empty, 0 when full. */
function headroom(candidate: AllocationCandidate): number {
  const capacity = capacityOf(candidate);
  if (capacity <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - candidate.openLeads / capacity));
}

export function recommendOwners(
  lead: { score: number },
  candidates: readonly AllocationCandidate[],
  options: AllocationOptions = {},
): AllocationAdvice {
  const isStrong = lead.score >= STRONG_LEAD_SCORE;
  const maxRecommendations = options.maxRecommendations ?? 3;
  const excluded: AllocationExclusion[] = [];
  const eligible: AllocationCandidate[] = [];
  /** Caught by the behaviour gate, kept in case it leaves nobody at all. */
  const gated: AllocationCandidate[] = [];
  const reinstated = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.isAvailable === false) {
      excluded.push({
        userId: candidate.userId,
        fullName: candidate.fullName,
        reason: candidate.unavailableReason ?? 'Not available for new leads',
      });
      continue;
    }

    const capacity = capacityOf(candidate);
    if (candidate.openLeads >= capacity) {
      excluded.push({
        userId: candidate.userId,
        fullName: candidate.fullName,
        // Capacity is a real constraint, not a nicety. A lead handed to someone
        // already carrying sixty open ones does not get worked, it gets aged.
        reason: `At capacity — ${candidate.openLeads} open leads of ${capacity}`,
      });
      continue;
    }

    if (isStrong && candidate.behaviourScore < MIN_BEHAVIOUR_FOR_STRONG_LEADS) {
      gated.push(candidate);
      excluded.push({
        userId: candidate.userId,
        fullName: candidate.fullName,
        reason: `Follow-up discipline is below the bar for high-value leads (${Math.round(candidate.behaviourScore)}/100)`,
      });
      continue;
    }

    eligible.push(candidate);
  }

  // If the behaviour gate emptied the list, re-admit the most disciplined of
  // the people it caught. A lead still has to go to someone, and a screen that
  // answers "nobody" when four people are sitting there is one a manager
  // overrides once and then stops opening. The reason travels with the pick.
  if (eligible.length === 0 && gated.length > 0) {
    const best = [...gated].sort(
      (a, b) => b.behaviourScore - a.behaviourScore || a.fullName.localeCompare(b.fullName),
    )[0]!;
    eligible.push(best);
    reinstated.add(best.userId);
    const index = excluded.findIndex((entry) => entry.userId === best.userId);
    if (index >= 0) excluded.splice(index, 1);
  }

  // On a strong lead the record matters more; on an ordinary one, spreading the
  // work matters more than squeezing out a marginal conversion.
  const ratingWeight = isStrong ? 0.65 : 0.4;

  const scored = eligible
    .map((candidate) => {
      const rating = trustedRating(candidate);
      const room = headroom(candidate);
      const fitScore = Math.round(rating * ratingWeight + room * 100 * (1 - ratingWeight));

      const reasons: string[] = [];
      if (reinstated.has(candidate.userId)) {
        reasons.push(
          `Below the follow-up bar for a lead this valuable (${Math.round(candidate.behaviourScore)}/100), but nobody else is available — brief them before handing it over`,
        );
      }
      if (candidate.confidence === 'LOW') {
        reasons.push('Rating is based on few leads, so it counts for less here');
      } else if (candidate.overall >= 70) {
        reasons.push(`Converts above expectation for the leads they are given (${candidate.overall}/100)`);
      } else if (candidate.overall >= DEVELOPING_RATING_CEILING) {
        reasons.push(`Performing in line with expectation (${candidate.overall}/100)`);
      }

      if (candidate.behaviourScore >= 75) {
        reasons.push('Strong follow-up discipline');
      }

      reasons.push(
        room >= 0.5
          ? `Room to take this on — ${candidate.openLeads} open leads of ${capacityOf(candidate)}`
          : `Fairly loaded — ${candidate.openLeads} open leads of ${capacityOf(candidate)}`,
      );

      return {
        userId: candidate.userId,
        fullName: candidate.fullName,
        fitScore,
        rank: 0,
        reasons,
        isDevelopmentPick: false,
        openLeads: candidate.openLeads,
        capacity: capacityOf(candidate),
        candidate,
      };
    })
    // Name as the final tiebreak so an identical field does not reorder itself
    // between two loads of the same screen.
    .sort((a, b) => b.fitScore - a.fitScore || a.fullName.localeCompare(b.fullName));

  let developmentFloorApplied = false;

  if (isStrong && scored.length > 1) {
    const cursor = options.developmentCursor ?? 0;
    const everyNth = Math.round(1 / DEVELOPMENT_FLOOR_SHARE);
    const dueForDevelopment = cursor % everyNth === 0;

    if (dueForDevelopment) {
      const index = scored.findIndex(
        (entry) => entry.candidate.overall < DEVELOPING_RATING_CEILING,
      );
      // Only promote if someone is actually being passed over. If the developing
      // rep already leads on fit, the floor has nothing to correct.
      if (index > 0) {
        const [pick] = scored.splice(index, 1);
        pick!.isDevelopmentPick = true;
        pick!.reasons.unshift(
          'Suggested to build their record — they clear the follow-up bar and this is one of the strong leads reserved for development',
        );
        scored.unshift(pick!);
        developmentFloorApplied = true;
      }
    }
  }

  const recommendations: AllocationRecommendation[] = scored
    .slice(0, maxRecommendations)
    .map(({ candidate: _candidate, ...entry }, position) => ({ ...entry, rank: position + 1 }));

  return {
    leadBand: isStrong ? 'STRONG' : 'STANDARD',
    leadScore: lead.score,
    recommendations,
    excluded,
    developmentFloorApplied,
    note:
      recommendations.length === 0
        ? 'Nobody in this team is available for a new lead right now.'
        : 'Suggestions only — nothing is assigned until you choose.',
  };
}
