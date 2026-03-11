import { Injectable } from '@nestjs/common';

export interface UploadJobStatus {
  status: 'processing' | 'completed' | 'failed';
  totalTasks?: number;
  error?: string;
}

@Injectable()
export class UploadJobStore {
  private readonly jobs = new Map<string, UploadJobStatus>();

  set(jobId: string, status: UploadJobStatus): void {
    this.jobs.set(jobId, status);
  }

  get(jobId: string): UploadJobStatus | undefined {
    return this.jobs.get(jobId);
  }
}
