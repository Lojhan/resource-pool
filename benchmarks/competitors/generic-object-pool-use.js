import { StaticObjectPool } from '../../implementations/index.mjs'

export default {
  name: 'StaticObjectPool (Static) .use()',

  setup: async (poolSize) => {
    const resources = Array.from({ length: poolSize }, (_, i) => ({ id: i }))
    return new StaticObjectPool(resources)
  },

  run: async (pool, iterations) => {
    // We do a minimal async op to simulate real usage
    const task = (r) => Promise.resolve()

    for (let i = 0; i < iterations; i++) {
      await pool.use(task)
    }
  },

  teardown: async (pool) => {
    pool.destroy()
  },
}
