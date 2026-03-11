import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import express from 'express';
import * as expressNs from 'express';
import helmet from 'helmet';

const expressLib = (express ?? expressNs) as typeof import('express');
import * as path from 'path';
import { uploadStreamMiddleware } from './tasks/upload-stream.middleware';

const UPLOAD_MAX_BYTES =
  parseInt(process.env.UPLOAD_MAX_BYTES ?? String(1024 * 1024 * 1024), 10) ||
  1024 * 1024 * 1024;
const UPLOAD_TEMP_DIR =
  process.env.UPLOAD_TEMP_DIR != null &&
  String(process.env.UPLOAD_TEMP_DIR).trim() !== ''
    ? path.normalize(String(process.env.UPLOAD_TEMP_DIR).trim())
    : undefined;

// Prevent ECONNRESET / EPIPE from client disconnect during upload from crashing the process
process.on('unhandledRejection', (reason: unknown) => {
  const err = reason instanceof Error ? reason : undefined;
  const code = err ? (err as NodeJS.ErrnoException).code : undefined;
  // #region agent log
  fetch('http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '4a760a',
    },
    body: JSON.stringify({
      sessionId: '4a760a',
      hypothesisId: 'unhandledRejection',
      location: 'main.ts:process.unhandledRejection',
      message: 'Unhandled Rejection',
      data: {
        message: err?.message ?? String(reason),
        code,
        stack: err?.stack,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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
  const jsonParser = expressLib.json({
    limit: '10mb',
    type: () => true,
  });
  // Parse JSON body for POST /tasks (and any non-upload POST) before upload stream runs, so req.body is set for the tasks controller.
  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (req.method !== 'POST') return next();
      const path = (req.originalUrl || req.url || '').split('?')[0] || '';
      if (path.includes('tasks/upload')) return next();
      return jsonParser(req, res, next);
    },
  );
  app.use(uploadStreamMiddleware(UPLOAD_MAX_BYTES, UPLOAD_TEMP_DIR));
  app.use(
    (
      a: express.Request | Error,
      b: express.Response | express.Request,
      c: express.NextFunction | express.Response,
      d?: express.NextFunction,
    ) => {
      if (d !== undefined) return d(a as Error);
      const res = b as express.Response;
      if (typeof res?.json !== 'function') {
        const err = a as Error;
        const resObj = c as express.Response;
        if (
          typeof resObj?.status === 'function' &&
          typeof resObj?.json === 'function'
        ) {
          resObj
            .status(500)
            .json({ message: err?.message ?? 'Internal server error' });
        }
        return;
      }
      const req = a as express.Request;
      const next = c as express.NextFunction;
      if (req.originalUrl?.includes('tasks/upload') && req.method === 'POST') {
        return next();
      }
      return next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Task Queue Management System')
    .setDescription(
      'Submit tasks (JSON payloads); a mock API returns 200/400/500. Supports retries, persistence, and configurable concurrency. Two APIs: POST /tasks (small batches) and POST /tasks/upload (large batches).',
    )
    .setVersion('1.0')
    .addTag('tasks', 'Small-batch task submission (JSON array, max 10k tasks)')
    .addTag('tasks/upload', 'Large-batch upload (streamed body, 202 + background processing)')
    .addTag('health', 'Health check')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
    console.log(`Swagger UI: http://${host}:${port}/api`);
  });
}
bootstrap();
