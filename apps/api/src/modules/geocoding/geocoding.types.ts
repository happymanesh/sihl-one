/**
 * Turning a coordinate into a street address.
 *
 * A seam with a disabled default, for the same reason the malware scanner has
 * one: "no address was available" must be an explicit, visible state rather
 * than something inferred from a blank. A visit stamped with coordinates and no
 * address is a complete record; a visit that silently lost its address because
 * a key expired is a mystery three weeks later.
 */
export interface Geocoder {
  readonly name: string;

  /**
   * Resolves a coordinate to a human-readable address.
   *
   * Returns null for every failure — no key, refused, timed out, nothing found.
   * Callers must treat null as ordinary: the check-in continues either way, and
   * nothing in this system may block on a third party being reachable.
   */
  reverse(input: { latitude: number; longitude: number }): Promise<string | null>;
}

export const GEOCODER = 'GEOCODER';
