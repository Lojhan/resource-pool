import { GenericObjectPool } from '@lojhan/resource-pool'

export default {
  name: 'GenericObjectPool (Dynamic/Sync)',

  setup: async (poolSize) => {
    return GenericObjectPool.dynamic({
      min: poolSize,
      max: poolSize,
      initial: poolSize,
      resourceFactory: () => ({}),
    })
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const r = pool.acquire()
      pool.release(r)
    }
  },

  teardown: async (pool) => {
    pool.destroy()
  },
}
