import {
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Request DTO for the mock API (task to process).
 */
export class MockApiRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  id: string;

  @IsObject()
  @IsNotEmpty()
  payload: Record<string, unknown>;
}
