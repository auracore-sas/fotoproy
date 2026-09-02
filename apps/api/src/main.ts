import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Seguridad y CORS básicos (endurecer en F4.5).
  app.use(helmet());
  const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? ['*'];
  app.enableCors({ origin: corsOrigin.includes('*') ? true : corsOrigin });

  // Validación global de DTOs con los schemas compartidos (zod → class-validator bridge en F1).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port, '0.0.0.0');
  console.log(`FotoProy API escuchando en http://localhost:${port}`);
}

void bootstrap();
