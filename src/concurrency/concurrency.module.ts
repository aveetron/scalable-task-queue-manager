import { Global, Module } from '@nestjs/common';
import { ConcurrencyConfigService } from './concurrency-config.service';

@Global()
@Module({
  providers: [ConcurrencyConfigService],
  exports: [ConcurrencyConfigService],
})
export class ConcurrencyModule {}
