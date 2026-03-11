import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConcurrencyModule } from '../concurrency/concurrency.module';
import { DatabaseModule } from '../database/database.module';
import { TaskQueueModule } from '../task-queue/task-queue.module';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { UploadController } from './upload.controller';
import { UploadJobStore } from './upload-job.store';
import { UploadProcessorService } from './upload-processor.service';

@Module({
  imports: [
    ConcurrencyModule,
    DatabaseModule,
    TypeOrmModule.forFeature([Task]),
    TaskQueueModule,
  ],
  controllers: [TasksController, UploadController],
  providers: [TasksService, UploadJobStore, UploadProcessorService],
})
export class TasksModule {}
