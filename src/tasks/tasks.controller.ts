import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TaskItemResDto } from './dto/task-item-res.dto';
import { TaskItemReqDto } from './dto/task-item-req.dto';
import { ValidateTasksArrayPipe } from './pipes/validate-tasks-array.pipe';
import { TasksService } from './tasks.service';
import { ConcurrencyConfigService } from '../concurrency/concurrency-config.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly concurrencyConfig: ConcurrencyConfigService,
  ) {}

  /**
   * Upload tasks for processing.
   * Body: JSON array of { id, payload } (see spec example).
   * Optional ?concurrency=N (1–100) sets runtime prefetch for the consumer.
   */
  @Post('/')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit tasks (small batch)',
    description:
      'Accepts a JSON array of tasks (max 10,000). Deduplicates by id and publishes to the queue. Optional concurrency sets consumer prefetch (1 to machine cores × 2).',
  })
  @ApiBody({
    type: [TaskItemReqDto],
    description: 'JSON array of task objects with id and payload',
  })
  @ApiQuery({
    name: 'concurrency',
    required: false,
    description: 'Runtime concurrency (prefetch). 1 to machine cores × 2.',
  })
  @ApiResponse({ status: 200, description: 'Tasks accepted', type: TaskItemResDto })
  @ApiResponse({ status: 400, description: 'Invalid body or concurrency' })
  @ApiResponse({ status: 429, description: 'Too many requests (rate limit)' })
  public async submit(
    @Req() req: Request,
    @Body(ValidateTasksArrayPipe) tasks: TaskItemReqDto[],
    @Query('concurrency') concurrency?: string | string[],
  ): Promise<TaskItemResDto> {
    // #region agent log
    fetch('http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '4a760a',
      },
      body: JSON.stringify({
        sessionId: '4a760a',
        runId: 'tasks',
        hypothesisId: 'H1',
        location: 'tasks.controller.ts:submit',
        message: 'POST /tasks query and concurrency param',
        data: {
          method: req.method,
          path: req.path,
          originalUrl: req.originalUrl,
          queryKeys: Object.keys(req.query ?? {}),
          query: req.query,
          queryConcurrency: (req.query as Record<string, unknown>)?.concurrency,
          queryConcurrencyCapital: (req.query as Record<string, unknown>)
            ?.Concurrency,
          paramConcurrency: concurrency,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const raw =
      concurrency ??
      (req.query as Record<string, unknown>)?.Concurrency ??
      (req.query as Record<string, unknown>)?.concurrency;
    const concurrencyStr =
      raw == null ? undefined : Array.isArray(raw) ? raw[0] : String(raw);
    if (concurrencyStr != null && concurrencyStr !== '') {
      try {
        const n = parseInt(concurrencyStr, 10);
        if (
          Number.isNaN(n) ||
          n < this.concurrencyConfig.getMin() ||
          n > this.concurrencyConfig.getMax()
        ) {
          throw new BadRequestException(
            `concurrency must be between ${this.concurrencyConfig.getMin()} and ${this.concurrencyConfig.getMax()}`,
          );
        }
        this.concurrencyConfig.setConcurrency(n);
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
              runId: 'tasks',
              hypothesisId: 'H4',
              location: 'tasks.controller.ts:setConcurrency',
              message: 'setConcurrency called',
              data: { n },
              timestamp: Date.now(),
            }),
          },
        ).catch(() => {});
        // #endregion
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException(
          err instanceof Error ? err.message : 'Invalid concurrency',
        );
      }
    }
    const maxSlots = this.concurrencyConfig.getConcurrency();
    this.logger.log(
      `POST /tasks: submitting ${tasks.length} task(s) [concurrency: ${maxSlots} (max slots)].`,
    );
    await this.tasksService.submitTasks(tasks);
    return new TaskItemResDto(HttpStatus.OK, `Successfully submitted tasks`);
  }
}
