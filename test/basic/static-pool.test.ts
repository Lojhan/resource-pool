import { test } from 'node:test'
import assert from 'node:assert'
import { createPool, type PoolConfig } from '../../src/index'

interface TestResource {
  id: number
  value: string
}

test('StaticObjectPool - acquire and release', async () => {
  const createTestFactory = () => {
    let counter = 0
    return async (): Promise<TestResource> => ({
      id: counter++,
      value: `resource-${counter}`,
    })
  }

  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 3,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)

  // Acquire all resources
  const res1 = pool.acquire()
  assert(res1 !== null, 'Should acquire first resource')
  assert(typeof res1.id === 'number', 'Resource should have numeric id')

  const res2 = pool.acquire()
  assert(res2 !== null, 'Should acquire second resource')
  assert(res1.id !== res2.id, 'Should get different resources')

  const res3 = pool.acquire()
  assert(res3 !== null, 'Should acquire third resource')

  // Pool exhausted
  const res4 = pool.acquire()
  assert.equal(res4, null, 'Should return null when pool exhausted')

  let metrics = pool.getMetrics()
  assert.equal(metrics.available, 0, 'No resources should be available')
  assert.equal(metrics.busy, 3, 'All 3 resources should be busy')

  // Release and check
  pool.release(res1)
  metrics = pool.getMetrics()
  assert.equal(metrics.available, 1, 'One resource should be available after release')
  assert.equal(metrics.busy, 2, 'Two resources should be busy')

  pool.release(res2)
  pool.release(res3)
  metrics = pool.getMetrics()
  assert.equal(metrics.available, 3, 'All resources should be available')
  assert.equal(metrics.busy, 0, 'No resources should be busy')

  await pool.destroy()
})

test('StaticObjectPool - acquireAsync with timeout', async () => {
  const createTestFactory = () => {
    let counter = 0
    return async (): Promise<TestResource> => ({
      id: counter++,
      value: `resource-${counter}`,
    })
  }

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 2,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)

  const res1 = await pool.acquireAsync()
  const res2 = await pool.acquireAsync()

  // No more resources available
  const promise = pool.acquireAsync(100) // 100ms timeout

  await assert.rejects(
    () => promise,
    (err: Error) => {
      return err.message.includes('Timeout')
    },
    'Should timeout after waiting for unavailable resource',
  )

  pool.release(res1)
  pool.release(res2)
  await pool.destroy()
})

test('StaticObjectPool - acquireAsync waits for released resource', async () => {
  const createTestFactory = () => {
    let counter = 0
    return async (): Promise<TestResource> => ({
      id: counter++,
      value: `resource-${counter}`,
    })
  }

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)

  const res1 = await pool.acquireAsync()
  assert(res1 !== null, 'Should acquire resource')

  // Schedule release
  setTimeout(() => {
    pool.release(res1)
  }, 50)

  // Should wait and then acquire the released resource
  const startTime = Date.now()
  const res2 = await pool.acquireAsync(1000)
  const elapsed = Date.now() - startTime
  assert(elapsed >= 50, 'Should wait for resource to be available')
  assert(res2 !== null, 'Should acquire released resource')

  pool.release(res2)
  await pool.destroy()
})

test('StaticObjectPool - use() method', async () => {
  const createTestFactory = () => {
    let counter = 0
    return async (): Promise<TestResource> => ({
      id: counter++,
      value: `resource-${counter}`,
    })
  }

  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 2,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)

  let metrics = pool.getMetrics()
  assert.equal(metrics.available, 2, 'Should have 2 available resources')

  const result = await pool.use(async (resource) => {
    metrics = pool.getMetrics()
    assert.equal(metrics.available, 1, 'Should have 1 available during use')
    assert.equal(metrics.busy, 1, 'Should have 1 busy during use')
    return typeof resource.id === 'number' ? 1 : 0
  })

  metrics = pool.getMetrics()
  assert.equal(metrics.available, 2, 'Should return to 2 available after use')
  assert.equal(metrics.busy, 0, 'Should have 0 busy after use')

  await pool.destroy()
})

test('StaticObjectPool - use() method releases on error', async () => {
  const createTestFactory = () => {
    let counter = 0
    return async (): Promise<TestResource> => ({
      id: counter++,
      value: `resource-${counter}`,
    })
  }

  const config: PoolConfig<TestResource> = {
    min: 1,
    max: 1,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)

  try {
    await pool.use(async () => {
      throw new Error('Test error')
    })
  } catch (err) {
    // Expected
  }

  const metrics = pool.getMetrics()
  assert.equal(metrics.available, 1, 'Should release resource even after error')
  assert.equal(metrics.busy, 0, 'Should have no busy resources')

  await pool.destroy()
})

test('StaticObjectPool - destroy() cleans up resources', async () => {
  let destroyedCount = 0
  const createTestFactory = () => {
    let counter = 0
    return async (): Promise<TestResource> => ({
      id: counter++,
      value: `resource-${counter}`,
    })
  }

  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 3,
    resourceFactory: createTestFactory(),
    resourceDestroyer: async () => {
      destroyedCount++
    },
  }

  const pool = await createPool(config)
  assert.equal(destroyedCount, 0, 'Destroyer should not be called on creation')

  // Acquire one resource
  const res = pool.acquire()
  assert(res !== null, 'Should acquire resource')

  await pool.destroy()
  assert.equal(destroyedCount, 3, 'Destroyer should be called for all resources')
})
