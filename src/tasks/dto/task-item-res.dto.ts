import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class TaskItemResDto {
  @ApiProperty({ example: 200 })
  @IsNumber()
  statusCode: number;

  @ApiProperty({ example: 'Successfully submitted tasks' })
  @IsString()
  message: string;

  public constructor(statusCode: number, message: string) {
    this.statusCode = statusCode;
    this.message = message;
  }
}
