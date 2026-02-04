const { strict: assert } = require('node:assert')
const { describe, test } = require('node:test')
const { GenericObjectPool } = require('../../../index.wrapper.cjs')

describe('GenericObjectPool - Lifecycle & Observability', () => {
  test('observability getters work', async () => {
    const pool = new GenericObjectPool([{ id: 1 }, { id: 2 }])

    assert.strictEqual(pool.size, 2)
    assert.strictEqual(pool.available, 2)
    assert.strictEqual(pool.numUsed, 0)
    assert.strictEqual(pool.pendingCount, 0)

    const r1 = await pool.acquireAsync()
    assert.strictEqual(pool.size, 2)
    assert.strictEqual(pool.available, 1)
    assert.strictEqual(pool.numUsed, 1)
    assert.strictEqual(pool.pendingCount, 0)

    const r2 = await pool.acquireAsync()
    assert.strictEqual(pool.available, 0)
    assert.strictEqual(pool.numUsed, 2)

    // Trigger pending
    const p3 = pool.acquireAsync()
    // Small delay to let it hit the semaphore wait
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.strictEqual(pool.pendingCount, 1)

    pool.release(r1)
    await p3
    assert.strictEqual(pool.pendingCount, 0)
  })

  test('destroy() should close the pool', async () => {
    const pool = new GenericObjectPool([{ id: 1 }])
    pool.destroy()

    try {
      await pool.acquireAsync(100)
      assert.fail('Should have thrown')
    } catch (e) {
      assert.match(e.message, /Pool closed/)
    }
  })
})
