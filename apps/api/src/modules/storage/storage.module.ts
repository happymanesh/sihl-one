import path from 'node:path';

import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local-storage.driver';
import { NoopFileScanner, PermissiveFileScanner } from './scanners';
import { StorageService } from './storage.service';
import { FILE_SCANNER, STORAGE_DRIVER } from './storage.types';

/**
 * Storage wiring.
 *
 * Driver and scanner are chosen from configuration and injected by token, so no
 * business code knows whether a file went to a local disk or to S3, nor whether
 * a real scanner ran. When the S3 driver is added it is registered here and
 * nothing else changes.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new LocalStorageDriver(path.resolve(process.cwd(), config.storage.localRoot)),
    },
    {
      provide: FILE_SCANNER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.storage.scannerMode === 'permissive'
          ? new PermissiveFileScanner()
          : new NoopFileScanner(),
    },
    StorageService,
  ],
  exports: [StorageService, STORAGE_DRIVER, FILE_SCANNER],
})
export class StorageModule {}
