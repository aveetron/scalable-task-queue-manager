import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import {
  getRabbitMQConnectionUrl,
  rabbitMQExchanges,
  rabbitMQQueues,
  TASK_DLQ_ROUTING_KEY,
  TASK_EXCHANGE,
  TASK_ROUTING_KEY,
} from '../config/rabbitmq.config';

export interface TaskMessage {
  id: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class TaskQueueService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;

  async onModuleInit(): Promise<void> {
    const url = getRabbitMQConnectionUrl();
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();

    // Exchanges
    await this.channel.assertExchange(
      rabbitMQExchanges.main.name,
      rabbitMQExchanges.main.type,
      rabbitMQExchanges.main.options,
    );
    await this.channel.assertExchange(
      rabbitMQExchanges.dlx.name,
      rabbitMQExchanges.dlx.type,
      rabbitMQExchanges.dlx.options,
    );

    // Queues: main, retry, DLQ
    await this.channel.assertQueue(
      rabbitMQQueues.main.name,
      rabbitMQQueues.main.options,
    );
    await this.channel.assertQueue(
      rabbitMQQueues.retry.name,
      rabbitMQQueues.retry.options,
    );
    await this.channel.assertQueue(
      rabbitMQQueues.dlq.name,
      rabbitMQQueues.dlq.options,
    );

    // Bind main queue to task exchange so published messages are routed
    await this.channel.bindQueue(
      rabbitMQQueues.main.name,
      TASK_EXCHANGE,
      TASK_ROUTING_KEY,
    );
    // Bind DLQ to dead letter exchange (messages nack'd from main/retry use this key)
    await this.channel.bindQueue(
      rabbitMQQueues.dlq.name,
      rabbitMQExchanges.dlx.name,
      TASK_DLQ_ROUTING_KEY,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  /**
   * Publish tasks to the task exchange; they are routed to the main queue.
   */
  async publishMany(tasks: TaskMessage[]): Promise<void> {
    // Check if the channel is initialized.
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }
    for (const task of tasks) {
      // Convert to JSON string and buffer for publishing.
      const message = Buffer.from(JSON.stringify(task));
      // Publish to the task exchange.
      this.channel.publish(TASK_EXCHANGE, TASK_ROUTING_KEY, message, {
        persistent: true,
      });
    }
  }
}
