import { DynamicObjectPool } from '../../implementations/index.mjs'

export default {
  name: 'DynamicObjectPool (Dynamic/Sync)',

  setup: async (poolSize) => {
    return DynamicObjectPool.withDynamicSizing({
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
