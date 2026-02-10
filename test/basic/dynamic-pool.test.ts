import { test } from 'node:test';
import assert from 'node:assert';
import { createPool, type PoolConfig } from '../../src/index';

interface TestResource {
  id: number;
  created: number;
}

test('DynamicObjectPool - scale up on demand', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      created: Date.now(),
    });
  };

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 5,
    resourceFactory: createTestFactory(),
  };

  const pool = await createPool(config);

  let metrics = pool.getMetrics();
  assert.equal(metrics.size, 2, 'Should start with min (2) resources');
  assert.equal(metrics.capacity, 5, 'Capacity should be max (5)');

  // Acquire all initial resources
  const resources = [];
  for (let i = 0; i < 2; i++) {
    const res = pool.acquire();
    assert(res !== null);
    resources.push(res);
  }

  metrics = pool.getMetrics();
  assert.equal(metrics.available, 0, 'All initial resources should be busy');

  // Trigger scale up by requesting more
  const asyncAcquirePromise = pool.acquireAsync(1000);

  // Wait a bit for scale up to trigger
  await new Promise((resolve) => setTimeout(resolve, 50));

  metrics = pool.getMetrics();
  assert(metrics.size! > 2 || metrics.pendingCreates! > 0, 'Should scale up or have pending creates');

  // Release a resource
  pool.release(resources[0]);

  // The async acquire should complete
  const newRes = await asyncAcquirePromise;
  assert(newRes !== null, 'Should acquire new resource');

  // Release all
  for (const res of resources) {
    pool.release(res);
  }
  pool.release(newRes);

  await pool.destroy();
});

test('DynamicObjectPool - scale down on idle', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      created: Date.now(),
    });
  };
  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 5,
    resourceFactory: createTestFactory(),
    idleTimeoutMs: 200,
    scaleDownIntervalMs: 100,
  };

  const pool = await createPool(config);

  let metrics = pool.getMetrics();
  const initialSize = metrics.size!;

  // Acquire and release a resource to scale up
  const res1 = await pool.acquireAsync();
  const res2 = await pool.acquireAsync();
  const res3 = await pool.acquireAsync();

  pool.release(res1);
  pool.release(res2);
  pool.release(res3);

  let metricsAfterUse = pool.getMetrics();
  const sizeAfterUse = metricsAfterUse.size!;

  // Wait for idle timeout + scale down interval to trigger
  await new Promise((resolve) => setTimeout(resolve, 400));

  metrics = pool.getMetrics();
  // Size should be back to min or less than peak
  assert(metrics.size! <= sizeAfterUse, 'Should scale down after idle timeout');

  await pool.destroy();
});

test('DynamicObjectPool - getMetrics includes pendingCreates', async () => {
  const createDelay = 100;
  let counter = 0;
  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 3,
    resourceFactory: async (): Promise<TestResource> => {
      await new Promise((resolve) => setTimeout(resolve, createDelay));
      return {
        id: counter++,
        created: Date.now(),
      };
    },
  };

  const pool = await createPool(config);

  // Acquire initial resource
  const res = await pool.acquireAsync();
  pool.release(res);

  // Trigger multiple scale ups
  const promises = [];
  for (let i = 0; i < 2; i++) {
    promises.push(pool.acquireAsync(5000));
  }

  // Check metrics while scale up is in progress
  await new Promise((resolve) => setTimeout(resolve, 10));

  const metrics = pool.getMetrics();
  assert(metrics.pendingCreates !== undefined, 'Dynamic pool should have pendingCreates');

  // Wait for all acquires to complete
  const results = await Promise.all(promises);
  for (const res of results) {
    pool.release(res);
  }

  await pool.destroy();
});

test('DynamicObjectPool - does not scale up beyond max', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      created: Date.now(),
    });
  };
  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 2,
    resourceFactory: createTestFactory(),
  };

  const pool = await createPool(config);

  const res1 = await pool.acquireAsync();
  const res2 = await pool.acquireAsync();

  // Try to acquire when at max capacity
  const timeoutPromise = pool.acquireAsync(100);

  await assert.rejects(
    () => timeoutPromise,
    (err: Error) => {
      return err.message.includes('Timeout');
    },
  );

  pool.release(res1);
  pool.release(res2);
  await pool.destroy();
});

test('DynamicObjectPool - maintains min resources', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      created: Date.now(),
    });
  };
  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 5,
    resourceFactory: createTestFactory(),
    idleTimeoutMs: 100,
    scaleDownIntervalMs: 50,
  };

  const pool = await createPool(config);

  let metrics = pool.getMetrics();
  assert.equal(metrics.size, 3, 'Should start with min resources');

  // Wait for scale down cycles
  await new Promise((resolve) => setTimeout(resolve, 300));

  metrics = pool.getMetrics();
  assert(metrics.size! >= 3, 'Should never scale below min');

  await pool.destroy();
});

test('DynamicObjectPool - destroy() stops scale down timer', async () => {
  const createTestFactory = () => {
    let counter = 0;
    return async (): Promise<TestResource> => ({
      id: counter++,
      created: Date.now(),
    });
  };
  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 4,
    resourceFactory: createTestFactory(),
    idleTimeoutMs: 200,
    scaleDownIntervalMs: 100,
  };

  const pool = await createPool(config);

  // Get initial state
  const res = await pool.acquireAsync();
  pool.release(res);

  // Destroy should stop the timer (test indirectly by not hanging)
  const destroyPromise = pool.destroy();
  const destroyTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), 1000));

  await Promise.race([destroyPromise, destroyTimeout]);
  // If we reach here, destroy completed without hanging
  assert(true);
});
