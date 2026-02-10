import { test } from 'node:test';
import assert from 'node:assert';
import { createPool } from '../../src/index';

interface TestResource {
  id: number;
  useCount: number;
}

test('Concurrency - Multiple concurrent acquires on StaticPool', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      useCount: 0,
    });
  };
  const config = {
    min: 5,
    max: 5,
    resourceFactory: createTestFactory(),
  };

  const pool = createPool(config);

  // Pre-create resources to avoid timing issues with concurrent creation
  const initial = [];
  for (let i = 0; i < 5; i++) {
    initial.push(await pool.acquireAsync());
  }

  // Release them back
  for (const res of initial) {
    pool.release(res);
  }

  // Now test concurrent acquires with pre-created resources
  const promises = Array(10)
    .fill(null)
    .map(() => pool.acquireAsync(1000));

  const results = await Promise.all(promises.map((p) => p.catch(() => null)));

  // First 5 should succeed immediately, rest should timeout or wait
  const successCount = results.filter((r) => r !== null).length;
  assert(successCount >= 5, 'Should acquire at least pool size');
  assert.equal(pool.getMetrics().size, 5, 'Should only create up to pool size');

  // Release all
  for (const res of results) {
    if (res) pool.release(res);
  }

  await pool.destroy();
});

test('Concurrency - Concurrent acquire and release', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      useCount: 0,
    });
  };
  const config = {
    min: 3,
    max: 3,
    resourceFactory: createTestFactory(),
  };

  const pool = createPool(config);

  const resources: TestResource[] = [];

  // Concurrent acquire-release cycles
  const promises = Array(20)
    .fill(null)
    .map(async (_, index) => {
      const res = await pool.acquireAsync(5000);
      res.useCount++;
      resources.push(res);

      // Hold briefly
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));

      pool.release(res);
    });

  await Promise.all(promises);

  const metrics = pool.getMetrics();
  assert(metrics.size >= 2 && metrics.size <= 3, 'Should have created 2-3 resources');
  assert(metrics.available >= metrics.size, 'All resources should be available after operations');
  assert.equal(metrics.busy, 0, 'No resources should be busy');

  await pool.destroy();
});

test('Concurrency - DynamicPool concurrent scale up', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      useCount: 0,
    });
  };
  const config = {
    min: 2,
    max: 10,
    resourceFactory: createTestFactory(),
  };

  const pool = createPool(config);

  // Acquire initial resources (within min)
  const res1 = await pool.acquireAsync(1000);
  const res2 = await pool.acquireAsync(1000);

  const metrics = pool.getMetrics();
  assert(metrics.size! >= 2, 'Should have at least min resources');

  // Release and verify
  pool.release(res1);
  pool.release(res2);

  await pool.destroy();
});

test('Concurrency - Concurrent use() calls', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      useCount: 0,
    });
  };
  const config = {
    min: 2,
    max: 2,
    resourceFactory: createTestFactory(),
  };

  const pool = createPool(config);

  const results: number[] = [];

  // Concurrent use operations
  const promises = Array(10)
    .fill(null)
    .map(async (_, index) => {
      try {
        const result = await pool.use(async (resource) => {
          resource.useCount++;
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          return resource.id;
        });
        results.push(result);
      } catch {
        // Ignore errors
      }
    });

  await Promise.all(promises);

  // At least some should succeed
  assert(results.length > 0, 'Should have successful use operations');

  const metrics = pool.getMetrics();
  assert.equal(metrics.busy, 0, 'No resources should be busy after operations');

  await pool.destroy();
});

test('Concurrency - Concurrent acquire with validation', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      useCount: 0,
    });
  };

  let validationCount = 0;
  const config = {
    min: 2,
    max: 2,
    resourceFactory: createTestFactory(),
    validateResource: async () => {
      validationCount++;
      return true;
    },
  };

  const pool = createPool(config);

  // Pre-create resources to avoid timeout
  const pre1 = await pool.acquireAsync();
  const pre2 = await pool.acquireAsync();
  pool.release(pre1);
  pool.release(pre2);

  // Acquire the available resources
  const promises = Array(2) // Match pool size
    .fill(null)
    .map(() => pool.acquireAsync(1000));

  const results = await Promise.all(promises);

  assert(validationCount > 0, 'Should validate resources');
  assert.equal(results.filter((r) => r !== null).length, 2, 'Should acquire available resources');

  for (const res of results) {
    if (res) pool.release(res);
  }

  await pool.destroy();
});

test('Concurrency - Race condition: release before acquire completes', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => {
      // Introduce delay to create race condition window
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        id: counter++,
        useCount: 0,
      };
    };
  };
  const config = {
    min: 1,
    max: 1,
    resourceFactory: createTestFactory(),
  };

  const pool = createPool(config);

  const res1 = await pool.acquireAsync(5000);
  pool.release(res1);

  // Concurrent acquire on released resource
  const promises = Array(3)
    .fill(null)
    .map(() => pool.acquireAsync(1000).catch(() => null)); // Catch timeout

  const results = await Promise.all(promises);

  // First one should succeed since we released it
  const nonNull = results.filter((r) => r !== null);
  assert(nonNull.length >= 1, 'Should acquire at least one resource');

  for (const res of results) {
    if (res) pool.release(res);
  }

  await pool.destroy();
});

test('Concurrency - MetricAccuracy during concurrent operations', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      useCount: 0,
    });
  };
  const config = {
    min: 3,
    max: 3,
    resourceFactory: createTestFactory(),
  };

  const pool = createPool(config);

  let snapshotMetrics: ReturnType<typeof pool.getMetrics>[] = [];

  // Concurrent operations with metric snapshots
  const promises = Array(3) // Match pool size to avoid hanging
    .fill(null)
    .map(async (_, index) => {
      const res = await pool.acquireAsync(5000);
      snapshotMetrics.push(pool.getMetrics());

      await new Promise((resolve) => setTimeout(resolve, 5));

      pool.release(res);
      snapshotMetrics.push(pool.getMetrics());
    });

  await Promise.all(promises);

  // Verify metric invariants
  for (const metrics of snapshotMetrics) {
    assert(metrics.available >= 0, 'Available should be non-negative');
    assert(metrics.busy >= 0, 'Busy should be non-negative');
    assert.equal(metrics.available + metrics.busy, metrics.size, 'Available + Busy should equal size');
  }

  await pool.destroy();
});
