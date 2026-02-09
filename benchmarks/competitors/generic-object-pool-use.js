import { createPool } from '../../src/index'

export default {
  name: 'ObjectPool (Static) .use()',

  setup: async (poolSize) => {
    return await createPool({
      min: poolSize,
      max: poolSize,
      resourceFactory: () => ({ id: Math.random() }),
    })
  },

  run: async (pool, iterations) => {
    // We do a minimal async op to simulate real usage
    const task = (r) => Promise.resolve()

    for (let i = 0; i < iterations; i++) {
      await pool.use(task)
    }
  },

  teardown: async (pool) => {
    await pool.destroy()
  },
}
