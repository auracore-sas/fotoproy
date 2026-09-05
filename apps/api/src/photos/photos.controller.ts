import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type {
  CreatePhotoInput,
  Page,
  PhotoListQuery,
  PresignPhotoUploadInput,
  PresignUploadResponse,
} from '@fotoproy/shared';
import {
  createPhotoInputSchema,
  photoListQuerySchema,
  presignPhotoUploadSchema,
  uuidSchema,
} from '@fotoproy/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AuthedUser } from '../common/interfaces/auth-user.interface.js';
import { PhotosService } from './photos.service.js';
import type { PhotoDto } from './photos.service.js';

@Controller('photos')
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  /** Pre-signed PUT URL to upload a media object directly to storage. */
  @Post('presign')
  presignUpload(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(presignPhotoUploadSchema)) body: PresignPhotoUploadInput,
  ): Promise<PresignUploadResponse> {
    return this.photosService.presignUpload(current, body);
  }

  /** Registers a media item already uploaded to storage (idempotent by id). */
  @Post()
  create(
    @CurrentUser() current: AuthedUser,
    @Body(new ZodValidationPipe(createPhotoInputSchema)) body: CreatePhotoInput,
  ): Promise<PhotoDto> {
    return this.photosService.create(current, body);
  }

  @Get()
  list(
    @CurrentUser() current: AuthedUser,
    @Query(new ZodValidationPipe(photoListQuerySchema)) query: PhotoListQuery,
  ): Promise<Page<PhotoDto>> {
    return this.photosService.list(current, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() current: AuthedUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<PhotoDto> {
    return this.photosService.findOne(current, id);
  }
}
