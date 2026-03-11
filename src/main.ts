import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import express from 'express';
import helmet from 'helmet';
import { uploadStreamMiddleware } from './tasks/upload-stream.middleware';

const UPLOAD_MAX_BYTES =
  parseInt(process.env.UPLOAD_MAX_BYTES ?? String(1024 * 1024 * 1024), 10) ||
  1024 * 1024 * 1024;
const UPLOAD_TEMP_DIR = process.env.UPLOAD_TEMP_DIR ?? undefined;

// Prevent ECONNRESET / EPIPE from client disconnect during upload from crashing the process
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : undefined;
  const code = err ? (err as NodeJS.ErrnoException).code : undefined;
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED') {
    return; // Client disconnected; ignore
  }
  if (err) {
    console.error('Unhandled Rejection:', err.message || reason);
  }
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(helmet());
  app.use(uploadStreamMiddleware(UPLOAD_MAX_BYTES, UPLOAD_TEMP_DIR));
  app.use((req, res, next) => {
    if (req.originalUrl?.includes('tasks/upload') && req.method === 'POST') {
      return next();
    }
    return express.json({ limit: '10mb' })(req, res, next);
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT || 3000, () => {
    console.log(`Server is running on port ${process.env.PORT || 3000}`);
  });
}
bootstrap();
