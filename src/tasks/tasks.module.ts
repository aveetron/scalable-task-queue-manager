import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../database/database.module';
import { TaskQueueModule } from '../task-queue/task-queue.module';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([Task]), TaskQueueModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
