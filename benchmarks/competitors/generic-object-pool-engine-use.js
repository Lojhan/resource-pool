import { GenericObjectPool } from '@lojhan/resource-pool'

export default {
  name: 'GenericObjectPool (Engine) .use()',

  setup: async (poolSize) => {
    return GenericObjectPool.engine(poolSize)
  },

  run: async (pool, iterations) => {
    const task = () => Promise.resolve()

    for (let i = 0; i < iterations; i++) {
      await pool.use(task)
    }
  },

  teardown: async (pool) => {
    pool.destroy()
  },
}
