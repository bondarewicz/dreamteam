/**
 * concurrency.ts — Promise-based semaphore for parallel execution
 *
 * Simple semaphore with no external dependencies.
 * Default concurrency = 10 (overridable via --parallel N).
 */

export class Semaphore {
  private limit: number;
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * Run all tasks with a concurrency limit.
 * Errors are caught per-task and returned as rejected items in the results array.
 */
export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  parallel: number
): Promise<Array<{ value?: T; error?: unknown }>> {
  const sem = new Semaphore(parallel);
  return Promise.all(
    tasks.map(async (task) => {
      try {
        const value = await sem.run(task);
        return { value };
      } catch (error) {
        return { error };
      }
    })
  );
}
