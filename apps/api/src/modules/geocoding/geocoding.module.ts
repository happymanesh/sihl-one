import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { GeocodingController } from './geocoding.controller';
import { DisabledGeocoder, MapplsGeocoder } from './geocoders';
import { GEOCODER } from './geocoding.types';

/**
 * Geocoding wiring.
 *
 * Provider chosen from configuration and injected by token, so switching one on
 * — or swapping vendors — is an environment change rather than a release. The
 * disabled provider is a real implementation rather than a null, which keeps
 * every caller free of "is geocoding on?" branching.
 */
@Global()
@Module({
  controllers: [GeocodingController],
  providers: [
    {
      provide: GEOCODER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.geocoding.provider !== 'mappls') return new DisabledGeocoder();

        // Credentials are guaranteed by the configuration validator, which
        // refuses this provider without them.
        const { clientId, clientSecret, tokenUrl, reverseUrl } = config.geocoding.mappls;
        return new MapplsGeocoder(
          clientId!,
          clientSecret!,
          tokenUrl,
          reverseUrl,
          config.geocoding.timeoutMs,
        );
      },
    },
  ],
  exports: [GEOCODER],
})
export class GeocodingModule {}
