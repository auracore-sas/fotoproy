import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  /** Signed URL validity in seconds (upload & read). */
  signedUrlTtl: number;
}

/**
 * Thin wrapper around the S3 API (Amazon S3 / Cloudflare R2 / MinIO).
 *
 * All client uploads go through short-lived pre-signed URLs so the app never
 * needs the storage credentials. The bucket name and CORS policy are
 * bootstrapped on startup (idempotent).
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  readonly config: StorageConfig;

  constructor(configService: ConfigService) {
    this.config = {
      endpoint: configService.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: configService.get<string>('STORAGE_REGION') ?? 'us-east-1',
      accessKeyId: configService.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: configService.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      bucket: configService.getOrThrow<string>('STORAGE_BUCKET'),
      forcePathStyle: (configService.get<string>('STORAGE_FORCE_PATH_STYLE') ?? 'true') === 'true',
      signedUrlTtl: Number(configService.get<string>('STORAGE_SIGNED_URL_TTL') ?? 3600),
    };
  }

  onModuleInit(): Promise<void> {
    this.client = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
    return this.bootstrapBucket();
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  /** Creates the bucket when missing and applies a read CORS policy. */
  private async bootstrapBucket(): Promise<void> {
    const { bucket } = this.config;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Bucket "${bucket}" created`);
      } catch (error) {
        // Concurrent creation / provider quirks are tolerated; later calls
        // will surface real permission problems.
        this.logger.warn(`Bucket "${bucket}" may already exist: ${(error as Error).message}`);
      }
    }

    // Read access from any origin so future web viewers can load objects;
    // writes stay server-side / pre-signed (native apps ignore CORS anyway).
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['*'],
                AllowedMethods: ['GET', 'HEAD'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      // MinIO does not implement the S3 CORS API (it is a backend store);
      // real S3/R2 accept it, so a failure here is only dev noise.
      this.logger.debug(
        `Bucket CORS not applied to "${bucket}" (expected on MinIO): ${(error as Error).message}`,
      );
    }
  }

  /** Pre-signed HTTP PUT URL for the given object key. */
  async presignPut(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds ?? this.config.signedUrlTtl },
    );
  }

  /** Pre-signed HTTP GET URL for the given object key. */
  async presignGet(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds ?? this.config.signedUrlTtl },
    );
  }

  /** Downloads an object into memory (server-side operations only). */
  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Object "${key}" is empty`);
    }
    return Buffer.from(bytes);
  }

  /** Uploads bytes to the given object key (server-side operations only). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Removes an object (used by cleanup / admin flows). */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
