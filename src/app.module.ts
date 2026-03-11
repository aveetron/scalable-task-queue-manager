import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConcurrencyModule } from './concurrency/concurrency.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TaskProcessorModule } from './task-processor/task-processor.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ConcurrencyModule,
    DatabaseModule,
    HealthModule,
    TasksModule,
    TaskProcessorModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
