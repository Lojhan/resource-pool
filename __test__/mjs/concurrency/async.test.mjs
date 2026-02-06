import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'
import { GenericObjectPool } from '../../../index.wrapper.mjs'

describe('GenericObjectPool - Concurrency & Async', () => {
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

    assert.ok(sortedResults[0].acquiredAt < 500, 'First operation acquired immediately')
    assert.ok(sortedResults[1].acquiredAt < 500, 'Second operation acquired immediately')

    assert.ok(
      sortedResults[2].acquiredAt >= 900 && sortedResults[2].acquiredAt < 1500,
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

  test('should acquire, run, and release using use()', async () => {
    const resource = { id: 1 }
    const pool = new GenericObjectPool([resource])

    assert.strictEqual(pool.availableCount(), 1)

    await pool.use(async (r) => {
      assert.strictEqual(r, resource)
      assert.strictEqual(pool.availableCount(), 0)
      assert.strictEqual(pool.numUsed, 1)
    })

    assert.strictEqual(pool.availableCount(), 1)
    assert.strictEqual(pool.numUsed, 0)
  })

  test('use() should release even if error', async () => {
    const resource = { id: 1 }
    const pool = new GenericObjectPool([resource])

    try {
      await pool.use(async () => {
        throw new Error('fail')
      })
    } catch (e) {
      assert.strictEqual(e.message, 'fail')
    }

    assert.strictEqual(pool.availableCount(), 1)
  })
})
