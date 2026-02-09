/**
 * Tests for FastResourcePool - Zero-Copy Shared Memory Architecture
 * 
 * This test suite validates the lock-free atomic operations and
 * shared memory correctness of the FastResourcePool.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { FastResourcePool } = require('../../../fast-pool.cjs');

test('FastResourcePool: basic creation and validation', () => {
  const pool = new FastResourcePool(10);
  
  assert.strictEqual(pool.getCapacity(), 10);
  assert.strictEqual(pool.availableCount(), 10);
  assert.strictEqual(pool.validate(), true);
});

test('FastResourcePool: synchronous acquire and release', () => {
  const pool = new FastResourcePool(5);
  
  // Acquire all slots
  const handles = [];
  for (let i = 0; i < 5; i++) {
    const handle = pool.acquire();
    assert.notStrictEqual(handle, -1, `Should acquire slot ${i}`);
    handles.push(handle);
  }
  
  // Pool should be exhausted
  assert.strictEqual(pool.availableCount(), 0);
  assert.strictEqual(pool.acquire(), -1, 'Should return -1 when pool is full');
  
  // Release one slot
  pool.release(handles[0]);
  assert.strictEqual(pool.availableCount(), 1);
  
  // Should be able to acquire again
  const newHandle = pool.acquire();
  assert.notStrictEqual(newHandle, -1, 'Should acquire after release');
});

test('FastResourcePool: async acquire with immediate availability', async () => {
  const pool = new FastResourcePool(3);
  
  const handle = await pool.acquireAsync();
  assert.notStrictEqual(handle, -1);
  assert.ok(handle >= 0 && handle < 3);
  
  pool.release(handle);
});

test('FastResourcePool: async acquire with backpressure', async () => {
  const pool = new FastResourcePool(2);
  
  // Acquire all slots
  const h1 = pool.acquire();
  const h2 = pool.acquire();
  assert.strictEqual(pool.availableCount(), 0);
  
  // Start async acquire (will wait)
  const acquirePromise = pool.acquireAsync(500);
  
  // Release after short delay
  setTimeout(() => {
    pool.release(h1);
  }, 50);
  
  // Should successfully acquire
  const h3 = await acquirePromise;
  assert.notStrictEqual(h3, -1);
  
  // Cleanup
  pool.release(h2);
  pool.release(h3);
});

test('FastResourcePool: async acquire timeout', async () => {
  const pool = new FastResourcePool(1);
  
  // Acquire the only slot
  const handle = pool.acquire();
  assert.notStrictEqual(handle, -1);
  
  // Try to acquire with timeout
  await assert.rejects(
    async () => {
      await pool.acquireAsync(100);
    },
    /timeout/i,
    'Should timeout when pool is full'
  );
  
  pool.release(handle);
});

test('FastResourcePool: concurrent acquire operations', () => {
  const pool = new FastResourcePool(100);
  
  const acquired = new Set();
  
  // Simulate concurrent acquires
  for (let i = 0; i < 100; i++) {
    const handle = pool.acquire();
    assert.notStrictEqual(handle, -1, `Should acquire slot ${i}`);
    assert.ok(!acquired.has(handle), `Handle ${handle} should be unique`);
    acquired.add(handle);
  }
  
  assert.strictEqual(acquired.size, 100, 'All handles should be unique');
  assert.strictEqual(pool.availableCount(), 0);
  
  // Release all
  for (const handle of acquired) {
    pool.release(handle);
  }
  
  assert.strictEqual(pool.availableCount(), 100);
});

test('FastResourcePool: lock and unlock slots', () => {
  const pool = new FastResourcePool(3);
  
  // Lock slot 1
  assert.strictEqual(pool.lockSlot(1), true, 'Should lock free slot');
  
  // Try to lock again
  assert.strictEqual(pool.lockSlot(1), false, 'Should not lock already locked slot');
  
  // Try to acquire slot 1
  const handles = [];
  for (let i = 0; i < 2; i++) {
    const handle = pool.acquire();
    assert.notStrictEqual(handle, -1);
    assert.notStrictEqual(handle, 1, 'Should not acquire locked slot');
    handles.push(handle);
  }
  
  // Pool should be exhausted (only slots 0 and 2 were available)
  assert.strictEqual(pool.acquire(), -1);
  
  // Unlock slot 1
  pool.unlockSlot(1);
  
  // Now slot 1 should be acquirable
  const handle = pool.acquire();
  assert.notStrictEqual(handle, -1);
  
  // Cleanup
  pool.release(handle);
  for (const h of handles) {
    pool.release(h);
  }
});

test('FastResourcePool: use() helper method', async () => {
  const pool = new FastResourcePool(5);
  
  let usedHandle = -1;
  const result = await pool.use(async (handle) => {
    usedHandle = handle;
    assert.ok(handle >= 0 && handle < 5);
    return 'success';
  });
  
  assert.strictEqual(result, 'success');
  assert.notStrictEqual(usedHandle, -1);
  
  // Handle should be released
  assert.strictEqual(pool.availableCount(), 5);
});

test('FastResourcePool: use() with exception handling', async () => {
  const pool = new FastResourcePool(3);
  
  await assert.rejects(
    async () => {
      await pool.use(async (handle) => {
        throw new Error('Test error');
      });
    },
    /Test error/,
    'Should propagate errors'
  );
  
  // Handle should still be released
  assert.strictEqual(pool.availableCount(), 3);
});

test('FastResourcePool: tryUse() synchronous helper', () => {
  const pool = new FastResourcePool(2);
  
  const result = pool.tryUse((handle) => {
    assert.ok(handle >= 0 && handle < 2);
    return handle * 2;
  });
  
  assert.ok(result !== null);
  assert.strictEqual(pool.availableCount(), 2);
});

test('FastResourcePool: tryUse() when pool is full', () => {
  const pool = new FastResourcePool(1);
  
  const h1 = pool.acquire();
  
  const result = pool.tryUse((handle) => {
    return 'should not execute';
  });
  
  assert.strictEqual(result, null, 'Should return null when pool is full');
  
  pool.release(h1);
});

test('FastResourcePool: getDebugInfo()', () => {
  const pool = new FastResourcePool(10);
  
  // Acquire 3
  const h1 = pool.acquire();
  const h2 = pool.acquire();
  const h3 = pool.acquire();
  
  // Lock 2
  pool.lockSlot(5);
  pool.lockSlot(6);
  
  const info = pool.getDebugInfo();
  
  assert.strictEqual(info.capacity, 10);
  assert.strictEqual(info.busy, 3);
  assert.strictEqual(info.locked, 2);
  assert.strictEqual(info.available, 5);
  assert.strictEqual(info.valid, true);
  assert.ok(typeof info.head === 'number');
  assert.ok(typeof info.notifyCounter === 'number');
  
  // Cleanup
  pool.release(h1);
  pool.release(h2);
  pool.release(h3);
  pool.unlockSlot(5);
  pool.unlockSlot(6);
});

test('FastResourcePool: bounds checking', () => {
  const pool = new FastResourcePool(5);
  
  assert.throws(() => {
    pool.release(5);
  }, /Invalid handle/);
  
  assert.throws(() => {
    pool.release(-1);
  }, /Invalid handle/);
  
  assert.throws(() => {
    pool.isSlotFree(10);
  }, /Invalid index/);
});

test('FastResourcePool: capacity limits', () => {
  assert.throws(() => {
    new FastResourcePool(0);
  }, /Capacity must be between 1 and 65536/);
  
  assert.throws(() => {
    new FastResourcePool(100000);
  }, /Capacity must be between 1 and 65536/);
  
  // Max capacity should work
  const pool = new FastResourcePool(65536);
  assert.strictEqual(pool.getCapacity(), 65536);
});

test('FastResourcePool: stress test with rapid acquire/release', () => {
  const pool = new FastResourcePool(10);
  const iterations = 1000;
  
  for (let i = 0; i < iterations; i++) {
    const handle = pool.acquire();
    if (handle !== -1) {
      pool.release(handle);
    }
  }
  
  // Pool should be in consistent state
  assert.strictEqual(pool.availableCount(), 10);
  assert.strictEqual(pool.validate(), true);
});

test('FastResourcePool: multiple concurrent async acquires', async () => {
  const pool = new FastResourcePool(3);
  
  // Start 10 async acquires
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      pool.acquireAsync(1000).then(async (handle) => {
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 10));
        pool.release(handle);
        return handle;
      })
    );
  }
  
  const results = await Promise.all(promises);
  
  assert.strictEqual(results.length, 10);
  assert.strictEqual(pool.availableCount(), 3);
});

test('FastResourcePool: isSlotFree() accuracy', () => {
  const pool = new FastResourcePool(5);
  
  // All should be free initially
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(pool.isSlotFree(i), true);
  }
  
  // Acquire slot
  const handle = pool.acquire();
  assert.notStrictEqual(handle, -1);
  
  // That slot should not be free
  assert.strictEqual(pool.isSlotFree(handle), false);
  
  // Others should still be free
  for (let i = 0; i < 5; i++) {
    if (i !== handle) {
      assert.strictEqual(pool.isSlotFree(i), true);
    }
  }
  
  pool.release(handle);
  assert.strictEqual(pool.isSlotFree(handle), true);
});
