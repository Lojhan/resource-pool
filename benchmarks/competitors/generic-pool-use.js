import genericPool from 'generic-pool'

export default {
  name: 'generic-pool .use()',

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
      testOnBorrow: false,
      autostart: true,
    }

    const pool = genericPool.createPool(factory, opts)
    await pool.ready()
    return pool
  },

  run: async (pool, iterations) => {
    const task = () => Promise.resolve()

    for (let i = 0; i < iterations; i++) {
      await pool.use(task)
    }
  },

  teardown: async (pool) => {
    await pool.drain()
    await pool.clear()
  },
}
