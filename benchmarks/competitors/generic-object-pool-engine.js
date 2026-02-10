import { createEnginePool } from '../../dist/src/index.js';

export default {
  name: 'EnginePool (Index)',

  setup: async (poolSize) => {
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
