import { test } from 'node:test';
import assert from 'node:assert';
import { createPool, type PoolConfig } from '../../src/index';

interface TestResource {
  id: number;
  healthy: boolean;
  destroyed: boolean;
}

test('Feature - Resource validation in StaticObjectPool', async () => {
  let counter = 0;
  let validationCalls = 0;

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 2,
    resourceFactory: async () => ({
      id: counter++,
      healthy: true,
      destroyed: false,
    }),
    validateResource: async (resource) => {
      validationCalls++;
      return resource.healthy;
    },
  };

  const pool = await createPool(config);

  const res = await pool.acquireAsync();
  assert(res !== null, 'Should acquire resource');
  assert(res.healthy, 'Resource should be healthy');
  assert(validationCalls > 0, 'Should validate resource');

  pool.release(res);
  await pool.destroy();
});

test('Feature - Invalid resource replacement in StaticObjectPool', async () => {
  let counter = 0;
  let recreationCount = 0;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: async () => {
      recreationCount++;
      return {
        id: counter++,
        healthy: recreationCount > 1, // Second attempt is healthy
        destroyed: false,
      };
    },
    validateResource: async (resource) => {
      return resource.healthy;
    },
  };

  const pool = await createPool(config);

  // First acquire - should get unhealthy resource and recreate it
  const res1 = await pool.acquireAsync();
  assert(res1.healthy, 'Resource should be replaced to be healthy');
  assert.equal(res1.id, 1, 'Should have recreated resource with new id');
  assert(recreationCount >= 2, 'Factory should be called twice');

  pool.release(res1);
  await pool.destroy();
});

test('Feature - Invalid resource replacement in DynamicObjectPool', async () => {
  let counter = 0;
  let destroyCount = 0;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 2,
    resourceFactory: async () => ({
      id: counter++,
      healthy: false,
      destroyed: false,
    }),
    validateResource: async (resource) => {
      // First resource is always invalid, subsequent ones are valid
      return resource.id > 0;
    },
    resourceDestroyer: async (resource) => {
      destroyCount++;
      resource.destroyed = true;
    },
  };

  const pool = await createPool(config);

  // Should recreate invalid resource
  const res = await pool.acquireAsync();
  assert(res.healthy || res.id > 0, 'Should have recreated resource');
  assert(destroyCount > 0, 'Should destroy invalid resource');

  pool.release(res);
  await pool.destroy();
});

test('Feature - Custom resource destroyer', async () => {
  const destroyedResources: number[] = [];

  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 3,
    resourceFactory: async () => ({
      id: Math.random(),
      healthy: true,
      destroyed: false,
    }),
    resourceDestroyer: async (resource) => {
      destroyedResources.push(Math.floor(resource.id * 1000));
      resource.destroyed = true;
    },
  };

  const pool = await createPool(config);
  await pool.destroy();

  // Note: We can't exactly match IDs due to floating point, but we can check count
  assert.equal(destroyedResources.length, 3, 'Destroyer should be called for each resource');
});

test('Feature - acquireAsync with timeout override default', async () => {
  let counter = 0;
  const defaultTimeout = 1000;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    acquireTimeoutMs: defaultTimeout,
    resourceFactory: async () => ({
      id: counter++,
      healthy: true,
      destroyed: false,
    }),
  };

  const pool = await createPool(config);

  // Acquire the single resource
  const res = await pool.acquireAsync();

  // Try to acquire with shorter timeout override
  const startTime = Date.now();
  await assert.rejects(
    () => pool.acquireAsync(100), // Override with 100ms
    (err: Error) => {
      const elapsed = Date.now() - startTime;
      // Should timeout around 100ms, not 1000ms
      assert(elapsed < 500, 'Should timeout quickly with override');
      return err.message.includes('Timeout');
    },
  );

  pool.release(res);
  await pool.destroy();
});

test('Feature - use() with custom timeout', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: async () => ({
      id: counter++,
      healthy: true,
      destroyed: false,
    }),
  };

  const pool = await createPool(config);

  const result = await pool.use(
    async (resource) => {
      return resource.id;
    },
    500, // Custom timeout
  );

  assert.equal(typeof result, 'number', 'use() should return function result');

  await pool.destroy();
});

test('Feature - Sync acquire returns null when exhausted', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: async () => ({
      id: counter++,
      healthy: true,
      destroyed: false,
    }),
  };

  const pool = await createPool(config);

  const res = pool.acquire();
  assert(res !== null, 'Should acquire resource');

  const nullRes = pool.acquire();
  assert.equal(nullRes, null, 'Should return null when exhausted');

  pool.release(res);
  const res2 = pool.acquire();
  assert(res2 !== null, 'Should acquire after release');

  pool.release(res2);
  await pool.destroy();
});

test('Feature - Validation can throw (error is ignored)', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: async () => ({
      id: counter++,
      healthy: true,
      destroyed: false,
    }),
    validateResource: async () => {
      throw new Error('Validation crashed');
    },
  };

  const pool = await createPool(config);

  // Should not throw, validation error is caught
  const res = await pool.acquireAsync();
  assert(res !== null, 'Should acquire despite validation error');

  pool.release(res);
  await pool.destroy();
});

test('Feature - Destroyer errors propagate on destroy', async () => {
  let counter = 0;

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: async () => ({
      id: counter++,
      healthy: true,
      destroyed: false,
    }),
    resourceDestroyer: async () => {
      throw new Error('Destroy failed');
    },
  };

  const pool = await createPool(config);

  // Destroy will fail if destroyer throws
  await assert.rejects(
    async () => {
      await pool.destroy();
    },
    (err: Error) => {
      return err.message.includes('Destroy failed');
    },
  );
});
