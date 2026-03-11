import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../database/database.module';
import { Task } from '../tasks/entities/task.entity';
import { MockApiService } from './mock-api.service';
import { TaskConsumerService } from './task-consumer.service';

@Module({
  imports: [DatabaseModule, TypeOrmModule.forFeature([Task])],
  providers: [MockApiService, TaskConsumerService],
})
export class TaskProcessorModule {}
