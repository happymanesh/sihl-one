/**
 * Geospatial helpers for the field-visit module.
 *
 * Pure functions, no dependencies, so the rules that decide whether a visit is
 * trustworthy can be unit-tested exhaustively rather than only observed through
 * the API. Visit records feed incentive calculations, so "is this location
 * plausible" is a business question, not a cosmetic one.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METRES = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a planar approximation: at Indian latitudes a flat
 * approximation is fine over a few hundred metres and wrong over a few hundred
 * kilometres, and this is used to compare a check-in against a check-out that
 * could legitimately be either.
 */
export function distanceInMetres(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a)));
}

export type LocationQuality = 'PRECISE' | 'GOOD' | 'APPROXIMATE' | 'UNRELIABLE';

/**
 * Interprets the accuracy radius the browser reports.
 *
 * The number matters: a "location" with a 2 km radius is a cell-tower fix, not
 * a GPS fix, and treating it as evidence that someone stood outside a client's
 * office would be dishonest. The band is surfaced in the UI and stored with the
 * visit so a reviewer can weigh it.
 */
export function locationQuality(accuracyMetres: number | null | undefined): LocationQuality {
  if (accuracyMetres === null || accuracyMetres === undefined) return 'UNRELIABLE';
  if (accuracyMetres <= 25) return 'PRECISE';
  if (accuracyMetres <= 100) return 'GOOD';
  if (accuracyMetres <= 1000) return 'APPROXIMATE';
  return 'UNRELIABLE';
}

/**
 * Beyond this a fix carries no useful information.
 *
 * Retained as a documented bound, but nothing rejects on it any more. A check-in
 * with no location at all is now a legitimate outcome — a basement, a rural
 * gap — so refusing merely-vague coordinates while accepting none would have
 * been backwards. `locationQuality` bands the fix and `assessCheckInLocation`
 * decides whether it confirms presence; both classify rather than reject.
 */
export const MAX_ACCEPTABLE_ACCURACY_METRES = 5000;

/**
 * A check-out this far from the check-in suggests the two events did not happen
 * at the same meeting. It does not block the check-out — a salesperson may
 * legitimately walk to a car park, and blocking would mean the visit is never
 * closed at all — but it is flagged for review.
 */
export const VISIT_DRIFT_REVIEW_THRESHOLD_METRES = 1000;

export interface VisitIntegrity {
  driftMetres: number | null;
  requiresReview: boolean;
  reasons: string[];
}

/**
 * Assesses whether a completed visit's location evidence hangs together.
 *
 * Deliberately advisory rather than punitive. It surfaces facts a manager can
 * act on; it never accuses, and it never silently discards a visit.
 */
export function assessVisitIntegrity(input: {
  checkIn: Coordinates | null;
  checkOut: Coordinates | null;
  checkInAccuracy: number | null;
  checkOutAccuracy: number | null;
  durationMinutes: number | null;
  /**
   * Whether the rep has actually checked in yet.
   *
   * Without this, a visit that is merely *planned* has no accuracy reading, and
   * a missing reading looks identical to a terrible one — so every planned
   * visit in the list was flagged "the check-in location was too imprecise",
   * about a check-in that had not happened. Absent for older callers, where the
   * presence of any check-in coordinate is the best available signal.
   */
  hasCheckedIn?: boolean;
  /**
   * Whether this visit's mode expects a location at all.
   *
   * A phone call has nowhere to be. Flagging "no location was recorded" on
   * every call and chat would fill the review queue with entries no manager can
   * act on, and a flag that fires on everything stops being read — which costs
   * far more than it catches. Defaults to true for callers that predate modes.
   */
  expectsLocation?: boolean;
}): VisitIntegrity {
  const reasons: string[] = [];
  let driftMetres: number | null = null;

  if (input.checkIn && input.checkOut) {
    driftMetres = distanceInMetres(input.checkIn, input.checkOut);

    // Compare the drift against the combined uncertainty of the two fixes.
    // Flagging a 300 m drift when both readings are ±400 m would be noise.
    const uncertainty = (input.checkInAccuracy ?? 0) + (input.checkOutAccuracy ?? 0);
    if (driftMetres > VISIT_DRIFT_REVIEW_THRESHOLD_METRES && driftMetres > uncertainty) {
      reasons.push(
        `Check-out was ${(driftMetres / 1000).toFixed(1)} km from check-in, beyond the accuracy of both readings.`,
      );
    }
  }

  const checkedIn = input.hasCheckedIn ?? input.checkIn !== null;
  const expectsLocation = input.expectsLocation ?? true;

  if (checkedIn && expectsLocation) {
    if (input.checkInAccuracy === null || input.checkInAccuracy === undefined) {
      // A check-in with no fix at all. Since a poor signal no longer blocks the
      // check-in, this is an ordinary outcome — worth a manager's eye, not an
      // accusation, and phrased as the absence it is rather than as a bad
      // reading that was never taken.
      reasons.push('No location was recorded at check-in.');
    } else if (locationQuality(input.checkInAccuracy) === 'UNRELIABLE') {
      reasons.push('The check-in location was too imprecise to place the visit.');
    }
  }

  if (input.durationMinutes !== null && input.durationMinutes < 2) {
    reasons.push('The visit lasted under two minutes.');
  }

  return { driftMetres, requiresReview: reasons.length > 0, reasons };
}
