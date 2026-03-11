import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Single task item: id + flexible JSON payload (e.g. type, to, userId as in the spec).
 */
export class TaskItemReqDto {
  @ApiProperty({ example: 'task-1', description: 'Unique task identifier' })
  @IsString()
  @IsNotEmpty({ message: 'Task id is required' })
  @MinLength(1, { message: 'Task id must not be empty' })
  @MaxLength(255, { message: 'Task id must be at most 255 characters' })
  id: string;

  @ApiProperty({
    example: { type: 'email', to: 'user@example.com' },
    description: 'Task payload (flexible JSON object)',
  })
  @IsObject({ message: 'Payload must be a valid JSON object' })
  @IsNotEmpty({ message: 'Payload is required' })
  payload: Record<string, unknown>;
}
