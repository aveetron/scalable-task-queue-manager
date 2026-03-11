import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as amqp from 'amqplib';
import * as os from 'os';
import { Repository } from 'typeorm';
import {
  getRabbitMQConnectionUrl,
  rabbitMQExchanges,
  rabbitMQQueues,
  TASK_DLQ_ROUTING_KEY,
  TASK_RETRY_QUEUE,
} from '../config/rabbitmq.config';
import { ConcurrencyConfigService } from '../concurrency/concurrency-config.service';
import { Task } from '../tasks/entities/task.entity';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MockApiRequestDto } from './dto/mock-api-request.dto';
import { TaskResultDto } from './dto/task-result.dto';
import { MockApiService } from './mock-api.service';

const RETRY_COUNT_HEADER = 'x-retry-count';
const MAX_RETRIES = 2;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 60;
const PREFETCH_SYNC_INTERVAL_MS = 3000;

@Injectable()
export class TaskConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskConsumerService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private mainConsumerTag: string | null = null;
  private retryConsumerTag: string | null = null;
  private currentPrefetch = 0;
  private inFlight = 0;
  private readonly workerId: string;
  private reconnecting = false;
  private destroyed = false;
  private prefetchSyncInterval: ReturnType<typeof setInterval> | null = null;
  private connectionErrorHandler = (): void => void this.handleDisconnect();
  private connectionCloseHandler = (): void => void this.handleDisconnect();

  constructor(
    private readonly mockApi: MockApiService,
    private readonly concurrencyConfig: ConcurrencyConfigService,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
  ) {
    this.workerId =
      process.env.WORKER_ID ?? os.hostname() ?? `worker-${process.pid}`;
  }

  private logPrefix(): string {
    return `[${this.workerId}] `;
  }

  /** Log slug for concurrency visibility: e.g. [concurrency: 2/5] (active/max). */
  private concurrencySlug(afterFinish = false): string {
    const active = afterFinish ? Math.max(0, this.inFlight - 1) : this.inFlight;
    const max = this.currentPrefetch || this.concurrencyConfig.getConcurrency();
    return `[concurrency: ${active}/${max}]`;
  }

  async onModuleInit(): Promise<void> {
    await this.connectAndConsume();
    this.prefetchSyncInterval = setInterval(
      () => void this.syncPrefetchFromConfig(),
      PREFETCH_SYNC_INTERVAL_MS,
    );
  }

  private async connectAndConsume(): Promise<void> {
    const url = getRabbitMQConnectionUrl();
    this.connection = await amqp.connect(url);
    this.connection.on('error', this.connectionErrorHandler);
    this.connection.on('close', this.connectionCloseHandler);
    this.channel = await this.connection.createChannel();
    await this.channel.assertQueue(
      rabbitMQQueues.main.name,
      rabbitMQQueues.main.options,
    );
    await this.channel.assertQueue(
      TASK_RETRY_QUEUE,
      rabbitMQQueues.retry.options,
    );
    const concurrency = this.concurrencyConfig.getConcurrency();
    await this.channel.prefetch(concurrency);
    this.currentPrefetch = concurrency;
    this.logger.log(
      `${this.logPrefix()}Task processor ready. Processing up to ${concurrency} tasks at a time.`,
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

  private async syncPrefetchFromConfig(): Promise<void> {
    if (this.destroyed || !this.channel) return;
    const wanted = this.concurrencyConfig.getConcurrency();
    if (wanted !== this.currentPrefetch) {
      const previous = this.currentPrefetch;
      await this.channel.prefetch(wanted);
      this.currentPrefetch = wanted;
      this.logger.log(
        `${this.logPrefix()}Prefetch updated to ${wanted} (runtime concurrency).`,
      );
      // #region agent log
      fetch(
        'http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '4a760a',
          },
          body: JSON.stringify({
            sessionId: '4a760a',
            hypothesisId: 'prefetchUpdated',
            location: 'task-consumer.service.ts:syncPrefetchFromConfig',
            message: 'Prefetch updated from config',
            data: { wanted, previous },
            timestamp: Date.now(),
          }),
        },
      ).catch(() => {});
      // #endregion
    }
  }

  private async handleDisconnect(): Promise<void> {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;
    this.mainConsumerTag = null;
    this.retryConsumerTag = null;
    this.channel = null;
    if (this.connection) {
      this.connection.removeListener('error', this.connectionErrorHandler);
      this.connection.removeListener('close', this.connectionCloseHandler);
      this.connection = null;
    }
    let delayMs = RECONNECT_INITIAL_MS;
    for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (this.destroyed) return;
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        await this.connectAndConsume();
        this.reconnecting = false;
        this.logger.log(`${this.logPrefix()}Reconnected to RabbitMQ.`);
        return;
      } catch (err) {
        this.logger.warn(
          `${this.logPrefix()}Reconnect attempt ${attempt + 1}/${RECONNECT_MAX_ATTEMPTS} failed: ${err}`,
        );
        delayMs = Math.min(RECONNECT_MAX_MS, delayMs * 2);
      }
    }
    this.logger.error(
      `${this.logPrefix()}Reconnect failed after ${RECONNECT_MAX_ATTEMPTS} attempts. Set reconnecting=false so a future close can retry.`,
    );
    this.reconnecting = false;
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.prefetchSyncInterval != null) {
      clearInterval(this.prefetchSyncInterval);
      this.prefetchSyncInterval = null;
    }
    if (this.channel) {
      if (this.mainConsumerTag) await this.channel.cancel(this.mainConsumerTag);
      if (this.retryConsumerTag)
        await this.channel.cancel(this.retryConsumerTag);
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      this.connection.removeListener('error', this.connectionErrorHandler);
      this.connection.removeListener('close', this.connectionCloseHandler);
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
          `${this.logPrefix()}❌ Task "${taskId}" skipped: invalid format or missing required fields.`,
        );
        this.channel.nack(msg, false, false);
        return;
      }

      // Skip if this task was already processed (any status: 200, 400, or 500) to avoid duplicate work on re-upload.
      const existingTask = await this.taskRepo.findOneBy({ id: request.id });
      if (existingTask != null) {
        this.logger.log(
          `${this.logPrefix()}❌ Task "${request.id}" skipped (duplicate, already processed).`,
        );
        this.channel.ack(msg);
        return;
      }

      this.inFlight++;
      const context = fromRetry ? ` (retry attempt ${retryCount})` : '';
      this.logger.log(
        `${this.logPrefix()}Processing task "${request.id}"${context} … ${this.concurrencySlug()}`,
      );

      const response = await this.mockApi.getResponse(request);

      if (response.code === 200) {
        // as this is already successful, we can save the result and ack the message
        await this.saveResult(this.buildResultDto(request, 200, retryCount));
        this.logger.log(
          `${this.logPrefix()}✅ Task "${request.id}" completed successfully. ${this.concurrencySlug(true)}`,
        );
        this.channel.ack(msg);
        return;
      }

      if (response.code === 400) {
        // 400: never retry. Save result, ack and skip (no publish to retry queue).
        await this.saveResult(this.buildResultDto(request, 400, retryCount));

        this.logger.log(
          `${this.logPrefix()}❌ Task "${request.id}" could not be processed (invalid data). Skipped. ${this.concurrencySlug(true)}`,
        );
        this.channel.ack(msg);
        return;
      }

      // 500: retry up to MAX_RETRIES (2) for 200; if still not 200 after 2 retries, save status 400 and totalRetries 2, ack (no DLQ)
      if (retryCount >= MAX_RETRIES) {
        await this.saveResult(this.buildResultDto(request, 400, MAX_RETRIES));
        this.logger.log(
          `${this.logPrefix()}❌ Task "${request.id}" failed after ${MAX_RETRIES} retries. Marked as failed (no further retries). ${this.concurrencySlug(true)}`,
        );
        this.channel.ack(msg);
        return;
      }

      // Do not persist 500; only 200 or 400 are final. Publish to retry queue for next attempt.
      this.channel.publish('', TASK_RETRY_QUEUE, msg.content, {
        persistent: true,
        headers: {
          ...msg.properties.headers,
          [RETRY_COUNT_HEADER]: retryCount + 1,
        },
      });
      this.logger.log(
        `${this.logPrefix()}Task "${request.id}" failed temporarily. Will retry (attempt ${retryCount + 1} of ${MAX_RETRIES}). ${this.concurrencySlug(true)}`,
      );
      this.channel.ack(msg);
    } catch (err) {
      const taskId = request?.id ?? this.tryGetTaskIdFromMessage(msg.content);
      this.logger.warn(
        `${this.logPrefix()}❌ Task "${taskId}" could not be processed: ${err} ${this.concurrencySlug(true)}`,
      );
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
