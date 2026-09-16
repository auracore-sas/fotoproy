import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimitService } from './rate-limit.service.js';

/**
 * Global rate limiting (F4.5). Imported first in `AppModule` so the limiter runs
 * before authentication: unauthenticated floods are rejected before any JWT
 * verification or database work.
 */
@Global()
@Module({
  providers: [RateLimitService, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [RateLimitService],
})
export class RateLimitModule {}
