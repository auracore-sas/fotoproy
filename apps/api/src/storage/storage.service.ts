import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

export interface StorageConfig {
  /** Endpoint used by the API itself (in Docker: the internal service URL). */
  endpoint: string;
  /**
   * Endpoint that clients (phones, browsers) can reach, used only to sign
   * URLs. Empty means "same as `endpoint`". In Dokploy/Docker the internal
   * host is not reachable from a phone, so this is normally the public
   * MinIO/R2 domain.
   */
  publicEndpoint: string;
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
  /** Signs URLs for clients; identical to `client` when no public endpoint. */
  private signingClient!: S3Client;
  readonly config: StorageConfig;

  constructor(configService: ConfigService) {
    const trim = (value: string): string => value.replace(/\/+$/, '');
    this.config = {
      endpoint: trim(configService.getOrThrow<string>('STORAGE_ENDPOINT')),
      publicEndpoint: trim(configService.get<string>('STORAGE_PUBLIC_ENDPOINT') ?? ''),
      region: configService.get<string>('STORAGE_REGION') ?? 'us-east-1',
      accessKeyId: configService.getOrThrow<string>('STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: configService.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY'),
      bucket: configService.getOrThrow<string>('STORAGE_BUCKET'),
      forcePathStyle: (configService.get<string>('STORAGE_FORCE_PATH_STYLE') ?? 'true') === 'true',
      signedUrlTtl: Number(configService.get<string>('STORAGE_SIGNED_URL_TTL') ?? 3600),
    };
  }

  onModuleInit(): Promise<void> {
    this.client = this.createClient(this.config.endpoint);
    // A pre-signed URL is only valid for the host it was signed with, so URLs
    // handed to the app must be signed against the endpoint the app can reach.
    this.signingClient = this.config.publicEndpoint
      ? this.createClient(this.config.publicEndpoint)
      : this.client;
    if (this.config.publicEndpoint && this.config.publicEndpoint !== this.config.endpoint) {
      this.logger.log(
        `Signed URLs use ${this.config.publicEndpoint} (data plane: ${this.config.endpoint})`,
      );
    }
    return this.bootstrapBucket();
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      region: this.config.region,
      endpoint,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  onModuleDestroy(): void {
    this.client?.destroy();
    if (this.signingClient !== this.client) {
      this.signingClient?.destroy();
    }
  }

  /** Creates the bucket when missing and applies a read CORS policy. */
  private async bootstrapBucket(): Promise<void> {
    const { bucket, endpoint } = this.config;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      this.logger.log(`Bucket "${bucket}" ready at ${endpoint}`);
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Bucket "${bucket}" created at ${endpoint}`);
      } catch (error) {
        // Loud on purpose: if this fails, the API still signs URLs but every
        // server-side operation (thumbnails, share media proxy) will fail.
        // /health reports it too, so a misconfigured STORAGE_ENDPOINT is
        // visible from outside instead of hiding in the logs.
        this.logger.error(
          `Cannot create bucket "${bucket}" at ${endpoint}: ${(error as Error).message}`,
        );
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

  /**
   * Reachability of the data plane, reported by `GET /health`:
   * - `up`      the API can talk to the bucket from this container;
   * - `missing` reachable, but the bucket does not exist yet;
   * - `down`    cannot reach the endpoint (wrong host, network or credentials).
   */
  async checkBucket(): Promise<'up' | 'missing' | 'down'> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return 'up';
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchBucket') {
        return 'missing';
      }
      this.logger.warn(
        `Storage check failed at ${this.config.endpoint}: ${(error as Error).message}`,
      );
      return 'down';
    }
  }

  /** Pre-signed HTTP PUT URL for the given object key. */
  async presignPut(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds ?? this.config.signedUrlTtl },
    );
  }

  /** Pre-signed HTTP GET URL for the given object key. */
  async presignGet(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds ?? this.config.signedUrlTtl },
    );
  }

  /**
   * Metadata of a stored object, or `null` when it does not exist.
   *
   * Used to verify that a client really uploaded what it claims before a media
   * record is created (existence + size cap), so the commit step cannot be used
   * to register missing or oversized objects.
   */
  async headObject(key: string): Promise<{ contentLength: number; contentType?: string } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { contentLength: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  /** Downloads an object into memory (server-side operations only). */ async getObject(
    key: string,
  ): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Object "${key}" is empty`);
    }
    return Buffer.from(bytes);
  }

  /**
   * Streams an object without buffering it in memory (used by the public web
   * view, which proxies media so the bucket host is never exposed).
   */
  async getObjectStream(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
  }> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`Object "${key}" has no body`);
    }
    return {
      body: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
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
