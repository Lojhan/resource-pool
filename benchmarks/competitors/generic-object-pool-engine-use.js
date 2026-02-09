// import { EnginePool } from '../../src/engine-pool'

// export default {
//   name: 'EnginePool (Engine) .use()',

//   setup: async (poolSize) => {
//     return new EnginePool(poolSize)
//   },

//   run: async (pool, iterations) => {
//     const task = () => Promise.resolve()

//     for (let i = 0; i < iterations; i++) {
//       await pool.use(task)
//     }
//   },

//   teardown: async (pool) => {
//     pool.destroy()
//   },
// }
