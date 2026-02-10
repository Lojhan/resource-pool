import { createPool } from '@lojhan/resource-pool';

export default {
  name: 'ObjectPool (Static) .use()',

  setup: (poolSize) => {
    return createPool({
      min: poolSize,
      max: poolSize,
      resourceFactory: () => ({ id: Math.random() }),
    });
  },

  run: async (pool, iterations) => {
    const task = () => Promise.resolve();

    for (let i = 0; i < iterations; i++) {
      await pool.use(task);
    }
  },

  teardown: async (pool) => {
    await pool.destroy();
  },
};
