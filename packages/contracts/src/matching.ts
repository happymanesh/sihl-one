/**
 * Duplicate detection.
 *
 * Pure, dependency-free and exhaustively testable, because this is the code
 * that decides whether two rows are the same human being. Getting it wrong in
 * one direction merges two real prospects into one record and loses a customer;
 * getting it wrong in the other floods the pipeline with the same person and
 * has two salespeople cold-calling them from different campaigns.
 *
 * The design principle: **identity keys are decisive, everything else is
 * evidence.** A matching PAN or mobile is a fact. A matching name is a hint —
 * "Rahul Patel" in Ahmedabad is not rare.
 */

export interface MatchCandidate {
  id: string;
  reference?: string;
  firstName: string;
  lastName?: string | null;
  mobile?: string | null;
  email?: string | null;
  pan?: string | null;
  city?: string | null;
  /** Present on existing leads; used to explain the conflict, never to score it. */
  ownerName?: string | null;
  status?: string | null;
}

export interface MatchInput {
  firstName: string;
  lastName?: string | null;
  mobile?: string | null;
  email?: string | null;
  pan?: string | null;
  city?: string | null;
}

export type MatchConfidence = 'DEFINITE' | 'PROBABLE' | 'POSSIBLE' | 'NONE';

export interface MatchSignal {
  code: string;
  label: string;
  points: number;
}

export interface MatchResult {
  candidate: MatchCandidate;
  score: number;
  confidence: MatchConfidence;
  signals: MatchSignal[];
}

/**
 * Thresholds.
 *
 * DEFINITE is reserved for identity-key equality only — never reachable by
 * accumulating weak signals, however many there are. That is deliberate: an
 * automatic merge should only ever happen on a fact, not on a pile of hints.
 */
export const MATCH_DEFINITE = 90;
export const MATCH_PROBABLE = 60;
export const MATCH_POSSIBLE = 35;

export function confidenceFor(score: number): MatchConfidence {
  if (score >= MATCH_DEFINITE) return 'DEFINITE';
  if (score >= MATCH_PROBABLE) return 'PROBABLE';
  if (score >= MATCH_POSSIBLE) return 'POSSIBLE';
  return 'NONE';
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Last 10 digits, so `+91 98765 43210`, `098765 43210` and `9876543210` agree. */
export function normaliseMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function normaliseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : null;
}

export function normalisePan(value: string | null | undefined): string | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase().replace(/\s/g, '');
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(upper) ? upper : null;
}

/**
 * Name normalisation for comparison.
 *
 * Tokens are sorted so "Patel Asha" and "Asha Patel" agree — Indian records
 * routinely disagree on field order between systems. Honorifics are stripped
 * because "Mr Rahul Mehta" and "Rahul Mehta" are the same person.
 */
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'sri', 'md']);

export function normaliseName(first: string, last?: string | null): string {
  return `${first} ${last ?? ''}`
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !HONORIFICS.has(token))
    .sort()
    .join(' ');
}

export function normaliseCity(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/[^a-z\s]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Levenshtein distance, iterative with two rows.
 *
 * Used only for near-miss names ("Mehta" vs "Mehtaa", "Rahul" vs "Rahool"),
 * which are common when data is keyed by hand at an event desk. Bounded by
 * caller-side length checks so it never runs on long strings.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j]! + 1,
        previous[j + 1]! + 1,
        previous[j]! + cost,
      );
    }
    previous = current;
  }

  return previous[b.length]!;
}

/** 0–1 similarity, normalised by the longer string. */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest > 80) return 0; // Guard: not a name, do not spend the cycles.
  return Math.max(0, 1 - editDistance(a, b) / longest);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Scores one candidate against the incoming record.
 *
 * Identity keys short-circuit to DEFINITE on their own. Weak signals are capped
 * below the DEFINITE threshold by construction, so no accumulation of hints can
 * ever trigger an automatic merge.
 */
export function scoreMatch(input: MatchInput, candidate: MatchCandidate): MatchResult {
  const signals: MatchSignal[] = [];

  const inputPan = normalisePan(input.pan);
  const candidatePan = normalisePan(candidate.pan);
  if (inputPan && candidatePan && inputPan === candidatePan) {
    // PAN is the regulated identity key in India. Two records sharing one are
    // the same person, full stop.
    signals.push({ code: 'PAN', label: 'Same PAN', points: 100 });
    return finalise(candidate, signals, true);
  }

  const inputMobile = normaliseMobile(input.mobile);
  const candidateMobile = normaliseMobile(candidate.mobile);
  if (inputMobile && candidateMobile && inputMobile === candidateMobile) {
    signals.push({ code: 'MOBILE', label: 'Same mobile number', points: 95 });
    return finalise(candidate, signals, true);
  }

  // Everything below is evidence, not proof.
  const inputEmail = normaliseEmail(input.email);
  const candidateEmail = normaliseEmail(candidate.email);
  if (inputEmail && candidateEmail && inputEmail === candidateEmail) {
    // Strong, but shared family and office addresses are common enough that
    // this alone must not auto-merge.
    signals.push({ code: 'EMAIL', label: 'Same email address', points: 55 });
  }

  const inputName = normaliseName(input.firstName, input.lastName);
  const candidateName = normaliseName(candidate.firstName, candidate.lastName);
  const similarity = nameSimilarity(inputName, candidateName);

  if (similarity === 1) {
    signals.push({ code: 'NAME_EXACT', label: 'Same name', points: 25 });
  } else if (similarity >= 0.85) {
    signals.push({
      code: 'NAME_CLOSE',
      label: `Very similar name (${Math.round(similarity * 100)}%)`,
      points: 15,
    });
  }

  if (similarity >= 0.85) {
    const inputCity = normaliseCity(input.city);
    const candidateCity = normaliseCity(candidate.city);
    if (inputCity && candidateCity && inputCity === candidateCity) {
      signals.push({ code: 'CITY', label: 'Same city', points: 15 });
    }

    // Last four digits agreeing while the full numbers differ usually means one
    // side was mis-keyed, not that these are different people.
    if (
      inputMobile &&
      candidateMobile &&
      inputMobile !== candidateMobile &&
      inputMobile.slice(-4) === candidateMobile.slice(-4)
    ) {
      signals.push({
        code: 'MOBILE_PARTIAL',
        label: 'Mobile numbers differ but share the last four digits',
        points: 20,
      });
    }
  }

  return finalise(candidate, signals);
}

function finalise(
  candidate: MatchCandidate,
  signals: MatchSignal[],
  isIdentityKey = false,
): MatchResult {
  const raw = signals.reduce((total, signal) => total + signal.points, 0);

  // Weak signals are capped *below* the DEFINITE threshold rather than at 100.
  // Without this, email + exact name + same city + a partial mobile sums past
  // 90 and produces an automatic skip on circumstantial evidence alone —
  // which is precisely the outcome the identity-key short-circuit exists to
  // prevent. Only PAN and mobile may reach DEFINITE.
  const ceiling = isIdentityKey ? 100 : MATCH_DEFINITE - 1;
  const score = Math.min(ceiling, raw);

  return { candidate, score, confidence: confidenceFor(score), signals };
}

/**
 * Scores every candidate and returns those worth a human's attention, best
 * first. Candidates below POSSIBLE are dropped — surfacing them would train
 * reviewers to click through without reading.
 */
export function findMatches(
  input: MatchInput,
  candidates: readonly MatchCandidate[],
  limit = 5,
): MatchResult[] {
  return candidates
    .map((candidate) => scoreMatch(input, candidate))
    .filter((result) => result.confidence !== 'NONE')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * What the importer should do with a row, given its best match.
 *
 * `SKIP` rather than `MERGE` on a definite match is the approved ownership
 * policy: the incumbent record and its owner win, and the import records that a
 * claim was made without changing who holds the lead. Merging automatically
 * would silently transfer a colleague's lead to whoever imported last.
 */
export type ImportRowDecision = 'CREATE' | 'SKIP' | 'REVIEW';

export function suggestDecision(best: MatchResult | undefined): ImportRowDecision {
  if (!best) return 'CREATE';
  if (best.confidence === 'DEFINITE') return 'SKIP';
  if (best.confidence === 'PROBABLE') return 'REVIEW';
  return 'CREATE';
}
