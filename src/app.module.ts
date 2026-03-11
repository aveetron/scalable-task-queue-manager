import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { TaskProcessorModule } from './task-processor/task-processor.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    TasksModule,
    TaskProcessorModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
