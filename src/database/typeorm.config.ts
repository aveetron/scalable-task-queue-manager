import * as path from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * TypeORM options built from environment variables.
 * Used by DatabaseModule (AppModule) and by data-source.ts for CLI migrations.
 */
export function getTypeOrmOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(env.POSTGRES_PORT ?? '5432', 10),
    username: env.POSTGRES_USER ?? 'admin',
    password: env.POSTGRES_PASSWORD ?? 'password',
    database: env.POSTGRES_DB ?? 'task_queue_management_system',
    entities: [path.join(__dirname, '../tasks/entities/**/*.entity{.ts,.js}')],
    migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
    synchronize: false,
    logging: env.NODE_ENV === 'development',
  };
}
