import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaskItemReqDto } from '../dto/task-item-req.dto';

const MAX_BATCH_SIZE = 10_000;

/**
 * Validates that the request body is an array of tasks (as in the spec example)
 * and transforms each item to TaskItemReqDto for validation.
 * For larger batches use POST /tasks/upload (NDJSON).
 */
@Injectable()
export class ValidateTasksArrayPipe implements PipeTransform<
  unknown,
  Promise<TaskItemReqDto[]>
> {
  private readonly logger = new Logger(ValidateTasksArrayPipe.name);

  async transform(value: unknown): Promise<TaskItemReqDto[]> {
    // #region agent log
    fetch('http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '4a760a',
      },
      body: JSON.stringify({
        sessionId: '4a760a',
        hypothesisId: 'bodyShape',
        location: 'validate-tasks-array.pipe.ts:transform',
        message: 'Body value received by pipe',
        data: {
          typeof: typeof value,
          isArray: Array.isArray(value),
          keys: value && typeof value === 'object' ? Object.keys(value) : null,
          valueSnippet:
            value === undefined
              ? 'undefined'
              : value === null
                ? 'null'
                : typeof value === 'object'
                  ? JSON.stringify(value).slice(0, 200)
                  : String(value),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    let array: unknown[];
    if (Array.isArray(value)) {
      array = value;
    } else if (
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'id' in value &&
      'payload' in value
    ) {
      array = [value];
    } else {
      const received =
        value === undefined
          ? 'undefined (ensure Content-Type: application/json and body is a valid JSON array)'
          : value === null
            ? 'null'
            : typeof value === 'object'
              ? `object with keys: ${Object.keys(value).join(', ') || '(none)'}`
              : typeof value;
      this.logger.warn(
        `Payload data error: body is not a JSON array of tasks. Received: ${received}`,
      );
      throw new BadRequestException(
        `Request body must be a JSON array of tasks. Received: ${received}`,
      );
    }
    if (array.length === 0) {
      this.logger.warn('Payload data error: at least one task is required.');
      throw new BadRequestException('At least one task is required');
    }
    if (array.length > MAX_BATCH_SIZE) {
      this.logger.warn(
        `Payload data error: batch size exceeds ${MAX_BATCH_SIZE}.`,
      );
      throw new PayloadTooLargeException(
        `Batch size exceeds ${MAX_BATCH_SIZE}. Use POST /tasks/upload with NDJSON for large batches (200k–2M).`,
      );
    }
    const results: TaskItemReqDto[] = [];
    for (let i = 0; i < array.length; i++) {
      const item = plainToInstance(TaskItemReqDto, array[i], {
        enableImplicitConversion: true,
      });
      const errors = await validate(item, { whitelist: true });
      if (errors.length > 0) {
        const messages = errors
          .map((e) => Object.values(e.constraints ?? {}).join(', '))
          .join('; ');
        this.logger.warn(
          `Payload data error: task at index ${i} does not match schema. ${messages}`,
        );
        throw new BadRequestException(`Task at index ${i}: ${messages}`);
      }
      results.push(item);
    }
    return results;
  }
}
