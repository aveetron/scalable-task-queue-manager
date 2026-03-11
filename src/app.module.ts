import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConcurrencyModule } from './concurrency/concurrency.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { TaskProcessorModule } from './task-processor/task-processor.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => [
        {
          ttl:
            parseInt(config.get('THROTTLE_TTL_MS') ?? '60000', 10) || 60000,
          limit: parseInt(config.get('THROTTLE_LIMIT') ?? '100', 10) || 100,
        },
      ],
      inject: [ConfigService],
    }),
    ConcurrencyModule,
    DatabaseModule,
    HealthModule,
    TasksModule,
    TaskProcessorModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
