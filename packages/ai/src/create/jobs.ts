/**
 * In-memory create jobs: an event log per job (replayed to late or reconnecting viewers), live
 * subscribers, cancellation, and the article paragraphs
 * for the reader pane (discarded after the job; the article text is never stored).
 */
import { isTerminalEvent, type JobEvent } from "@learncroc/core";
import type { Article } from "./extract";

export interface Job {
  id: string;
  packId: string;
  events: JobEvent[];
  controller: AbortController;
  finished: boolean;
  createdAt: number;
  article?: Article;
}

type Listener = (e: JobEvent) => void;

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    /** Finished jobs (and their article text) are forgotten after this long. */
    private readonly keepMs = 10 * 60_000,
  ) {}

  create(packId: string): Job {
    this.sweep();
    const id = `job-${this.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const job: Job = {
      id,
      packId,
      events: [],
      controller: new AbortController(),
      finished: false,
      createdAt: this.now(),
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  emit(id: string, e: JobEvent): void {
    const job = this.jobs.get(id);
    if (!job || job.finished) return;
    job.events.push(e);
    if (isTerminalEvent(e)) {
      job.finished = true;
      delete job.article;
    }
    for (const l of this.listeners.get(id) ?? []) {
      try {
        l(e);
      } catch {
        // A broken viewer must never break the job.
      }
    }
  }

  /** Replay past events, then follow live ones. Returns an unsubscribe function. */
  subscribe(id: string, l: Listener): () => void {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    for (const e of job.events) {
      try {
        l(e);
      } catch {
        return () => {};
      }
    }
    if (job.finished) return () => {};
    const set = this.listeners.get(id) ?? new Set();
    set.add(l);
    this.listeners.set(id, set);
    return () => set.delete(l);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (!job.finished) job.controller.abort();
    return true;
  }

  active(): Job[] {
    return [...this.jobs.values()].filter((j) => !j.finished);
  }

  private sweep(): void {
    const cutoff = this.now() - this.keepMs;
    for (const [id, job] of this.jobs) {
      if (job.finished && job.createdAt < cutoff) {
        this.jobs.delete(id);
        this.listeners.delete(id);
      }
    }
  }
}
