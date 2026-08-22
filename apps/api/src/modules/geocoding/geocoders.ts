import { Injectable, Logger } from '@nestjs/common';

import type { Geocoder } from './geocoding.types';

/**
 * No geocoding configured.
 *
 * Returns null rather than throwing: a visit stamped with coordinates and a
 * timestamp is a complete, useful record, and the address was always the
 * garnish. Warns once so an environment that was meant to have a key does not
 * quietly run for a month without one.
 */
@Injectable()
export class DisabledGeocoder implements Geocoder {
  readonly name = 'disabled';
  private readonly logger = new Logger(DisabledGeocoder.name);
  private warned = false;

  async reverse(): Promise<string | null> {
    if (!this.warned) {
      this.logger.warn(
        'No geocoder configured. Check-in photos carry coordinates and a timestamp but no ' +
          'street address. Set GEOCODER=mappls with credentials to enable it.',
      );
      this.warned = true;
    }
    return null;
  }
}

interface MapplsToken {
  value: string;
  expiresAt: number;
}

/**
 * Reverse geocoding through Mappls (MapmyIndia).
 *
 * Chosen over Google for two reasons that matter here: address quality outside
 * the metros, which is where most SIHL branches are, and the fact that a rep's
 * precise location stays with an Indian company — an easier answer if the
 * question is ever asked formally.
 *
 * Mappls authenticates with OAuth client credentials and returns a short-lived
 * bearer token, so the token is cached and refreshed rather than fetched per
 * call. Both URLs are configurable: their API host has moved more than once,
 * and a URL change should be an environment variable, not a release.
 *
 * Every failure path returns null. This runs while a rep is standing outside a
 * client's office waiting to check in, and no third party gets to hold that up.
 */
@Injectable()
export class MapplsGeocoder implements Geocoder {
  readonly name = 'mappls';
  private readonly logger = new Logger(MapplsGeocoder.name);
  private token: MapplsToken | null = null;

  /**
   * Bounded cache of recent lookups.
   *
   * Coordinates are rounded to four decimals, about eleven metres, which is
   * well inside the accuracy of a phone fix — so two reps checking in at the
   * same branch, or one rep retaking a photo, cost a single call. This is a
   * metered API and the calls are not free.
   */
  private readonly cache = new Map<string, { address: string | null; at: number }>();
  private static readonly CACHE_MAX = 500;
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenUrl: string,
    private readonly reverseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async reverse(input: { latitude: number; longitude: number }): Promise<string | null> {
    const key = `${input.latitude.toFixed(4)},${input.longitude.toFixed(4)}`;

    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < MapplsGeocoder.CACHE_TTL_MS) return hit.address;

    try {
      const token = await this.accessToken();
      if (!token) return null;

      const url = `${this.reverseUrl}?lat=${input.latitude}&lng=${input.longitude}`;
      const response = await this.fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        // 401 usually means the cached token was revoked early; drop it so the
        // next call re-authenticates rather than failing forever.
        if (response.status === 401) this.token = null;
        this.logger.warn(`Mappls reverse geocode returned ${response.status}`);
        return null;
      }

      const address = this.readAddress(await response.json());
      this.remember(key, address);
      return address;
    } catch (error) {
      this.logger.warn(
        `Mappls reverse geocode failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Pulls a readable address out of the response.
   *
   * Deliberately tolerant. Their payload has carried the address under more
   * than one key across API versions, and the cost of guessing wrong is a
   * missing address on a photo — while the cost of a strict parser is the same
   * missing address plus an exception in the logs. Falls back to assembling the
   * parts when no single formatted field is present.
   */
  private readAddress(payload: unknown): string | null {
    const body = payload as {
      results?: Array<Record<string, unknown>>;
      responseCode?: number;
    };

    const first = body?.results?.[0];
    if (!first) return null;

    const formatted = first.formatted_address ?? first.formattedAddress ?? first.address;
    if (typeof formatted === 'string' && formatted.trim()) return tidy(formatted);

    // Field names verified against a live response: camelCase, not snake_case.
    const parts = ['houseNumber', 'houseName', 'street', 'subLocality', 'locality', 'city', 'state', 'pincode']
      .map((field) => first[field])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    return parts.length ? tidy(parts.join(', ')) : null;
  }

  private remember(key: string, address: string | null): void {
    // Crude eviction: oldest insertion first. A real LRU would be better and
    // this cache is 500 entries of short strings, so it is not worth the code.
    if (this.cache.size >= MapplsGeocoder.CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { address, at: Date.now() });
  }

  private async accessToken(): Promise<string | null> {
    // Refreshed a minute early, so a token cannot expire between the check and
    // the call that uses it.
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await this.fetchWithTimeout(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      this.logger.warn(`Mappls token request returned ${response.status}`);
      return null;
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;

    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Trims noise from a provider address before it is stamped on a photo.
 *
 * Mappls ends every Indian address with "(India)", which costs a line of a
 * stamp that sits on evidence of a visit inside India. The country is the one
 * part of the address nobody needed to be told.
 */
function tidy(address: string): string {
  return address
    .replace(/\s*\(India\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
