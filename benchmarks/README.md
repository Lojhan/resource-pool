# Resource Pool Benchmarks

This folder contains a benchmark runner to compare different resource pool implementations.

## How to run

```bash
node benchmarks/runner.js
```

## How to add a competitor

1. Create a new `.js` file in the `benchmarks/competitors/` folder (e.g. `another-pool.js`).
2. Export a default object with the following interface:

```javascript
export default {
  // Display name for the benchmark report
  name: 'My New Pool Library',

  /**
   * Initialize the pool.
   * @param {number} poolSize - The number of resources the pool should hold.
   * @returns {any} The pool instance.
   */
  setup: async (poolSize) => {
    // Return your initialized pool instance here
    return new MyPool({ max: poolSize });
  },

  /**
   * Run the workload.
   * @param {any} pool - The pool instance returned from setup().
   * @param {number} iterations - How many times to acquire/release.
   */
  run: async (pool, iterations) => {
    for (let i = 0; i < iterations; i++) {
      // Perform one acquire + release cycle
      const resource = await pool.acquire();
      pool.release(resource);
    }
  },

  /**
   * Clean up.
   * @param {any} pool - The pool instance.
   */
  teardown: async (pool) => {
    // Close connections, stop intervals, etc.
    await pool.destroy();
  },
};
```

The runner will automatically detect the new file and include it in the next run.
