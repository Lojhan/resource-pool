// import { EnginePool } from '../../src/engine-pool'

// export default {
//   name: 'StaticObjectPool (Engine/Index)',

//   setup: async (poolSize) => {
//     return new EnginePool(poolSize)
//   },

//   run: async (pool, iterations) => {
//     for (let i = 0; i < iterations; i++) {
//       const idx = pool.acquire()
//       pool.release(idx)
//     }
//   },

//   teardown: async (pool) => {
//     pool.destroy()
//   },
// }
