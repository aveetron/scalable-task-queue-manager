import { Injectable } from '@nestjs/common';
import * as os from 'os';

const MIN_CONCURRENCY = 1;
const DEFAULT_ENV = '2';

@Injectable()
export class ConcurrencyConfigService {
  private override: number | null = null;
  private readonly maxConcurrency = Math.max(1, os.cpus().length * 2);

  /**
   * Returns current concurrency: override if set, otherwise env (TASK_CONCURRENCY or CONCURRENCY).
   */
  getConcurrency(): number {
    const envValue = parseInt(
      process.env.TASK_CONCURRENCY ?? process.env.CONCURRENCY ?? DEFAULT_ENV,
      10,
    );
    const envResult = Math.max(
      MIN_CONCURRENCY,
      Number.isNaN(envValue) ? 2 : envValue,
    );
    const result = this.override != null ? this.override : envResult;
    return result;
  }

  /**
   * Sets runtime concurrency override (1 to machine cores × 2). Resets on process restart.
   */
  setConcurrency(n: number): void {
    const parsed = typeof n === 'number' ? n : parseInt(String(n), 10);
    const max = this.getMax();
    if (Number.isNaN(parsed) || parsed < MIN_CONCURRENCY || parsed > max) {
      throw new Error(
        `Concurrency must be between ${MIN_CONCURRENCY} and ${max} (machine cores × 2). Got: ${n} `,
      );
    }
    this.override = Math.floor(parsed);
    // #region agent log
    fetch('http://127.0.0.1:7371/ingest/e6a15b32-9a21-4a30-acf2-f92bcc1033d6', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '4a760a',
      },
      body: JSON.stringify({
        sessionId: '4a760a',
        hypothesisId: 'setConcurrency',
        location: 'concurrency-config.service.ts:setConcurrency',
        message: 'setConcurrency called',
        data: { n: parsed, overrideNow: this.override },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }

  /** Exposed for validation in controllers (min/max). */
  getMin(): number {
    return MIN_CONCURRENCY;
  }

  /** Max concurrency is machine CPU cores × 2. */
  getMax(): number {
    return this.maxConcurrency;
  }
}
