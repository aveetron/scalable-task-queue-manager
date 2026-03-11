import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as amqp from 'amqplib';
import { Repository } from 'typeorm';
import {
  getRabbitMQConnectionUrl,
  rabbitMQExchanges,
  rabbitMQQueues,
  TASK_DLQ_ROUTING_KEY,
  TASK_RETRY_QUEUE,
} from '../config/rabbitmq.config';
import { Task } from '../tasks/entities/task.entity';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MockApiRequestDto } from './dto/mock-api-request.dto';
import { TaskResultDto } from './dto/task-result.dto';
import { MockApiService } from './mock-api.service';

const RETRY_COUNT_HEADER = 'x-retry-count';
const MAX_RETRIES = 2;

@Injectable()
export class TaskConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskConsumerService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private mainConsumerTag: string | null = null;
  private retryConsumerTag: string | null = null;
  private readonly concurrency: number;
  private inFlight = 0;

  constructor(
    private readonly mockApi: MockApiService,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
  ) {
    this.concurrency = Math.max(
      1,
      parseInt(
        process.env.TASK_CONCURRENCY ?? process.env.CONCURRENCY ?? '2',
        10,
      ),
    );
  }

  async onModuleInit(): Promise<void> {
    const url = getRabbitMQConnectionUrl();
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertQueue(
      rabbitMQQueues.main.name,
      rabbitMQQueues.main.options,
    );
    await this.channel.assertQueue(
      TASK_RETRY_QUEUE,
      rabbitMQQueues.retry.options,
    );
    await this.channel.prefetch(this.concurrency);
    this.logger.log(
      `Task processor ready. Processing up to ${this.concurrency} tasks at a time.`,
    );

    const main = await this.channel.consume(rabbitMQQueues.main.name, (msg) =>
      this.handleMessage(msg, false),
    );
    this.mainConsumerTag = main.consumerTag;
    const retry = await this.channel.consume(TASK_RETRY_QUEUE, (msg) =>
      this.handleMessage(msg, true),
    );
    this.retryConsumerTag = retry.consumerTag;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      if (this.mainConsumerTag) await this.channel.cancel(this.mainConsumerTag);
      if (this.retryConsumerTag)
        await this.channel.cancel(this.retryConsumerTag);
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  private async handleMessage(
    msg: amqp.ConsumeMessage | null,
    fromRetry: boolean,
  ): Promise<void> {
    if (!msg || !this.channel) return;
    const rawRetry = msg.properties.headers?.[RETRY_COUNT_HEADER];
    const retryCount = fromRetry
      ? Math.max(0, parseInt(String(rawRetry ?? 0), 10) || 0)
      : 0;

    let request: MockApiRequestDto | null = null;
    try {
      request = await this.parseAndValidateRequest(msg.content);
      if (!request) {
        const taskId = this.tryGetTaskIdFromMessage(msg.content);
        this.logger.warn(
          `❌ Task "${taskId}" skipped: invalid format or missing required fields.`,
        );
        this.channel.nack(msg, false, false);
        return;
      }

      const alreadyCompleted = await this.taskRepo.findOne({
        where: { id: request.id, statusCode: 200 },
      });
      if (alreadyCompleted) {
        this.logger.log(
          `❌ Task "${request.id}" skipped (duplicate, already completed).`,
        );
        this.channel.ack(msg);
        return;
      }

      this.inFlight++;
      const context = fromRetry ? ` (retry attempt ${retryCount})` : '';
      this.logger.log(
        `Processing task "${request.id}"${context} … (${this.inFlight} running)`,
      );

      const response = await this.mockApi.getResponse(request);

      if (response.code === 200) {
        await this.saveResult(this.buildResultDto(request, 200, retryCount));
        this.logger.log(`✅ Task "${request.id}" completed successfully.`);
        this.channel.ack(msg);
        return;
      }

      if (response.code === 400) {
        await this.saveResult(this.buildResultDto(request, 400, retryCount));
        this.logger.log(
          `❌ Task "${request.id}" could not be processed (invalid data). Skipped.`,
        );
        this.channel.ack(msg);
        return;
      }

      // 500: retry up to MAX_RETRIES for 200; if still not 200 after retries, treat as 400 and ack (no DLQ)
      if (retryCount >= MAX_RETRIES) {
        await this.saveResult(this.buildResultDto(request, 400, retryCount));
        this.logger.log(
          `❌ Task "${request.id}" failed after ${MAX_RETRIES} retries. Marked as failed (no further retries).`,
        );
        this.channel.ack(msg);
        return;
      }

      await this.saveResult(this.buildResultDto(request, 500, retryCount + 1));
      this.channel.publish('', TASK_RETRY_QUEUE, msg.content, {
        persistent: true,
        headers: {
          ...msg.properties.headers,
          [RETRY_COUNT_HEADER]: retryCount + 1,
        },
      });
      this.logger.log(
        `Task "${request.id}" failed temporarily. Will retry (attempt ${retryCount + 1} of ${MAX_RETRIES}).`,
      );
      this.channel.ack(msg);
    } catch (err) {
      const taskId = request?.id ?? this.tryGetTaskIdFromMessage(msg.content);
      this.logger.warn(`❌ Task "${taskId}" could not be processed: ${err}`);
      this.channel.nack(msg, false, false);
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }

  private buildResultDto(
    request: MockApiRequestDto,
    statusCode: 200 | 400 | 500,
    totalRetries: number,
  ): TaskResultDto {
    const dto = new TaskResultDto();
    dto.id = request.id;
    dto.payload = request.payload;
    dto.statusCode = statusCode;
    dto.totalRetries = totalRetries;
    return dto;
  }

  private async saveResult(dto: TaskResultDto): Promise<void> {
    await this.taskRepo.upsert(dto.toEntity(), { conflictPaths: ['id'] });
  }

  private tryGetTaskIdFromMessage(content: Buffer): string {
    try {
      const raw = JSON.parse(content.toString());
      return raw?.id ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async parseAndValidateRequest(
    content: Buffer,
  ): Promise<MockApiRequestDto | null> {
    try {
      const raw = JSON.parse(content.toString());
      const request = plainToInstance(MockApiRequestDto, raw, {
        enableImplicitConversion: true,
      });
      const errors = await validate(request, { whitelist: true });
      return errors.length === 0 ? request : null;
    } catch {
      return null;
    }
  }

  private publishToDlq(content: Buffer): void {
    if (!this.channel) return;
    this.channel.publish(
      rabbitMQExchanges.dlx.name,
      TASK_DLQ_ROUTING_KEY,
      content,
      { persistent: true },
    );
  }
}
