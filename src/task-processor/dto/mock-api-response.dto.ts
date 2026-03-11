import { IsIn, IsString } from 'class-validator';

export type MockResponseCode = 200 | 400 | 500;

/**
 * Response DTO from the mock API.
 */
export class MockApiResponseDto {
  @IsIn([200, 400, 500])
  code: MockResponseCode;

  @IsString()
  message: string;
}
