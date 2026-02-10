import { createPool } from '../../dist/src/index.js';

export default {
  name: 'ObjectPool (Dynamic) .use()',

  setup: async (poolSize) => {
    return await createPool({
      min: poolSize,
      max: poolSize,
      resourceFactory: () => ({ id: Math.random() }),
    });
  },

  run: async (pool, iterations) => {
    const task = () => {};

    for (let i = 0; i < iterations; i++) {
      await pool.use(task);
    }
  },

  teardown: async (pool) => {
    await pool.destroy();
  },
};
