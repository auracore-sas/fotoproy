import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/** Global: StorageService is injected by any module that needs object storage. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
