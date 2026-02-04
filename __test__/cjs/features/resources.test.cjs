const { strict: assert } = require('node:assert')
const { describe, test } = require('node:test')
const { GenericObjectPool } = require('../../../index.wrapper.cjs')

describe('GenericObjectPool - Resources', () => {
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
})
