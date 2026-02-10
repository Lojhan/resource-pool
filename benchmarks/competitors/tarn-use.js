import { Pool } from 'tarn'

export default {
  name: 'tarn (manual .use)',

  setup: async (poolSize) => {
    return new Pool({
      create: () => ({ id: Math.random() }),
      destroy: () => {},
      min: poolSize,
      max: poolSize,
      idleTimeoutMillis: 30000,
    })
  },

  run: async (pool, iterations) => {
    const task = () => {}

    for (let i = 0; i < iterations; i++) {
      const acquire = pool.acquire()
      try {
        const resource = await acquire.promise
        await task(resource)
        pool.release(resource)
      } catch (e) {
        // handle error if needed, for benchmark we assume success
      }
    }
  },

  teardown: async (pool) => {
    await pool.destroy()
  },
}
