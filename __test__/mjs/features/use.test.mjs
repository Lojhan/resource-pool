import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'
import { GenericObjectPool } from '../../../index.wrapper.mjs'

describe('GenericObjectPool - Use Method', () => {
  test('should use default optimistic behavior (immediate acquire)', async () => {
    const pool = new GenericObjectPool([{ id: 1 }])
    const start = Date.now()
    await pool.use(async (resource) => {
      assert.strictEqual(resource.id, 1)
      const duration = Date.now() - start
      // Should be very fast as it's synchronous logic
      assert.ok(duration < 100, `Expected < 100ms, got ${duration}ms`)
    })
  })

  test('should respect optimistic: false (force async)', async () => {
    const pool = new GenericObjectPool([{ id: 1 }])

    await pool.use(
      async (resource) => {
        assert.strictEqual(resource.id, 1)
      },
      { optimistic: false },
    )
  })

  test('should handle timeout in use()', async () => {
    const pool = new GenericObjectPool([{ id: 1 }])
    const r1 = pool.acquire() // Exhaust the pool

    const start = Date.now()
    try {
      await pool.use(
        async (resource) => {
          assert.fail('Should not have acquired')
        },
        { timeout: 100 },
      )
      assert.fail('Should have timed out')
    } catch (e) {
      const duration = Date.now() - start
      assert.ok(duration >= 90, `Should have waited around 100ms (got ${duration}ms)`)
      assert.ok(e.message.includes('timeout') || e.message.includes('Timeout'), 'Error should be a timeout error')
    }
  })

  test('should fallback to async when synchronous fail even with optimistic true', async () => {
    const pool = new GenericObjectPool([{ id: 1 }])
    const r1 = pool.acquire() // Pool empty now

    const start = Date.now()

    // Run release after a delay
    setTimeout(() => pool.release(r1), 200)

    await pool.use(
      async (resource) => {
        assert.strictEqual(resource.id, 1)
        const duration = Date.now() - start
        assert.ok(duration >= 150, 'Should have waited for async release')
      },
      { optimistic: true },
    ) // Default
  })
})
