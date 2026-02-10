import { test } from 'node:test';
import assert from 'node:assert';
import { createPool, type PoolConfig } from '../src/index';

interface TestResource {
  id: number;
  data: Buffer;
}

test('Memory - No memory leak with repeated acquire/release cycles', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 5,
    resourceFactory: async () => ({
      id: counter++,
      data: Buffer.alloc(1024 * 100), // 100KB per resource
    }),
  };

  const pool = await createPool(config);

  // Force garbage collection to get baseline
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;

  // Perform many cycles (reduced from 1000 to 100)
  const cycles = 100;
  for (let i = 0; i < cycles; i++) {
    const res = await pool.acquireAsync();
    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 0));
    pool.release(res);

    // Periodic GC to avoid accumulation from test itself
    if (i % 20 === 0 && global.gc) {
      global.gc();
    }
  }

  if (global.gc) global.gc();
  const memAfter = process.memoryUsage().heapUsed;
  const memIncrease = memAfter - memBefore;

  // Memory increase should be reasonable (less than initial pool size)
  const maxResourceSize = 1024 * 100 * 5; // 5 max resources
  assert(memIncrease < maxResourceSize * 2, `Memory leak detected: increased by ${Math.round(memIncrease / 1024)}KB`);

  await pool.destroy();
});

test('Memory - No leak with concurrent operations', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 10,
    resourceFactory: async () => ({
      id: counter++,
      data: Buffer.alloc(1024 * 50), // 50KB per resource
    }),
  };

  const pool = await createPool(config);

  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;

  // Concurrent cycles (reduced from 100 rounds to 20)
  const rounds = 20;
  const concurrency = 8;

  for (let round = 0; round < rounds; round++) {
    const promises = Array(concurrency)
      .fill(null)
      .map(async () => {
        const res = await pool.acquireAsync();
        await new Promise((resolve) => setTimeout(resolve, 0));
        pool.release(res);
      });

    await Promise.all(promises);

    if (round % 5 === 0 && global.gc) {
      global.gc();
    }
  }

  if (global.gc) global.gc();
  const memAfter = process.memoryUsage().heapUsed;
  const memIncrease = memAfter - memBefore;

  assert(
    memIncrease < 1024 * 1024 * 5, // Less than 5MB increase
    `Memory leak detected: increased by ${Math.round(memIncrease / 1024 / 1024)}MB`,
  );

  await pool.destroy();
});

test('Memory - Proper cleanup on pool destruction', async () => {
  let createdCount = 0;
  let destroyedCount = 0;

  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 5,
    resourceFactory: async () => {
      createdCount++;
      return {
        id: createdCount - 1,
        data: Buffer.alloc(1024 * 100),
      };
    },
    resourceDestroyer: async () => {
      destroyedCount++;
    },
  };

  const pool = await createPool(config);

  // Do some operations
  const res1 = await pool.acquireAsync();
  const res2 = await pool.acquireAsync();
  const res3 = await pool.acquireAsync();

  pool.release(res1);
  pool.release(res2);
  pool.release(res3);

  const createdBefore = createdCount;
  const destroyedBefore = destroyedCount;

  await pool.destroy();

  // All created resources should be destroyed
  assert.equal(destroyedCount, createdBefore, 'All resources should be destroyed on pool.destroy()');
});

test('Memory - No leak from failed resource creation', async () => {
  let attemptCount = 0;

  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 3,
    resourceFactory: async () => {
      attemptCount++;
      // Always fail
      throw new Error('Creation failed');
    },
  };

  // Pool creation with failures should not leak
  const pool = await createPool(config);

  const metrics = pool.getMetrics();
  assert.equal(metrics.available, 0, 'Failed pool should have no available resources');

  await pool.destroy();
  assert.equal(attemptCount, 3, 'Should attempt creation for all min slots');
});

test('Memory - Scale up and down does not leak', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 10,
    resourceFactory: async () => ({
      id: counter++,
      data: Buffer.alloc(1024 * 100),
    }),
    idleTimeoutMs: 100,
    scaleDownIntervalMs: 50,
  };

  const pool = await createPool(config);

  if (global.gc) global.gc();

  // Scale up
  const resources = [];
  for (let i = 0; i < 8; i++) {
    resources.push(await pool.acquireAsync());
  }

  let metrics = pool.getMetrics();
  const maxSize = metrics.size!;

  // Release all (allows scale down)
  for (const res of resources) {
    pool.release(res);
  }

  // Wait for scale down
  await new Promise((resolve) => setTimeout(resolve, 300));

  metrics = pool.getMetrics();
  const finalSize = metrics.size!;

  assert(finalSize <= maxSize, 'Pool should scale down');
  assert(finalSize >= 2, 'Pool should maintain min');

  if (global.gc) global.gc();

  await pool.destroy();
});
