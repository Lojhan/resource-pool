import { createEnginePool } from '../../dist/src/index.js';

export default {
  name: 'EnginePool (Index) .use()',

  setup: async (poolSize) => {
    return createEnginePool(poolSize);
  },

  run: async (pool, iterations) => {
    const task = () => Promise.resolve();

    for (let i = 0; i < iterations; i++) {
      await pool.use(task);
    }
  },

  teardown: async (pool) => {
    pool.destroy();
  },
};
