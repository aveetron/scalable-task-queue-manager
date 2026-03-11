import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ConcurrencyConfigService } from '../concurrency/concurrency-config.service';
import { UploadProcessorService } from './upload-processor.service';
import { UploadJobStore } from './upload-job.store';

interface RequestWithUpload extends Request {
  tempFilePath?: string;
  uploadJobId?: string;
}

@Controller('tasks')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadProcessorService: UploadProcessorService,
    private readonly uploadJobStore: UploadJobStore,
    private readonly concurrencyConfig: ConcurrencyConfigService,
  ) {}

  /**
   * Async upload: body must be NDJSON or a single JSON array.
   * Middleware streams body to temp file. We return 202 and process in background.
   * Optional ?concurrency=N (1–100) sets runtime prefetch for the consumer.
   */
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  upload(
    @Req() req: RequestWithUpload,
    @Query('concurrency') concurrency?: string | string[],
  ): { jobId: string; message: string } {
    // #region agent log
    fetch('http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '4a760a',
      },
      body: JSON.stringify({
        sessionId: '4a760a',
        runId: 'upload',
        hypothesisId: 'H1',
        location: 'upload.controller.ts:upload',
        message: 'POST /tasks/upload query and concurrency param',
        data: {
          method: req.method,
          path: req.path,
          originalUrl: req.originalUrl,
          queryKeys: Object.keys(req.query ?? {}),
          query: req.query,
          queryConcurrency: (req.query as Record<string, unknown>)?.concurrency,
          queryConcurrencyCapital: (req.query as Record<string, unknown>)
            ?.Concurrency,
          paramConcurrency: concurrency,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const raw =
      concurrency ??
      (req.query as Record<string, unknown>)?.Concurrency ??
      (req.query as Record<string, unknown>)?.concurrency;
    const concurrencyStr =
      raw == null ? undefined : Array.isArray(raw) ? raw[0] : String(raw);
    if (concurrencyStr != null && concurrencyStr !== '') {
      try {
        const n = parseInt(concurrencyStr, 10);
        if (
          Number.isNaN(n) ||
          n < this.concurrencyConfig.getMin() ||
          n > this.concurrencyConfig.getMax()
        ) {
          throw new BadRequestException(
            `concurrency must be between ${this.concurrencyConfig.getMin()} and ${this.concurrencyConfig.getMax()}`,
          );
        }
        this.concurrencyConfig.setConcurrency(n);
        // #region agent log
        fetch(
          'http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Debug-Session-Id': '4a760a',
            },
            body: JSON.stringify({
              sessionId: '4a760a',
              runId: 'upload',
              hypothesisId: 'H4',
              location: 'upload.controller.ts:setConcurrency',
              message: 'setConcurrency called',
              data: { n },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Invalid concurrency',
        );
      }
    }
    const tempFilePath = req.tempFilePath;
    const jobId = req.uploadJobId;
    if (!tempFilePath || !jobId) {
      this.logger.warn(
        'Upload rejected: middleware did not set tempFilePath or uploadJobId. Ensure request body is streamed (no prior body parser for this route).',
      );
      throw new BadRequestException(
        'Upload stream middleware did not run. Send NDJSON body to POST /tasks/upload.',
      );
    }
    const maxSlots = this.concurrencyConfig.getConcurrency();
    this.logger.log(
      `POST /tasks/upload: jobId=${jobId} accepted [concurrency: ${maxSlots} (max slots)]. Processing in background.`,
    );
    this.uploadProcessorService.processFile(tempFilePath, jobId);
    return {
      jobId,
      message: 'Upload accepted. Processing in background.',
    };
  }

  /**
   * Get status of an upload job.
   */
  @Get('jobs/:id')
  getJobStatus(@Param('id') id: string): {
    jobId: string;
    status?: string;
    totalTasks?: number;
    error?: string;
  } {
    try {
      const status = this.uploadJobStore.get(id);
      if (!status) {
        this.logger.debug(`Job status requested for unknown jobId=${id}`);
        return { jobId: id };
      }
      return {
        jobId: id,
        status: status.status,
        totalTasks: status.totalTasks,
        error: status.error,
      };
    } catch (err) {
      this.logger.error(
        `getJobStatus(${id}) failed: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }
}
