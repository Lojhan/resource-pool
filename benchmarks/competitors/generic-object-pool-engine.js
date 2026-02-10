import { createEnginePool } from '@lojhan/resource-pool';

export default {
  name: 'EnginePool (Index)',

  setup: (poolSize) => {
    return createEnginePool(poolSize);
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const idx = pool.acquire();
      if (idx !== -1) pool.release(idx);
    }
  },

  teardown: async (pool) => {
    pool.destroy();
  },
};
