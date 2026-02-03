// import assert from 'node:assert'
// import { describe, test } from 'node:test'
// import { GenericObjectPool } from '../index.wrapper.mjs'
const { strict: assert } = require('node:assert');
const { describe, test } = require('node:test');
const { GenericObjectPool } = require('../index.wrapper.mjs');

describe('GenericObjectPool', () => {
  test('should create a pool with initial resources', () => {
    const resources = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const pool = new GenericObjectPool(resources)

    assert.strictEqual(pool.availableCount(), 3)
  })

  test('should acquire and release resources', () => {
    const resources = [{ id: 1 }, { id: 2 }]
    const pool = new GenericObjectPool(resources)

    assert.strictEqual(pool.availableCount(), 2)

    const resource1 = pool.acquire()
    assert.strictEqual(pool.availableCount(), 1)
    assert.ok(resource1)
    assert.ok(resource1.id === 1 || resource1.id === 2)

    const resource2 = pool.acquire()
    assert.strictEqual(pool.availableCount(), 0)
    assert.ok(resource2)

    pool.release(resource1)
    assert.strictEqual(pool.availableCount(), 1)

    pool.release(resource2)
    assert.strictEqual(pool.availableCount(), 2)
  })

  test('should throw error when pool is exhausted', () => {
    const resources = [{ id: 1 }]
    const pool = new GenericObjectPool(resources)

    const resource = pool.acquire()
    assert.ok(resource)
    assert.strictEqual(pool.availableCount(), 0)

    assert.throws(
      () => {
        pool.acquire()
      },
      {
        message: 'No resources available',
      },
    )
  })

  test('should add new resources dynamically', () => {
    const resources = [{ id: 1 }]
    const pool = new GenericObjectPool(resources)

    assert.strictEqual(pool.availableCount(), 1)

    pool.add({ id: 2 })
    assert.strictEqual(pool.availableCount(), 2)

    const r1 = pool.acquire()
    const r2 = pool.acquire()
    assert.strictEqual(pool.availableCount(), 0)

    pool.release(r1)
    pool.release(r2)
    assert.strictEqual(pool.availableCount(), 2)
  })

  test('should remove resources from pool', () => {
    const resources = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const pool = new GenericObjectPool(resources)

    assert.strictEqual(pool.availableCount(), 3)

    const removed = pool.removeOne()
    assert.strictEqual(removed, true)
    assert.strictEqual(pool.availableCount(), 2)

    const removed2 = pool.removeOne()
    assert.strictEqual(removed2, true)
    assert.strictEqual(pool.availableCount(), 1)
  })

  test('should not remove resources when all are in use', () => {
    const resources = [{ id: 1 }, { id: 2 }]
    const pool = new GenericObjectPool(resources)

    const r1 = pool.acquire()
    const _ = pool.acquire()
    assert.strictEqual(pool.availableCount(), 0)

    const removed = pool.removeOne()
    assert.strictEqual(removed, false)
    assert.strictEqual(pool.availableCount(), 0)

    pool.release(r1)
    assert.strictEqual(pool.availableCount(), 1)

    const removed2 = pool.removeOne()
    assert.strictEqual(removed2, true)
    assert.strictEqual(pool.availableCount(), 0)
  })

  test('should handle complex objects', () => {
    const resources = [
      { id: 1, name: 'Resource 1', data: { nested: true } },
      { id: 2, name: 'Resource 2', data: { nested: false } },
    ]
    const pool = new GenericObjectPool(resources)

    const resource = pool.acquire()
    assert.ok(resource.id)
    assert.ok(resource.name)
    assert.ok(resource.data)
    assert.ok(typeof resource.data.nested === 'boolean')

    pool.release(resource)
    assert.strictEqual(pool.availableCount(), 2)
  })

  test('should maintain resource integrity across acquire/release cycles', () => {
    const resources = [{ id: 1, counter: 0 }]
    const pool = new GenericObjectPool(resources)

    const r1 = pool.acquire()
    r1.counter++
    assert.strictEqual(r1.counter, 1)
    pool.release(r1)

    const r2 = pool.acquire()
    assert.strictEqual(r2.counter, 1)
    r2.counter++
    assert.strictEqual(r2.counter, 2)
    pool.release(r2)

    const r3 = pool.acquire()
    assert.strictEqual(r3.counter, 2)
  })

  test('should handle empty pool creation', () => {
    const pool = new GenericObjectPool([])

    assert.strictEqual(pool.availableCount(), 0)

    assert.throws(
      () => {
        pool.acquire()
      },
      {
        message: 'No resources available',
      },
    )

    pool.add({ id: 1 })
    assert.strictEqual(pool.availableCount(), 1)

    const resource = pool.acquire()
    assert.ok(resource)
  })

  test('should handle multiple acquire and release operations', () => {
    const resources = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]
    const pool = new GenericObjectPool(resources)

    const acquired = []

    for (let i = 0; i < 3; i++) {
      acquired.push(pool.acquire())
    }
    assert.strictEqual(pool.availableCount(), 2)

    pool.release(acquired[0])
    pool.release(acquired[1])
    assert.strictEqual(pool.availableCount(), 4)

    acquired.push(pool.acquire())
    acquired.push(pool.acquire())
    assert.strictEqual(pool.availableCount(), 2)

    pool.release(acquired[2])
    pool.release(acquired[3])
    pool.release(acquired[4])
    assert.strictEqual(pool.availableCount(), 5)
  })

  test('should handle functions as resources', () => {
    const fn1 = () => 'result1'
    const fn2 = () => 'result2'
    const resources = [{ execute: fn1 }, { execute: fn2 }]
    const pool = new GenericObjectPool(resources)

    const resource = pool.acquire()
    assert.ok(typeof resource.execute === 'function')
    assert.ok(resource.execute() === 'result1' || resource.execute() === 'result2')

    pool.release(resource)
    assert.strictEqual(pool.availableCount(), 2)
  })

  test('should handle 3 parallel operations with only 2 resources', async () => {
    const resources = [{ id: 1 }, { id: 2 }]
    const pool = new GenericObjectPool(resources)

    const results = []
    const startTime = Date.now()

    const operation = async (id) => {
      const acquireTime = Date.now()
      const resource = await pool.acquireAsync()
      const acquiredTime = Date.now()
      const waitTime = acquiredTime - acquireTime

      results.push({
        operationId: id,
        resourceId: resource.id,
        acquiredAt: acquiredTime - startTime,
        waitTime,
      })

      await new Promise((resolve) => setTimeout(resolve, 1000))

      pool.release(resource)
      const releasedTime = Date.now()

      return {
        operationId: id,
        duration: releasedTime - acquireTime,
        waitTime,
      }
    }

    const promises = [operation(1), operation(2), operation(3)]

    const operationResults = await Promise.all(promises)
    const totalTime = Date.now() - startTime

    assert.strictEqual(results.length, 3, 'All 3 operations should complete')

    const waitedOperations = operationResults.filter((r) => r.waitTime > 50)
    assert.ok(waitedOperations.length >= 1, 'At least one operation should have waited for a resource')

    assert.ok(
      totalTime >= 1900 && totalTime < 2500,
      `Total time should be around 2s (got ${totalTime}ms), proving operations ran in parallel`,
    )

    const sortedResults = [...results].sort((a, b) => a.acquiredAt - b.acquiredAt)

    assert.ok(sortedResults[0].acquiredAt < 100, 'First operation acquired immediately')
    assert.ok(sortedResults[1].acquiredAt < 100, 'Second operation acquired immediately')

    assert.ok(
      sortedResults[2].acquiredAt >= 900 && sortedResults[2].acquiredAt < 1200,
      `Third operation acquired after ~1s (got ${sortedResults[2].acquiredAt}ms)`,
    )

    assert.strictEqual(pool.availableCount(), 2, 'All resources should be returned to the pool')
  })

  test('should timeout when acquire takes too long', async () => {
    const resources = [{ id: 1 }]
    const pool = new GenericObjectPool(resources)

    const resource = pool.acquire()
    assert.strictEqual(pool.availableCount(), 0)

    try {
      await pool.acquireAsync(500)
      assert.fail('Should have thrown timeout error')
    } catch (err) {
      assert.match(err.message, /Failed to acquire resource within 500ms timeout/)
    }

    pool.release(resource)
    assert.strictEqual(pool.availableCount(), 1)

    const acquired = await pool.acquireAsync(500)
    assert.ok(acquired)
    assert.strictEqual(acquired.id, 1)
  })
})
