import { Injectable } from '@nestjs/common';
import { MockApiRequestDto } from './dto/mock-api-request.dto';
import {
  MockApiResponseDto,
  MockResponseCode,
} from './dto/mock-api-response.dto';

/**
 * Mocks the external API: returns 200 (success), 400 (non-retryable), or 500 (retryable) at random.
 */
@Injectable()
export class MockApiService {
  public async getResponse(
    request: MockApiRequestDto,
  ): Promise<MockApiResponseDto> {
    const r = Math.random();
    if (r < 1 / 3) {
      return this.buildResponse(200, 'processed successfully');
    }
    if (r < 2 / 3) {
      return this.buildResponse(500, 'temporary server error');
    }
    return this.buildResponse(400, 'invalid payload');
  }

  private buildResponse(
    code: MockResponseCode,
    message: string,
  ): MockApiResponseDto {
    const dto = new MockApiResponseDto();
    dto.code = code;
    dto.message = message;
    return dto;
  }
}
