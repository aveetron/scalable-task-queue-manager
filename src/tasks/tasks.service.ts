import { Injectable } from '@nestjs/common';
import { TaskQueueService } from '../task-queue/task-queue.service';
import { TaskItemReqDto } from './dto/task-item-req.dto';

@Injectable()
export class TasksService {
  constructor(private readonly taskQueueService: TaskQueueService) {}

  /**
   * Dedupe by id within the request, then publish to the task queue.
   */
  public async submitTasks(tasks: TaskItemReqDto[]): Promise<void> {
    // Deduplicate by id within the request.
    const seen = new Set<string>();
    // Filter out duplicates. We don't need to check for duplicates in the database
    // because the task queue will deduplicate them.
    const deduped: TaskItemReqDto[] = [];
    for (const task of tasks) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      deduped.push(task);
    }
    await this.taskQueueService.publishMany(deduped);
  }
}
