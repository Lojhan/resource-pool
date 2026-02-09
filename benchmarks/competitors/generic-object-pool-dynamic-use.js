import { DynamicObjectPool } from '../../implementations/index.mjs'

export default {
  name: 'DynamicObjectPool (Dynamic) .use()',

  setup: async (poolSize) => {
    return DynamicObjectPool.withDynamicSizing({
      min: poolSize,
      max: poolSize,
      initial: poolSize,
      resourceFactory: () => ({}),
    })
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
