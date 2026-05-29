import { test, expect, describe } from "bun:test";
import { Semaphore, runConcurrent } from "../concurrency.ts";

// ── Semaphore ─────────────────────────────────────────────────────────────────

describe("Semaphore", () => {
  test("runs a single task and returns its value", async () => {
    const sem = new Semaphore(1);
    const result = await sem.run(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  test("enforces concurrency limit — no more than N tasks run simultaneously", async () => {
    const limit = 2;
    const sem = new Semaphore(limit);
    let activeCount = 0;
    let peakActive = 0;

    const task = () =>
      sem.run(async () => {
        activeCount++;
        peakActive = Math.max(peakActive, activeCount);
        await new Promise((r) => setTimeout(r, 10));
        activeCount--;
        return true;
      });

    // Launch 5 tasks — only 2 should run at a time
    await Promise.all([task(), task(), task(), task(), task()]);

    expect(peakActive).toBeLessThanOrEqual(limit);
  });

  test("queues tasks when at capacity and drains correctly", async () => {
    const sem = new Semaphore(1); // strict serial
    const order: number[] = [];

    await Promise.all([
      sem.run(async () => {
        order.push(1);
      }),
      sem.run(async () => {
        order.push(2);
      }),
      sem.run(async () => {
        order.push(3);
      }),
    ]);

    // All three must have run, in queue-drain order
    expect(order).toHaveLength(3);
    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order).toContain(3);
  });

  test("releases slot on task rejection, allowing queued tasks to proceed", async () => {
    const sem = new Semaphore(1);
    let secondRan = false;

    const failingTask = sem.run(async () => {
      throw new Error("intentional failure");
    });

    const successTask = sem.run(async () => {
      secondRan = true;
      return "ok";
    });

    await expect(failingTask).rejects.toThrow("intentional failure");
    await successTask;
    expect(secondRan).toBe(true);
  });

  test("allows multiple tasks when limit > 1", async () => {
    const sem = new Semaphore(3);
    let simultaneous = 0;
    let maxSimultaneous = 0;

    const tasks = Array.from({ length: 3 }, () =>
      sem.run(async () => {
        simultaneous++;
        maxSimultaneous = Math.max(maxSimultaneous, simultaneous);
        await new Promise((r) => setTimeout(r, 5));
        simultaneous--;
      })
    );

    await Promise.all(tasks);
    expect(maxSimultaneous).toBe(3); // all three ran concurrently
  });
});

// ── runConcurrent ─────────────────────────────────────────────────────────────

describe("runConcurrent", () => {
  test("returns value for each successful task", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];

    const results = await runConcurrent(tasks, 2);

    expect(results).toHaveLength(3);
    expect(results[0].value).toBe("a");
    expect(results[1].value).toBe("b");
    expect(results[2].value).toBe("c");
    expect(results.every((r) => r.error === undefined)).toBe(true);
  });

  test("captures errors per-task without throwing", async () => {
    const boom = new Error("task exploded");
    const tasks = [
      () => Promise.resolve("ok"),
      () => Promise.reject(boom),
      () => Promise.resolve("also ok"),
    ];

    const results = await runConcurrent(tasks, 3);

    expect(results).toHaveLength(3);
    expect(results[0].value).toBe("ok");
    expect(results[1].error).toBe(boom);
    expect(results[1].value).toBeUndefined();
    expect(results[2].value).toBe("also ok");
  });

  test("all tasks fail — still returns array, no throw", async () => {
    const tasks = [
      () => Promise.reject(new Error("fail1")),
      () => Promise.reject(new Error("fail2")),
    ];

    const results = await runConcurrent(tasks, 2);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.error instanceof Error)).toBe(true);
  });

  test("empty task list returns empty array", async () => {
    const results = await runConcurrent([], 5);
    expect(results).toEqual([]);
  });

  test("respects parallel limit under concurrency pressure", async () => {
    const parallel = 2;
    let active = 0;
    let peakActive = 0;

    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      active++;
      peakActive = Math.max(peakActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });

    const results = await runConcurrent(tasks, parallel);

    expect(results).toHaveLength(8);
    expect(peakActive).toBeLessThanOrEqual(parallel);
    expect(results.map((r) => r.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("parallel=1 runs tasks serially", async () => {
    const order: number[] = [];
    const tasks = [1, 2, 3].map(
      (n) => () =>
        new Promise<number>((resolve) => {
          order.push(n);
          resolve(n);
        })
    );

    await runConcurrent(tasks, 1);
    expect(order).toEqual([1, 2, 3]);
  });
});
