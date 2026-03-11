import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
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
  ) {}

  /**
   * Async upload: body must be NDJSON (one JSON task per line).
   * Middleware streams body to temp file. We return 202 and process in background.
   */
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  upload(@Req() req: RequestWithUpload): { jobId: string; message: string } {
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
    this.logger.log(
      `Batch upload accepted. jobId=${jobId} tempFile=${tempFilePath} — processing in background.`,
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
