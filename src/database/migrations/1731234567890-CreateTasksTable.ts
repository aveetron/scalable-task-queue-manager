import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTasksTable1731234567890 implements MigrationInterface {
  name = 'CreateTasksTable1731234567890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" varchar(255) NOT NULL,
        "payload" jsonb NOT NULL,
        "statusCode" smallint DEFAULT NULL,
        "totalRetries" smallint NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tasks"`);
  }
}
