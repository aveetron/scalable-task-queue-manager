# Task Queue Management System

A NestJS application that processes tasks via a queue: clients submit tasks (JSON payloads), a mock API returns 200/400/500, and the system handles retries (500, up to 2 retries), persistence in PostgreSQL, and optional scaling with multiple workers.

---

## Architecture

The system has four main parts: **API**, **queue (producer)**, **processor (consumer)**, and **shared storage**.

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     NestJS application                     │
                    │  ┌─────────────┐    ┌──────────────────┐    ┌───────────┐ │
  POST /tasks        │  │   Tasks     │───▶│  Task Queue      │    │   Task    │ │
  (JSON array)     │  │   Module    │    │  (Producer)      │    │ Processor │ │
                    │  │  (API +     │    │  publish to       │───▶│ (Consumer)│ │
                    │  │   dedup)    │    │  RabbitMQ         │    │ mock API  │ │
                    │  └─────────────┘    └──────────────────┘    │ retry/DB  │ │
                    │         │                     │              └─────┬─────┘ │
                    └─────────┼─────────────────────┼───────────────────┼───────┘
                              │                     │                   │
                              ▼                     ▼                   ▼
                    ┌─────────────────┐   ┌─────────────┐    ┌─────────────────┐
                    │   PostgreSQL    │   │  RabbitMQ    │    │   PostgreSQL    │
                    │   (optional      │   │  main queue  │    │   tasks table   │
                    │   for API)       │   │  retry queue │    │   (status,      │
                    │                 │   │  DLQ         │    │    retries)     │
                    └─────────────────┘   └─────────────┘    └─────────────────┘
```

- **Tasks module:** Accepts `POST /tasks` with a JSON array of `{ id, payload }`. Deduplicates by `id` within the request and publishes to RabbitMQ.
- **Task queue (producer):** Connects to RabbitMQ, declares exchanges and queues (main, retry, DLQ), and publishes each task to the main queue.
- **Task processor (consumer):** Consumes from the main and retry queues. For each message: checks DB for already-completed (200) to avoid duplicates, calls the mock API, then either acks, republishes to retry (500, &lt; 2 retries), or marks done in DB (200/400 or 500 after max retries). Uses `TASK_CONCURRENCY` (prefetch) for in-process parallelism.
- **PostgreSQL:** Stores task results (id, payload, statusCode, totalRetries) for idempotency and auditing. All workers share the same DB.
- **RabbitMQ:** Main queue for new tasks, retry queue for 500s, DLQ for dead letters. Multiple app instances consume from the same queues; the broker distributes messages.

**Flow:** Client → POST /tasks → Tasks module → Task queue service → RabbitMQ (main queue) → Task consumer → mock API → DB upsert → ack / retry / DLQ as per rules.

---

## Prerequisites

- Node.js 20+
- Yarn (or npm)
- RabbitMQ (e.g. via Docker)
- PostgreSQL 14+ (e.g. via Docker)

---

## Project setup

```bash
yarn install
cp .env.example .env
# Edit .env with your RabbitMQ and PostgreSQL settings.
```

**Configuration (.env):**

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP server port (default 3000). |
| `TASK_CONCURRENCY` | Max tasks processed in parallel per worker (e.g. 2). |
| `WORKER_ID` | Optional; identifies this instance in logs when running multiple workers. |
| `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_VHOST`, `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS` | RabbitMQ connection. |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | PostgreSQL connection. |

---

## Run locally

**1. Start RabbitMQ and PostgreSQL (e.g. with Docker Compose):**

```bash
docker compose up -d rabbitmq postgres
```

**2. Run migrations:**

```bash
yarn migration:run
```

**3. Start the application:**

```bash
# Development (watch mode)
yarn start:dev

# Or production build then run
yarn build && yarn start:prod
```

The app will connect to RabbitMQ and PostgreSQL, create queues/exchanges if needed, and start consuming. Submit tasks with `POST /tasks` (see API below).

**Quick run (migrations + dev server):**

```bash
make dev
```

---

## API

- **POST /tasks**  
  Body: JSON array of task objects: `{ "id": "task-1", "payload": { "type": "email", "to": "user@example.com" } }`.  
  Responds 200 on success. Max 10,000 tasks per request; for larger batches use `POST /tasks/upload`. Tasks are deduplicated by `id` within the request and published to the queue.

- **POST /tasks/upload**  
  Body: Either a **single JSON array** of tasks (e.g. `[{ "id": "task-1", "payload": {...} }, ...]`, including pretty-printed) or **NDJSON** (one JSON object per line), e.g. `{"id":"task-1","payload":{...}}\n{"id":"task-2","payload":{...}}\n`.  
  Responds **202 Accepted** with `{ "jobId": "<uuid>", "message": "Upload accepted. Processing in background." }`. The server streams the body to a temp file and processes it in the background in chunks (publishes to the queue without blocking the client). Use for 200k–2M tasks. JSON array format is loaded into memory (max 150MB); for larger files use NDJSON. Max body size configurable via `UPLOAD_MAX_BYTES` (default 1GB).

- **GET /tasks/jobs/:id**  
  Returns the status of an upload job: `{ "jobId": "<id>", "status": "processing" | "completed" | "failed", "totalTasks": <n>, "error": "<message>" }`.

- **GET /health**  
  Returns 200 and `{ "status": "ok" }` if the app can reach PostgreSQL; otherwise 503.

---

## Deployment guidelines

### General

- All instances (workers) must use the **same RabbitMQ** (same host, vhost) and the **same PostgreSQL** database.
- Run migrations once before or when deploying the first instance (e.g. `yarn migration:run` or a one-off migration job).
- Set env vars per environment (see Configuration above). For Docker, use service names for hosts (e.g. `RABBITMQ_HOST=rabbitmq`, `POSTGRES_HOST=postgres`).
- **Throughput:** Total concurrent tasks ≈ `number_of_workers × TASK_CONCURRENCY` until RabbitMQ or PostgreSQL becomes the bottleneck.

### Docker (single service)

Build and run the app container with env pointing to your RabbitMQ and PostgreSQL:

```bash
docker build -t task-queue-app .
docker run --rm -e RABBITMQ_HOST=host.docker.internal -e POSTGRES_HOST=host.docker.internal \
  -e POSTGRES_USER=... -e POSTGRES_PASSWORD=... -e POSTGRES_DB=... task-queue-app
```

Run migrations from host or a one-off container with the same DB env.

### Docker Compose (app + infra)

From the repo root, start infrastructure and the app (one replica):

```bash
docker compose up -d
```

To run **multiple workers**, scale the app:

```bash
docker compose up -d --scale app=3
```

Each replica is one worker. Ensure migrations have been run (e.g. `yarn migration:run` from host with same DB settings) before or when bringing up the app.

### Kubernetes (or similar)

- Use the same image and env (RabbitMQ and PostgreSQL hostnames as per your cluster).
- Run migrations as a Job or init container if needed.
- Deploy the app with `replicas: 3` (or more) so multiple workers consume from the same queues. Optionally set `WORKER_ID` via pod name or a downward API so logs are identifiable.
- Use `GET /health` for liveness/readiness if desired.

### Scaling / distributed workers

- Run N instances of the same application (same code, same RabbitMQ and PostgreSQL).
- No code change is required: each instance opens its own connection and consumes from the same queues; RabbitMQ delivers each message to one consumer.
- Duplicate handling is DB-based (skip if task id already has statusCode 200).
- **Multiple processes on one machine:** Start with different `PORT` and optional `WORKER_ID`, e.g. `PORT=3001 WORKER_ID=worker-1 node dist/main.js` and `PORT=3002 WORKER_ID=worker-2 node dist/main.js` (same `.env` otherwise).

---

## Scripts

| Command | Description |
|---------|-------------|
| `yarn build` | Compile the application. |
| `yarn start` | Start once. |
| `yarn start:dev` | Start in watch mode. |
| `yarn start:prod` | Run compiled app (e.g. `node dist/main`). |
| `yarn migration:run` | Run TypeORM migrations. |
| `yarn migration:revert` | Revert last migration. |
| `yarn test` | Unit tests. |
| `yarn test:e2e` | E2E tests. |
| `make dev` | Run migrations then `yarn start:dev`. |

---

## License

UNLICENSED (see `package.json`).
