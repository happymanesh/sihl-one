import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod';
import { GEOCODER, type Geocoder } from './geocoding.types';

const coordinateSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

@ApiTags('geocoding')
@ApiBearerAuth()
@Controller('geo')
export class GeocodingController {
  constructor(@Inject(GEOCODER) private readonly geocoder: Geocoder) {}

  /**
   * The street address at a coordinate, for stamping onto a check-in photo.
   *
   * Proxied rather than called from the browser, and that is the whole reason
   * this endpoint exists: a geocoding key shipped to a phone is a key anyone
   * can extract and spend, on an account SIHL is billed for.
   *
   * Throttled per user. The upstream is metered, and an authenticated caller
   * looping over coordinates is a bill rather than a breach — but a bill is
   * still worth preventing.
   *
   * Never fails: an unavailable provider returns a null address, because the
   * caller is a rep waiting to photograph a client's premises and the stamp is
   * complete without it.
   */
  @Get('reverse')
  @RequirePermissions('visit:create')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiQuery({ name: 'lat', type: Number })
  @ApiQuery({ name: 'lng', type: Number })
  @ApiOperation({
    summary: 'Resolve a coordinate to a street address',
    description:
      'Returns { address: null } when no geocoder is configured or the provider is ' +
      'unreachable. Callers must render the coordinate alone in that case rather than ' +
      'treating it as an error.',
  })
  async reverse(
    @Query(new ZodValidationPipe(coordinateSchema)) query: z.infer<typeof coordinateSchema>,
  ): Promise<{ address: string | null; provider: string }> {
    const address = await this.geocoder.reverse({
      latitude: query.lat,
      longitude: query.lng,
    });

    return { address, provider: this.geocoder.name };
  }
}
