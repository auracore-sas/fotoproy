import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { StorageModule } from './storage/storage.module.js';
import { PhotosModule } from './photos/photos.module.js';
import { PlansModule } from './plans/plans.module.js';
import { PinsModule } from './pins/pins.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { SharesModule } from './shares/shares.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    PhotosModule,
    PlansModule,
    PinsModule,
    CommentsModule,
    SharesModule,
  ],
})
export class AppModule {}
