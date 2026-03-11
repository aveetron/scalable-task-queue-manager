import {
  IsIn,
  IsNumber,
  IsObject,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Task, TaskStatusCode } from '../../tasks/entities/task.entity';

/**
 * DTO for a task processing result (200/400/500) before persisting to the Task entity.
 * Use toEntity() to convert to Task for insert/upsert.
 */
export class TaskResultDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  id: string;

  @IsObject()
  payload: Record<string, unknown>;

  @IsIn([200, 400, 500])
  statusCode: TaskStatusCode;

  @IsNumber()
  @Min(0)
  totalRetries: number;

  toEntity(): Task {
    const task = new Task();
    task.id = this.id;
    task.payload = this.payload;
    task.statusCode = this.statusCode;
    task.totalRetries = this.totalRetries;
    return task;
  }
}
