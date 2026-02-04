const { strict: assert } = require('node:assert')
const { describe, test } = require('node:test')
const { GenericObjectPool } = require('../../../index.wrapper.cjs')

describe('GenericObjectPool - Core', () => {
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
})
