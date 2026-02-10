import { Pool } from 'tarn';

export default {
  name: 'tarn (Pure JS/Async)',

  setup: async (poolSize) => {
    return new Pool({
      create: () => ({ id: Math.random() }),
      destroy: () => {},
      min: poolSize,
      max: poolSize,
      idleTimeoutMillis: 30000,
    });
  },

  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      const acquire = pool.acquire();
      const resource = await acquire.promise;
      pool.release(resource);
    }
  },

  teardown: async (pool) => {
    await pool.destroy();
  },
};
