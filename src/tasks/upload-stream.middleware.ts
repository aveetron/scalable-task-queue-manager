import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Request, Response, NextFunction } from 'express';

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1GB

/**
 * Streams request body to a temp file for POST /tasks/upload.
 * Sets req.tempFilePath and req.uploadJobId. Skips for other routes.
 */
export function uploadStreamMiddleware(
  maxBytes: number = DEFAULT_MAX_BYTES,
  tempDir: string = os.tmpdir(),
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl?.split('?')[0] ?? '';
    if (req.method !== 'POST' || !url.includes('tasks/upload')) {
      return next();
    }
    const jobId = crypto.randomUUID();
    const tempFilePath = path.join(tempDir, `upload-${jobId}.ndjson`);
    const writeStream = fs.createWriteStream(tempFilePath);
    let totalBytes = 0;
    let finished = false;
    console.log(`[Upload] jobId=${jobId} streaming body to ${tempFilePath}`);

    const cleanup = (callback?: () => void) => {
      writeStream.destroy();
      fs.unlink(tempFilePath, () => callback?.());
    };

    const done = (err?: Error) => {
      if (finished) return;
      finished = true;
      if (err) {
        cleanup(() => next(err));
      } else {
        next();
      }
    };

    req.on('data', (chunk: Buffer) => {
      if (finished) return;
      if (totalBytes + chunk.length > maxBytes) {
        req.destroy();
        cleanup(() => {
          if (!finished) {
            finished = true;
            res.status(413).json({
              statusCode: 413,
              message: 'Payload too large. Max upload size exceeded.',
            });
          }
        });
        return;
      }
      totalBytes += chunk.length;
      writeStream.write(chunk);
    });

    req.on('end', () => {
      if (finished) return;
      writeStream.end(() => {
        if (finished) return;
        console.log(
          `[Upload] jobId=${jobId} stream finished. ${totalBytes} bytes written to ${tempFilePath}`,
        );
        (
          req as Request & { tempFilePath?: string; uploadJobId?: string }
        ).tempFilePath = tempFilePath;
        (
          req as Request & { tempFilePath?: string; uploadJobId?: string }
        ).uploadJobId = jobId;
        done();
      });
    });

    req.on('error', (err: Error) => {
      handleStreamError(err);
    });

    // ECONNRESET often fires on the socket; catch it so it doesn't become unhandled
    req.socket?.on('error', (err: Error) => {
      handleStreamError(err);
    });

    function handleStreamError(err: Error) {
      if (finished) return;
      const code = (err as NodeJS.ErrnoException).code;
      if (
        code === 'ECONNRESET' ||
        code === 'EPIPE' ||
        code === 'ECONNABORTED'
      ) {
        finished = true;
        req.destroy();
        cleanup();
        // Don't call next(err) — client is gone; writing would cause another error
        return;
      }
      done(err);
    }

    writeStream.on('error', (err) => {
      cleanup(() => done(err));
    });

    res.on('close', () => {
      if (!finished) {
        finished = true;
        req.destroy();
        cleanup();
      }
    });
  };
}
