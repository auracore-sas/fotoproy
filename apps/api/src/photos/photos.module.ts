import { Module } from '@nestjs/common';
import { PhotosController } from './photos.controller.js';
import { PhotosService } from './photos.service.js';
import { ThumbnailsService } from './thumbnails.service.js';

@Module({
  controllers: [PhotosController],
  providers: [PhotosService, ThumbnailsService],
  exports: [PhotosService, ThumbnailsService],
})
export class PhotosModule {}
