import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { FastResourcePool } = require('../../fast-pool.cjs')

export default {
  name: 'FastResourcePoolJS (SharedArrayBuffer)',

  setup: async (poolSize) => {
    return new FastResourcePool(poolSize)
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const handle = pool.acquire()
      pool.release(handle)
    }
  },

  teardown: async (pool) => {
    // No explicit teardown required for the JS fast pool
  },
}
