import { GenericObjectPool } from '@lojhan/resource-pool'

export default {
  name: 'GenericObjectPool (Engine/Index)',

  setup: async (poolSize) => {
    return GenericObjectPool.engine(poolSize)
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const idx = pool.acquire()
      pool.release(idx)
    }
  },

  teardown: async (pool) => {
    pool.destroy()
  },
}
