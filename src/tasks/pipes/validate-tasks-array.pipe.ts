import {
  BadRequestException,
  Injectable,
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
  async transform(value: unknown): Promise<TaskItemReqDto[]> {
    if (!Array.isArray(value)) {
      throw new BadRequestException(
        'Request body must be a JSON array of tasks',
      );
    }
    if (value.length === 0) {
      throw new BadRequestException('At least one task is required');
    }
    if (value.length > MAX_BATCH_SIZE) {
      throw new PayloadTooLargeException(
        `Batch size exceeds ${MAX_BATCH_SIZE}. Use POST /tasks/upload with NDJSON for large batches (200k–2M).`,
      );
    }
    const results: TaskItemReqDto[] = [];
    for (let i = 0; i < value.length; i++) {
      const item = plainToInstance(TaskItemReqDto, value[i], {
        enableImplicitConversion: true,
      });
      const errors = await validate(item, { whitelist: true });
      if (errors.length > 0) {
        const messages = errors
          .map((e) => Object.values(e.constraints ?? {}).join(', '))
          .join('; ');
        throw new BadRequestException(`Task at index ${i}: ${messages}`);
      }
      results.push(item);
    }
    return results;
  }
}
