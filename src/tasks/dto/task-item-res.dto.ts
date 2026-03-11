import { IsNumber, IsString } from 'class-validator';

export class TaskItemResDto {
  @IsNumber()
  statusCode: number;

  @IsString()
  message: string;

  public constructor(statusCode: number, message: string) {
    this.statusCode = statusCode;
    this.message = message;
  }
}
