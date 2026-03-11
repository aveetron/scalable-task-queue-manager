import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TaskItemReqDto } from './dto/task-item-req.dto';
import { ValidateTasksArrayPipe } from './pipes/validate-tasks-array.pipe';
import { TasksService } from './tasks.service';
import { TaskItemResDto } from './dto/task-item-res.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * Upload tasks for processing.
   * Body: JSON array of { id, payload } (see spec example).
   */
  @Post('/')
  @HttpCode(HttpStatus.OK)
  public async submit(
    @Body(ValidateTasksArrayPipe) tasks: TaskItemReqDto[],
  ): Promise<TaskItemResDto> {
    await this.tasksService.submitTasks(tasks);
    return new TaskItemResDto(HttpStatus.OK, `Successfully submitted tasks`);
  }
}
