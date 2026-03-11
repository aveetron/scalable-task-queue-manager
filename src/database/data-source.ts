import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';

/**
 * DataSource for TypeORM CLI (migrations).
 * Do not use in application code; use DatabaseModule / TypeORM in Nest instead.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
  username: process.env.POSTGRES_USER ?? 'admin',
  password: process.env.POSTGRES_PASSWORD ?? 'password',
  database: process.env.POSTGRES_DB ?? 'task_queue_management_system',
  entities: [path.join(__dirname, '../tasks/entities/**/*.entity{.ts,.js}')],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
  synchronize: false,
});
