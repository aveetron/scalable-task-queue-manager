/**
 * RabbitMQ queue names, exchanges and options for the task queue management system.
 * Connection URL is built from env: RABBITMQ_HOST, RABBITMQ_PORT, RABBITMQ_VHOST,
 * RABBITMQ_DEFAULT_USER, RABBITMQ_DEFAULT_PASS.
 */

// Queue names
export const TASK_QUEUE = 'task_queue';
export const TASK_RETRY_QUEUE = 'task_retry_queue';
export const TASK_DLQ = 'task_dlq';

// Exchange names
export const TASK_EXCHANGE = 'task_exchange';
export const TASK_DLX = 'task_dlx';

// Routing keys
export const TASK_ROUTING_KEY = 'task';
export const TASK_DLQ_ROUTING_KEY = 'dead';

// Base queue options
const durable = { durable: true } as const;

// Main queue: receives new tasks. Nack(requeue=false) sends to DLX.
export const TASK_QUEUE_OPTIONS = {
  ...durable,
  arguments: {
    deadLetterExchange: TASK_DLX,
    deadLetterRoutingKey: TASK_DLQ_ROUTING_KEY,
  },
};

// Retry queue: 500-failed tasks. Nack(requeue=false) or TTL expiry sends to DLX.
export const TASK_RETRY_QUEUE_OPTIONS = {
  ...durable,
  arguments: {
    deadLetterExchange: TASK_DLX,
    deadLetterRoutingKey: TASK_DLQ_ROUTING_KEY,
  },
};

// DLQ: no special options, just durable
export const TASK_DLQ_OPTIONS = durable;

// Exchange options (durable so they survive broker restart)
export const TASK_EXCHANGE_OPTIONS = { durable: true };
export const TASK_DLX_OPTIONS = { durable: true };

export const rabbitMQQueues = {
  main: { name: TASK_QUEUE, options: TASK_QUEUE_OPTIONS },
  retry: { name: TASK_RETRY_QUEUE, options: TASK_RETRY_QUEUE_OPTIONS },
  dlq: { name: TASK_DLQ, options: TASK_DLQ_OPTIONS },
} as const;

export const rabbitMQExchanges = {
  main: {
    name: TASK_EXCHANGE,
    type: 'direct' as const,
    options: TASK_EXCHANGE_OPTIONS,
  },
  dlx: {
    name: TASK_DLX,
    type: 'direct' as const,
    options: TASK_DLX_OPTIONS,
  },
} as const;

/**
 * Build RabbitMQ connection URL from environment variables.
 * Use after ConfigModule has loaded (process.env is populated from .env).
 */
export function getRabbitMQConnectionUrl(): string {
  const host = process.env.RABBITMQ_HOST ?? 'localhost';
  const port = process.env.RABBITMQ_PORT ?? '5672';
  const vhost = process.env.RABBITMQ_VHOST ?? '/';
  const user = process.env.RABBITMQ_DEFAULT_USER ?? 'admin';
  const password = process.env.RABBITMQ_DEFAULT_PASS ?? 'password';
  const encodedVhost = encodeURIComponent(vhost);
  return `amqp://${user}:${encodeURIComponent(password)}@${host}:${port}/${encodedVhost}`;
}
