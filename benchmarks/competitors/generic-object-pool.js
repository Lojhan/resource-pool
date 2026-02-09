import { StaticObjectPool } from '../../implementations/index.mjs'

export default {
  name: 'StaticObjectPool (Static/Sync)',

  setup: async (poolSize) => {
    const resources = Array.from({ length: poolSize }, (_, i) => ({ id: i }))
    return new StaticObjectPool(resources)
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
