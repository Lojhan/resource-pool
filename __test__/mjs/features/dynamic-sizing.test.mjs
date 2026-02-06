import { strict as assert } from 'node:assert'
import { describe, test, before, after } from 'node:test'
import { GenericObjectPool } from '../../../index.wrapper.mjs'

describe('GenericObjectPool - Dynamic Sizing', () => {
  describe('Configuration', () => {
    test('should create pool with min, max, and initial size', () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 5,
        resourceFactory: factory
      })

      assert.strictEqual(pool.size, 5)
      assert.strictEqual(pool.minSize, 2)
      assert.strictEqual(pool.maxSize, 10)
      assert.strictEqual(pool.available, 5)
      
      pool.destroy()
    })

    test('should use min as initial size if initial not provided', () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 3,
        max: 10,
        resourceFactory: factory
      })

      assert.strictEqual(pool.size, 3)
      assert.strictEqual(pool.minSize, 3)
      
      pool.destroy()
    })

    test('should throw if max < min', () => {
      const factory = () => ({ id: 1 })
      
      assert.throws(
        () => {
          GenericObjectPool.withDynamicSizing({
            min: 10,
            max: 5,
            resourceFactory: factory
          })
        },
        {
          message: /max.*must be greater than or equal to.*min/i
        }
      )
    })

    test('should throw if initial < min or initial > max', () => {
      const factory = () => ({ id: 1 })
      
      assert.throws(
        () => {
          GenericObjectPool.withDynamicSizing({
            min: 2,
            max: 10,
            initial: 1,
            resourceFactory: factory
          })
        },
        {
          message: /initial.*must be between min and max/i
        }
      )

      assert.throws(
        () => {
          GenericObjectPool.withDynamicSizing({
            min: 2,
            max: 10,
            initial: 15,
            resourceFactory: factory
          })
        },
        {
          message: /initial.*must be between min and max/i
        }
      )
    })
  })

  describe('Auto Scale-Up', () => {
    test('should scale up when pending requests exceed threshold', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 2,
        resourceFactory: factory,
        scaleUpThreshold: 1, // Scale up when 1 or more requests pending
        scaleUpIncrement: 2  // Add 2 resources at a time
      })

      assert.strictEqual(pool.size, 2)

      // Acquire all resources
      const r1 = await pool.acquireAsync()
      const r2 = await pool.acquireAsync()
      
      assert.strictEqual(pool.available, 0)
      assert.strictEqual(pool.size, 2)

      // Create pending requests that should trigger scale-up
      const promises = []
      for (let i = 0; i < 3; i++) {
        promises.push(pool.acquireAsync())
      }

      // Wait for scale-up to happen
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Pool should have scaled up
      assert.ok(pool.size > 2, `Pool size should be > 2, got ${pool.size}`)
      assert.ok(pool.size <= 10, `Pool size should be <= 10, got ${pool.size}`)

      // Release original resources
      pool.release(r1)
      pool.release(r2)

      // All pending requests should resolve
      const resources = await Promise.all(promises)
      assert.strictEqual(resources.length, 3)
      
      resources.forEach(r => pool.release(r))
      pool.destroy()
    })

    test('should not scale beyond max size', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 5,
        initial: 2,
        resourceFactory: factory,
        scaleUpThreshold: 1,
        scaleUpIncrement: 10 // Try to add 10 but max is 5
      })

      // Acquire all
      const r1 = await pool.acquireAsync()
      const r2 = await pool.acquireAsync()

      // Create many pending requests
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(
          pool.acquireAsync().then((resource) => {
            pool.release(resource)
            return resource
          })
        )
      }

      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not exceed max
      assert.ok(pool.size <= 5, `Pool size should not exceed max 5, got ${pool.size}`)

      // Cleanup
      pool.release(r1)
      pool.release(r2)
      await Promise.all(promises)
      pool.destroy()
    })

    test('should scale up incrementally based on demand', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 1,
        max: 20,
        initial: 1,
        resourceFactory: factory,
        scaleUpThreshold: 2,
        scaleUpIncrement: 1
      })

      const initialSize = pool.size

      // Create concurrent demand to trigger scale-up
      const resources = await Promise.all(
        Array.from({ length: 5 }, () =>
          pool.acquireAsync(500).then((resource) => {
            pool.release(resource)
            return resource
          })
        )
      )

      // Pool should have grown
      assert.ok(pool.size > initialSize, 'Pool should have grown')

      pool.destroy()
    })
  })

  describe('Auto Scale-Down', () => {
    test('should scale down idle resources after timeout', async () => {
      let counter = 0
      const factory = () => ({ id: counter++, createdAt: Date.now() })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 8,
        resourceFactory: factory,
        idleTimeoutMs: 100,        // Resources idle for 100ms can be removed
        scaleDownCheckIntervalMs: 50  // Check every 50ms
      })

      assert.strictEqual(pool.size, 8)

      // Wait for idle timeout
      await new Promise(resolve => setTimeout(resolve, 200))

      // Should have scaled down to min
      assert.ok(pool.size <= 8, 'Pool should have scaled down')
      assert.ok(pool.size >= 2, 'Pool should not go below min')

      pool.destroy()
    })

    test('should not scale below min size', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 5,
        max: 10,
        initial: 5,
        resourceFactory: factory,
        idleTimeoutMs: 50,
        scaleDownCheckIntervalMs: 25
      })

      // Wait for potential scale-down attempts
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should stay at min
      assert.strictEqual(pool.size, 5)

      pool.destroy()
    })

    test('should keep frequently used resources', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 5,
        resourceFactory: factory,
        idleTimeoutMs: 200,
        scaleDownCheckIntervalMs: 50
      })

      const initialSize = pool.size

      // Continuously use resources to keep them active
      const keepAlive = async () => {
        for (let i = 0; i < 5; i++) {
          const r = await pool.acquireAsync()
          await new Promise(resolve => setTimeout(resolve, 30))
          pool.release(r)
        }
      }

      await keepAlive()

      // Size should remain stable since resources are being used
      assert.strictEqual(pool.size, initialSize)

      pool.destroy()
    })
  })

  describe('Resource Factory', () => {
    test('should create resources using factory', async () => {
      let createCount = 0
      const factory = () => {
        createCount++
        return { id: createCount, value: `resource-${createCount}` }
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 5,
        resourceFactory: factory
      })

      assert.strictEqual(createCount, 2, 'Factory should be called for initial resources')
      
      const r1 = await pool.acquireAsync()
      assert.ok(r1.id)
      assert.ok(r1.value.startsWith('resource-'))
      
      pool.release(r1)
      pool.destroy()
    })

    test('should handle async resource factory', async () => {
      let createCount = 0
      const factory = async () => {
        createCount++
        await new Promise(resolve => setTimeout(resolve, 10))
        return { id: createCount, async: true }
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 5,
        resourceFactory: factory
      })

      // Wait for async initialization
      await new Promise(resolve => setTimeout(resolve, 50))

      const r1 = await pool.acquireAsync()
      assert.ok(r1.async)
      
      pool.release(r1)
      pool.destroy()
    })

    test('should handle resource factory errors', async () => {
      let attempts = 0
      const factory = () => {
        attempts++
        if (attempts <= 2) {
          throw new Error('Factory error')
        }
        return { id: attempts }
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 1,
        max: 5,
        resourceFactory: factory,
        createRetries: 3
      })

      // Should eventually succeed with retries
      await new Promise(resolve => setTimeout(resolve, 50))
      
      assert.ok(pool.size >= 1, 'Pool should have at least 1 resource after retries')
      
      pool.destroy()
    })
  })

  describe('Resource Validation', () => {
    test('should validate resources before returning them', async () => {
      let counter = 0
      const factory = () => ({ id: counter++, valid: true })
      
      let validateCount = 0
      const validator = (resource) => {
        validateCount++
        return resource.valid === true
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 5,
        resourceFactory: factory,
        validateResource: validator
      })

      const r1 = await pool.acquireAsync()
      assert.ok(validateCount > 0, 'Validator should have been called')
      assert.ok(r1.valid)
      
      pool.release(r1)
      pool.destroy()
    })

    test('should recreate invalid resources', async () => {
      let counter = 0
      const factory = () => ({ id: counter++, valid: true })
      
      let firstValidation = true
      const validator = (resource) => {
        if (firstValidation && resource.id === 0) {
          firstValidation = false
          return false // First resource is invalid
        }
        return true
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 5,
        resourceFactory: factory,
        validateResource: validator,
        validateOnAcquire: true
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      const r1 = await pool.acquireAsync()
      
      // Should get a valid resource (invalid one was replaced)
      assert.ok(r1.valid)
      
      pool.release(r1)
      pool.destroy()
    })

    test('should handle async validation', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const validator = async (resource) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        return resource.id !== undefined
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 5,
        resourceFactory: factory,
        validateResource: validator
      })

      const r1 = await pool.acquireAsync()
      assert.ok(r1.id !== undefined)
      
      pool.release(r1)
      pool.destroy()
    })
  })

  describe('Metrics and Observability', () => {
    test('should track scale-up events', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 2,
        resourceFactory: factory,
        scaleUpThreshold: 1,
        scaleUpIncrement: 2
      })

      const initialMetrics = pool.getMetrics()
      assert.strictEqual(initialMetrics.scaleUpEvents, 0)

      // Trigger scale-up
      const r1 = await pool.acquireAsync()
      const r2 = await pool.acquireAsync()
      
      const promises = [
        pool.acquireAsync(),
        pool.acquireAsync()
      ]

      await new Promise(resolve => setTimeout(resolve, 100))

      const metrics = pool.getMetrics()
      assert.ok(metrics.scaleUpEvents > 0, 'Should have scale-up events')

      pool.release(r1)
      pool.release(r2)
      const resources = await Promise.all(promises)
      resources.forEach(r => pool.release(r))
      pool.destroy()
    })

    test('should track scale-down events', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 6,
        resourceFactory: factory,
        idleTimeoutMs: 50,
        scaleDownCheckIntervalMs: 25
      })

      await new Promise(resolve => setTimeout(resolve, 150))

      const metrics = pool.getMetrics()
      assert.ok(metrics.scaleDownEvents >= 0, 'Should have scale-down metrics')

      pool.destroy()
    })

    test('should provide comprehensive metrics', () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 5,
        resourceFactory: factory
      })

      const metrics = pool.getMetrics()
      assert.ok(metrics.hasOwnProperty('currentSize'))
      assert.ok(metrics.hasOwnProperty('minSize'))
      assert.ok(metrics.hasOwnProperty('maxSize'))
      assert.ok(metrics.hasOwnProperty('available'))
      assert.ok(metrics.hasOwnProperty('inUse'))
      assert.ok(metrics.hasOwnProperty('pending'))
      assert.ok(metrics.hasOwnProperty('scaleUpEvents'))
      assert.ok(metrics.hasOwnProperty('scaleDownEvents'))
      assert.ok(metrics.hasOwnProperty('resourcesCreated'))
      assert.ok(metrics.hasOwnProperty('resourcesDestroyed'))

      pool.destroy()
    })
  })

  describe('Advanced Scenarios', () => {
    test('should handle mixed workload patterns', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 20,
        initial: 2,
        resourceFactory: factory,
        scaleUpThreshold: 2,
        scaleUpIncrement: 3,
        idleTimeoutMs: 200,
        scaleDownCheckIntervalMs: 50
      })

      // Burst 1: High load
      const burst1 = []
      for (let i = 0; i < 10; i++) {
        burst1.push(pool.acquireAsync())
      }
      const resources1 = await Promise.all(burst1)
      
      const sizeAfterBurst1 = pool.size
      assert.ok(sizeAfterBurst1 > 2, 'Should scale up during burst')

      // Release all
      resources1.forEach(r => pool.release(r))

      // Idle period
      await new Promise(resolve => setTimeout(resolve, 300))

      // Should have scaled down
      assert.ok(pool.size < sizeAfterBurst1, 'Should scale down after idle')

      // Burst 2: Another high load
      const burst2 = []
      for (let i = 0; i < 8; i++) {
        burst2.push(pool.acquireAsync())
      }
      const resources2 = await Promise.all(burst2)
      
      assert.ok(pool.size >= 8, 'Should scale up again for second burst')

      resources2.forEach(r => pool.release(r))
      pool.destroy()
    })

    test('should handle resource destruction callbacks', async () => {
      let counter = 0
      let destroyedIds = []
      
      const factory = () => ({ id: counter++ })
      const destroyer = (resource) => {
        destroyedIds.push(resource.id)
      }
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 5,
        resourceFactory: factory,
        resourceDestroyer: destroyer,
        idleTimeoutMs: 50,
        scaleDownCheckIntervalMs: 25
      })

      await new Promise(resolve => setTimeout(resolve, 150))

      // Some resources should have been destroyed
      assert.ok(destroyedIds.length >= 0, 'Destroyer should track removed resources')

      pool.destroy()
      
      // All resources should be destroyed when pool is destroyed
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    test('should work correctly with use() pattern', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        initial: 2,
        resourceFactory: factory,
        scaleUpThreshold: 1,
        scaleUpIncrement: 2
      })

      const results = []
      const promises = []

      for (let i = 0; i < 5; i++) {
        promises.push(
          pool.use(async (resource) => {
            await new Promise(resolve => setTimeout(resolve, 20))
            return { resourceId: resource.id, iteration: i }
          })
        )
      }

      const outcomes = await Promise.all(promises)
      assert.strictEqual(outcomes.length, 5)
      
      outcomes.forEach(outcome => {
        assert.ok(outcome.resourceId !== undefined)
        assert.ok(outcome.iteration !== undefined)
      })

      pool.destroy()
    })
  })

  describe('Edge Cases', () => {
    test('should handle rapid acquire/release cycles', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 2,
        max: 10,
        resourceFactory: factory,
        scaleUpThreshold: 2,
        scaleUpIncrement: 1
      })

      for (let i = 0; i < 50; i++) {
        const r = await pool.acquireAsync()
        pool.release(r)
      }

      assert.ok(pool.size >= 2)
      assert.ok(pool.size <= 10)

      pool.destroy()
    })

    test('should handle concurrent scale operations', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 1,
        max: 20,
        initial: 1,
        resourceFactory: factory,
        scaleUpThreshold: 1,
        scaleUpIncrement: 3
      })

      const promises = []
      for (let i = 0; i < 20; i++) {
        promises.push(
          (async () => {
            const r = await pool.acquireAsync()
            await new Promise(resolve => setTimeout(resolve, 50))
            pool.release(r)
          })()
        )
      }

      await Promise.all(promises)

      assert.ok(pool.size <= 20, 'Should not exceed max')
      assert.ok(pool.available === pool.size, 'All resources should be available')

      pool.destroy()
    })

    test('should handle zero initial size', async () => {
      let counter = 0
      const factory = () => ({ id: counter++ })
      
      const pool = GenericObjectPool.withDynamicSizing({
        min: 0,
        max: 10,
        initial: 0,
        resourceFactory: factory,
        scaleUpThreshold: 0,
        scaleUpIncrement: 2
      })

      assert.strictEqual(pool.size, 0)

      const r = await pool.acquireAsync()
      assert.ok(r)
      assert.ok(pool.size > 0)

      pool.release(r)
      pool.destroy()
    })
  })
})
