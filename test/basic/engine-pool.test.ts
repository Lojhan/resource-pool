import { test } from 'node:test';
import assert from 'node:assert';
import { createEnginePool } from '../../src/index';

test('EnginePool - basic acquire and release', () => {
  const pool = createEnginePool(3);

  // Acquire all slots
  const idx1 = pool.acquire();
  assert.equal(typeof idx1, 'number', 'Should return a number');
  assert(idx1 >= 0 && idx1 < 3, 'Index should be within pool bounds');

  const idx2 = pool.acquire();
  assert(idx2 !== -1, 'Should acquire second slot');
  assert(idx1 !== idx2, 'Should get different indices');

  const idx3 = pool.acquire();
  assert(idx3 !== -1, 'Should acquire third slot');

  // Pool exhausted
  const idx4 = pool.acquire();
  assert.equal(idx4, -1, 'Should return -1 when pool exhausted');

  let metrics = pool.getMetrics();
  assert.equal(metrics.available, 0, 'No slots should be available');
  assert.equal(metrics.busy, 3, 'All 3 slots should be busy');

  // Release and check
  pool.release(idx1);
  metrics = pool.getMetrics();
  assert.equal(metrics.available, 1, 'One slot should be available after release');
  assert.equal(metrics.busy, 2, 'Two slots should be busy');

  pool.release(idx2);
  pool.release(idx3);
  metrics = pool.getMetrics();
  assert.equal(metrics.available, 3, 'All slots should be available');
  assert.equal(metrics.busy, 0, 'No slots should be busy');

  pool.destroy();
});

test('EnginePool - acquireAsync with successful acquisition', async () => {
  const pool = createEnginePool(2);

  // Both slots available
  const idx1 = await pool.acquireAsync();
  assert.equal(typeof idx1, 'number');

  const idx2 = await pool.acquireAsync();
  assert.equal(typeof idx2, 'number');
  assert(idx1 !== idx2, 'Should get different indices');

  pool.release(idx1);
  pool.release(idx2);
  pool.destroy();
});

test('EnginePool - acquireAsync with timeout', async () => {
  const pool = createEnginePool(1);

  const idx = pool.acquire();
  assert(idx !== -1, 'Should acquire the only slot');

  // Try to acquire when exhausted with timeout
  let timedOut = false;
  try {
    await pool.acquireAsync(100); // 100ms timeout
  } catch (e) {
    if (e instanceof Error && e.message.includes('Timeout')) {
      timedOut = true;
    }
  }

  assert(timedOut, 'Should timeout when no slots available');

  pool.release(idx);
  pool.destroy();
});

test('EnginePool - use method with automatic release', async () => {
  const pool = createEnginePool(2);

  const results: number[] = [];

  const result1 = await pool.use(async (idx) => {
    results.push(idx);
    return idx * 10;
  });

  assert.equal(result1, results[0] * 10, 'Should return function result');

  // Pool should have released the slot
  let metrics = pool.getMetrics();
  assert.equal(metrics.available, 2, 'Slot should be released after use');
  assert.equal(metrics.busy, 0, 'No slots should be busy');

  // Use another slot
  const result2 = await pool.use(async (idx) => {
    return idx * 20;
  });

  assert.equal(typeof result2, 'number', 'Should return result');

  pool.destroy();
});

test('EnginePool - use method with error handling', async () => {
  const pool = createEnginePool(2);

  let errorThrown = false;
  let released = false;

  try {
    await pool.use(async (idx) => {
      throw new Error('Test error');
    });
  } catch (e) {
    errorThrown = true;
  }

  assert(errorThrown, 'Should propagate error');

  // Slot should still be released despite error
  const metrics = pool.getMetrics();
  assert.equal(metrics.available, 2, 'Slot should be released even after error');

  pool.destroy();
});

test('EnginePool - use method with optimistic acquisition', async () => {
  const pool = createEnginePool(1);

  let firstCallOptimistic = false;

  const result = await pool.use(
    async (idx) => {
      firstCallOptimistic = pool.available === 0;
      return idx;
    },
    { optimistic: true },
  );

  assert(typeof result === 'number', 'Should return index');
  assert(firstCallOptimistic, 'Should use optimistic acquisition on available slot');

  pool.destroy();
});

test('EnginePool - use method falls back to async when no slots', async () => {
  const pool = createEnginePool(2);

  // Acquire all slots
  const idx1 = pool.acquire();
  const idx2 = pool.acquire();

  let usedAsync = false;

  // Start a task that will use one of the acquired slots
  const task = pool.use(
    async (idx) => {
      usedAsync = true;
      return idx;
    },
    { timeout: 500 },
  );

  // Release a slot after a short delay
  setTimeout(() => {
    pool.release(idx1);
  }, 50);

  const result = await task;
  assert(usedAsync, 'Should have completed the use task');
  assert(typeof result === 'number', 'Should return index');

  pool.release(idx2);
  pool.destroy();
});

test('EnginePool - metrics', () => {
  const pool = createEnginePool(5);

  let metrics = pool.getMetrics();
  assert.equal(metrics.size, 5, 'Should have correct size');
  assert.equal(metrics.capacity, 5, 'Should have correct capacity');
  assert.equal(metrics.available, 5, 'All should be available initially');
  assert.equal(metrics.busy, 0, 'None should be busy initially');

  const idx1 = pool.acquire();
  const idx2 = pool.acquire();

  metrics = pool.getMetrics();
  assert.equal(metrics.available, 3, 'Should have 3 available');
  assert.equal(metrics.busy, 2, 'Should have 2 busy');

  pool.release(idx1);
  metrics = pool.getMetrics();
  assert.equal(metrics.available, 4, 'Should have 4 available after release');
  assert.equal(metrics.busy, 1, 'Should have 1 busy');

  pool.destroy();
});

test('EnginePool - getter properties', () => {
  const pool = createEnginePool(4);

  assert.equal(pool.size, 4, 'Should have correct size');
  assert.equal(pool.available, 4, 'All should be available');
  assert.equal(pool.numUsed, 0, 'None should be used');
  assert.equal(pool.availableCount(), 4, 'availableCount should match');

  pool.acquire();
  pool.acquire();

  assert.equal(pool.available, 2, 'Should have 2 available');
  assert.equal(pool.numUsed, 2, 'Should have 2 used');
  assert.equal(pool.pendingCount, 0, 'Should have 0 pending');

  pool.destroy();
});

test('EnginePool - stress test with many acquire/release cycles', () => {
  const pool = createEnginePool(10);
  const cycles = 1000;

  for (let i = 0; i < cycles; i++) {
    const idx = pool.acquire();
    if (idx !== -1) {
      pool.release(idx);
    }
  }

  const metrics = pool.getMetrics();
  assert.equal(metrics.available, 10, 'All slots should be available after cycles');

  pool.destroy();
});

test('EnginePool - concurrent use operations', async () => {
  const pool = createEnginePool(3);
  const results: number[] = [];

  // Run 6 concurrent use operations
  const promises = [];
  for (let i = 0; i < 6; i++) {
    promises.push(
      pool.use(async (idx) => {
        results.push(idx);
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return idx;
      }),
    );
  }

  const values = await Promise.all(promises);

  assert.equal(values.length, 6, 'Should complete all operations');
  assert.equal(results.length, 6, 'Should use 6 slots across operations');
  assert.equal(pool.available, 3, 'All slots should be available after');

  pool.destroy();
});
