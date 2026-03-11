import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { TaskItemReqDto } from './dto/task-item-req.dto';
import { TaskQueueService } from '../task-queue/task-queue.service';
import { UploadJobStore } from './upload-job.store';

export interface TaskMessage {
  id: string;
  payload: Record<string, unknown>;
}

/** Max bytes to load for single JSON array format (avoids OOM). Larger files should use NDJSON. */
const MAX_JSON_ARRAY_BYTES = 150 * 1024 * 1024; // 150MB

@Injectable()
export class UploadProcessorService {
  private readonly logger = new Logger(UploadProcessorService.name);

  constructor(
    private readonly taskQueueService: TaskQueueService,
    private readonly uploadJobStore: UploadJobStore,
  ) {}

  /**
   * Process temp file: supports both a single JSON array and NDJSON (one JSON object per line). Run in background (do not await).
   */
  processFile(tempFilePath: string, jobId: string): void {
    void this.processFileAsync(tempFilePath, jobId).catch((err) => {
      this.logger.error(`Upload job ${jobId} failed: ${err}`);
      this.uploadJobStore.set(jobId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async processFileAsync(
    tempFilePath: string,
    jobId: string,
  ): Promise<void> {
    this.uploadJobStore.set(jobId, { status: 'processing' });
    const chunkSize = Math.max(
      1,
      parseInt(process.env.UPLOAD_CHUNK_SIZE ?? '5000', 10) || 5000,
    );
    this.logger.log(
      `[Batch ${jobId}] Starting. Reading from ${tempFilePath} (chunk size: ${chunkSize})`,
    );

    try {
      if (!fs.existsSync(tempFilePath)) {
        throw new Error(`Temp file not found: ${tempFilePath}`);
      }
      const firstChar = await this.detectFormat(tempFilePath);
      if (firstChar === '[') {
        await this.processJsonArrayFile(tempFilePath, jobId, chunkSize);
      } else {
        await this.processNdjsonFile(tempFilePath, jobId, chunkSize);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[Batch ${jobId}] Failed: ${msg}${err instanceof Error ? `\n${err.stack}` : ''}`,
      );
      this.uploadJobStore.set(jobId, {
        status: 'failed',
        error: msg,
      });
    } finally {
      const pathToDelete = path.normalize(tempFilePath);
      try {
        if (fs.existsSync(pathToDelete)) {
          fs.unlinkSync(pathToDelete);
          this.logger.log(
            `[Batch ${jobId}] Temp file removed: ${pathToDelete}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[Batch ${jobId}] Failed to delete temp file ${pathToDelete}: ${err instanceof Error ? err.message : err}. You can remove it manually.`,
        );
      }
    }
  }

  /** Read first byte to detect format: '[' = JSON array, '{' = NDJSON. */
  private async detectFormat(tempFilePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(tempFilePath, {
        encoding: 'utf8',
        start: 0,
        end: 63,
      });
      let data = '';
      stream.on('data', (chunk: string) => {
        data += chunk;
      });
      stream.on('end', () => {
        const first = data.replace(/^\s+/, '')[0] ?? '';
        resolve(first);
      });
      stream.on('error', reject);
    });
  }

  /**
   * File is a single JSON array (e.g. pretty-printed). Load and parse, then process in chunks.
   */
  private async processJsonArrayFile(
    tempFilePath: string,
    jobId: string,
    chunkSize: number,
  ): Promise<void> {
    const stat = fs.statSync(tempFilePath);
    if (stat.size > MAX_JSON_ARRAY_BYTES) {
      throw new Error(
        `File too large for JSON array format (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_JSON_ARRAY_BYTES / 1024 / 1024}MB. Use NDJSON (one JSON object per line) for larger uploads.`,
      );
    }
    this.logger.log(
      `[Batch ${jobId}] Detected JSON array format (${(stat.size / 1024 / 1024).toFixed(1)}MB). Parsing...`,
    );
    const content = await fs.promises.readFile(tempFilePath, 'utf8');
    const raw = JSON.parse(content) as unknown;
    if (!Array.isArray(raw)) {
      throw new Error('Expected a JSON array at root. Got: ' + typeof raw);
    }
    let totalEnqueued = 0;
    let invalidItems = 0;
    const buffer: TaskMessage[] = [];
    const seen = new Set<string>();

    const dedupeAndPublish = async (tasks: TaskMessage[]) => {
      const deduped: TaskMessage[] = [];
      for (const t of tasks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        deduped.push(t);
      }
      if (deduped.length > 0) {
        await this.taskQueueService.publishMany(deduped);
        totalEnqueued += deduped.length;
        this.logger.log(
          `[Batch ${jobId}] Enqueued chunk of ${deduped.length} tasks (total so far: ${totalEnqueued})`,
        );
      }
    };

    const logFirstFailures = 5;
    let loggedFailures = 0;

    for (let i = 0; i < raw.length; i++) {
      const one = raw[i];
      try {
        const item = plainToInstance(TaskItemReqDto, one, {
          enableImplicitConversion: true,
        });
        const errors = await validate(item, { whitelist: true });
        if (errors.length > 0) {
          invalidItems++;
          if (loggedFailures < logFirstFailures) {
            const msg = errors
              .map((e) =>
                e.constraints
                  ? Object.values(e.constraints).join(', ')
                  : e.property,
              )
              .join('; ');
            this.logger.warn(
              `[Batch ${jobId}] Validation failed (item ${i + 1}): ${msg}`,
            );
            loggedFailures++;
          }
          continue;
        }
        buffer.push({ id: item.id, payload: item.payload });
        if (buffer.length >= chunkSize) {
          await dedupeAndPublish(buffer);
          buffer.length = 0;
        }
      } catch (parseErr) {
        invalidItems++;
        if (loggedFailures < logFirstFailures) {
          const msg =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          this.logger.warn(
            `[Batch ${jobId}] Parse/validation error (item ${i + 1}): ${msg}`,
          );
          loggedFailures++;
        }
      }
    }

    if (buffer.length > 0) {
      await dedupeAndPublish(buffer);
    }

    this.uploadJobStore.set(jobId, {
      status: 'completed',
      totalTasks: totalEnqueued,
    });
    this.logger.log(
      `[Batch ${jobId}] Completed. Total enqueued: ${totalEnqueued} (items: ${raw.length}, invalid/skipped: ${invalidItems})`,
    );
  }

  /**
   * File is NDJSON: one JSON object per line (or one JSON array per line).
   */
  private async processNdjsonFile(
    tempFilePath: string,
    jobId: string,
    chunkSize: number,
  ): Promise<void> {
    let totalEnqueued = 0;
    let lineCount = 0;
    let invalidLines = 0;
    const buffer: TaskMessage[] = [];
    const seen = new Set<string>();

    const dedupeAndPublish = async (tasks: TaskMessage[]) => {
      const deduped: TaskMessage[] = [];
      for (const t of tasks) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        deduped.push(t);
      }
      if (deduped.length > 0) {
        await this.taskQueueService.publishMany(deduped);
        totalEnqueued += deduped.length;
        this.logger.log(
          `[Batch ${jobId}] Enqueued chunk of ${deduped.length} tasks (total so far: ${totalEnqueued})`,
        );
      }
    };

    const fileStream = fs.createReadStream(tempFilePath, {
      encoding: 'utf8',
    });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const logFirstFailures = 5;
    let loggedFailures = 0;

    this.logger.log(
      `[Batch ${jobId}] Detected NDJSON format. Processing line by line.`,
    );

    for await (const line of rl) {
      lineCount++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const raw = JSON.parse(trimmed) as unknown;
        const items: unknown[] = Array.isArray(raw) ? raw : [raw];

        for (const one of items) {
          const item = plainToInstance(TaskItemReqDto, one, {
            enableImplicitConversion: true,
          });
          const errors = await validate(item, { whitelist: true });
          if (errors.length > 0) {
            invalidLines++;
            if (loggedFailures < logFirstFailures) {
              const msg = errors
                .map((e) =>
                  e.constraints
                    ? Object.values(e.constraints).join(', ')
                    : e.property,
                )
                .join('; ');
              this.logger.warn(
                `[Batch ${jobId}] Validation failed (line ${lineCount}): ${msg}. Sample: ${trimmed.slice(0, 120)}...`,
              );
              loggedFailures++;
            }
            continue;
          }
          buffer.push({ id: item.id, payload: item.payload });
          if (buffer.length >= chunkSize) {
            await dedupeAndPublish(buffer);
            buffer.length = 0;
          }
        }
      } catch (parseErr) {
        invalidLines++;
        if (loggedFailures < logFirstFailures) {
          const msg =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          this.logger.warn(
            `[Batch ${jobId}] Parse error (line ${lineCount}): ${msg}. Sample: ${trimmed.slice(0, 120)}...`,
          );
          loggedFailures++;
        }
      }
    }

    if (buffer.length > 0) {
      await dedupeAndPublish(buffer);
    }

    this.uploadJobStore.set(jobId, {
      status: 'completed',
      totalTasks: totalEnqueued,
    });
    this.logger.log(
      `[Batch ${jobId}] Completed. Total enqueued: ${totalEnqueued} (lines read: ${lineCount}, invalid/skipped: ${invalidLines})`,
    );
  }
}
