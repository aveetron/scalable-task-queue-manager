import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getTypeOrmOptions } from './typeorm.config';

@Module({
  imports: [TypeOrmModule.forRoot(getTypeOrmOptions())],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
