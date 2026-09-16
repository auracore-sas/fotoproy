import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

/**
 * Express `trust proxy` value from the environment.
 *
 * Off by default: trusting proxy headers when the app is reachable directly
 * lets a client forge its own address (and dodge rate limits). Set it to the
 * number of proxies in front (1 for a single reverse proxy) when the app only
 * receives traffic through them.
 */
function trustProxySetting(value: string | undefined): boolean | number {
  if (!value || value === 'false' || value === '0') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  const hops = Number(value);
  return Number.isFinite(hops) && hops > 0 ? hops : false;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Basic security and CORS (harden in F4.5).
  // `upgrade-insecure-requests` is disabled on purpose: it does nothing for a
  // JSON API, and on plain-HTTP deployments (dev/LAN/staging) it makes the
  // browser rewrite the public share page's same-origin media URLs to HTTPS,
  // so every image fails to load. The share pages ship their own CSP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { upgradeInsecureRequests: null },
      },
    }),
  );
  const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? ['*'];
  app.enableCors({ origin: corsOrigin.includes('*') ? true : corsOrigin });

  // F4.5 — request bodies are small by design (media travels straight to
  // storage through pre-signed URLs), so a tight JSON limit keeps a flood from
  // turning into memory pressure. Rate limiting lives in RateLimitGuard.
  app.useBodyParser('json', { limit: process.env.JSON_BODY_LIMIT ?? '1mb' });
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));

  // Global DTO validation with shared schemas (zod → class-validator bridge in F1).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port, '0.0.0.0');
  console.log(`FotoProy API listening on http://localhost:${port}`);
}

void bootstrap();
