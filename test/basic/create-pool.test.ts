import { test } from 'node:test'
import assert from 'node:assert'
import { createPool, type PoolConfig, type IObjectPool } from '../../src/index'

interface TestResource {
  id: number
  created: number
}

const createTestFactory = (id?: number) => {
  let counter = id ?? 0
  return async (): Promise<TestResource> => {
    return {
      id: counter++,
      created: Date.now(),
    }
  }
}

test('createPool - Static pool (min === max)', async () => {
  const config: PoolConfig<TestResource> = {
    min: 5,
    max: 5,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)
  assert(pool !== null, 'Pool should be created')

  const metrics = pool.getMetrics()
  assert.equal(metrics.size, 5, 'Static pool size should be 5')
  assert.equal(metrics.capacity, 5, 'Capacity should be 5')
  assert.equal(metrics.available, 5, 'All resources should be available initially')
  assert.equal(metrics.busy, 0, 'No resources should be busy initially')

  await pool.destroy()
})

test('createPool - Dynamic pool (min < max)', async () => {
  const config: PoolConfig<TestResource> = {
    min: 2,
    max: 10,
    resourceFactory: createTestFactory(),
  }

  const pool = await createPool(config)
  assert(pool !== null, 'Pool should be created')

  const metrics = pool.getMetrics()
  assert.equal(metrics.size, 2, 'Dynamic pool active size should be 2 (min)')
  assert.equal(metrics.capacity, 10, 'Capacity should be 10 (max)')
  assert.equal(metrics.available, 2, 'Min resources should be available initially')

  await pool.destroy()
})

test('createPool - throws when max < min', async () => {
  const config: PoolConfig<TestResource> = {
    min: 10,
    max: 5,
    resourceFactory: createTestFactory(),
  }

  await assert.rejects(
    async () => {
      await createPool(config)
    },
    (err: Error) => {
      return err.message.includes('Max must be >= Min')
    },
  )
})

test('createPool - handles factory errors gracefully', async () => {
  let attempts = 0
  const failingFactory = async (): Promise<TestResource> => {
    attempts++
    throw new Error('Factory failed')
  }

  const config: PoolConfig<TestResource> = {
    min: 3,
    max: 3,
    resourceFactory: failingFactory,
  }

  // Should not throw, but create pool with failed resources
  const pool = await createPool(config)
  assert(pool !== null, 'Pool should be created even with factory errors')

  const metrics = pool.getMetrics()
  // All initial creation should have failed
  assert.equal(metrics.available, 0, 'No resources should be available due to failures')

  await pool.destroy()
  assert(attempts === 3, 'Factory should be called for each min slot')
})
