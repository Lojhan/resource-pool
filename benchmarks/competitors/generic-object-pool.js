import { GenericObjectPool } from '@lojhan/resource-pool'

export default {
  name: 'GenericObjectPool (Native/Sync)',

  setup: async (poolSize) => {
    const resources = Array.from({ length: poolSize }, (_, i) => ({ id: i }))
    return new GenericObjectPool(resources)
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const r = pool.acquire()
      pool.release(r)
    }
  },

  teardown: async (pool) => {
    // No explicit teardown needed for the native pool in this context
  },
}
