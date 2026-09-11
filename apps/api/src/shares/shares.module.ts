import { Module } from '@nestjs/common';
import { SharesController } from './shares.controller.js';
import { PublicSharesController } from './public-shares.controller.js';
import { SharesService } from './shares.service.js';

@Module({
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService],
  exports: [SharesService],
})
export class SharesModule {}
