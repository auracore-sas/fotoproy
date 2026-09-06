import { Module } from '@nestjs/common';
import { PinsController } from './pins.controller.js';
import { PinsService } from './pins.service.js';

@Module({
  controllers: [PinsController],
  providers: [PinsService],
  exports: [PinsService],
})
export class PinsModule {}
