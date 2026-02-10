import { createEnginePool } from '@lojhan/resource-pool';

export default {
  name: 'EnginePool (Index) .use()',

  setup: (poolSize) => {
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
