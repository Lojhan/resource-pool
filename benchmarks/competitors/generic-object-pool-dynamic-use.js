import { createPool } from '../../src/index'

export default {
  name: 'DynamicObjectPool (Dynamic) .use()',

  setup: async (poolSize) => {
    return await createPool({
      min: poolSize,
      max: poolSize,
      resourceFactory: () => ({ id: Math.random() }),
    })
  },

  run: async (pool, iterations) => {
    const task = () => Promise.resolve()
    for (let i = 0; i < iterations; i++) {
      await pool.use(task)
    }
  },

  teardown: async (pool) => {
    await pool.destroy()
  },
}
