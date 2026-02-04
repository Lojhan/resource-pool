import genericPool from 'generic-pool'

export default {
  name: 'generic-pool (Async)',

  setup: async (poolSize) => {
    const factory = {
      create: () => Promise.resolve({ id: Math.random() }),
      destroy: () => Promise.resolve(),
      validate: () => Promise.resolve(true),
    }

    const opts = {
      max: poolSize,
      min: poolSize,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      testOnBorrow: false, // Set to false to match other benchmarks more closely for fair comparison
      autostart: true,
    }

    const pool = genericPool.createPool(factory, opts)

    // Ensure min resources are created
    await pool.ready()

    return pool
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const resource = await pool.acquire()
      await pool.release(resource)
    }
  },

  teardown: async (pool) => {
    await pool.drain()
    await pool.clear()
  },
}
