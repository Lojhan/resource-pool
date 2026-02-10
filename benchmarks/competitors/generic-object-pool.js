import { createPool } from '@lojhan/resource-pool';

export default {
  name: 'ObjectPool (Static)',

  setup: (poolSize) => {
    return createPool({
      min: poolSize,
      max: poolSize,
      resourceFactory: () => ({ id: Math.random() }),
    });
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const r = pool.acquire();
      if (r) pool.release(r);
    }
  },

  teardown: async (pool) => {
    await pool.destroy();
  },
};
