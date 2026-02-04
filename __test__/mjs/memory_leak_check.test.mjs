import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { GenericObjectPool } from '../../index.wrapper.mjs';

function formatMemory(usage) {
  return `RSS: ${(usage.rss / 1024 / 1024).toFixed(2)} MB, Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`;
}

test('Memory Leak Check (MJS)', async () => {
    console.log('Starting Memory Leak Test (MJS)...');

    // 1. Setup Pool
    const factory = () => ({ 
      id: Math.random(), 
      payload: Buffer.alloc(1024 * 10) // 10KB payload to make leaks obvious
    });
    
    const resources = Array.from({ length: 100 }, factory);
    const pool = new GenericObjectPool(resources);
  
    console.log(`Pool created with ${pool.availableCount()} resources.`);
  
    const ITERATIONS = 100000;
    const LOG_INTERVAL = 10000;
  
    const initialMemory = process.memoryUsage();
    console.log('Initial Memory:', formatMemory(initialMemory));
  
    // 2. Run Loop
    for (let i = 0; i < ITERATIONS; i++) {
        const res = await pool.acquireAsync(null);
        res.id = res.id + 1;
        pool.release(res);
  
        if (i % LOG_INTERVAL === 0) {
            if (global.gc) global.gc();
            const currentMemory = process.memoryUsage();
            const deltaRSS = (currentMemory.rss - initialMemory.rss) / 1024 / 1024;
            console.log(`Iteration ${i}: RSS Delta = ${deltaRSS.toFixed(2)} MB`);
        }
    }
  
    // 3. Final Check
    if (global.gc) global.gc();
    await new Promise(r => setTimeout(r, 1000));
    if (global.gc) global.gc();
  
    const finalMemory = process.memoryUsage();
    console.log('Final Memory:', formatMemory(finalMemory));
    
    const rssGrowth = finalMemory.rss - initialMemory.rss;
  
    console.log(`RSS Growth: ${(rssGrowth / 1024 / 1024).toFixed(2)} MB`);
  
    const TOLERANCE_MB = 20;
    if (rssGrowth > TOLERANCE_MB * 1024 * 1024) {
      assert.fail(`POTENTIAL LEAK DETECTED: RSS grew by ${(rssGrowth / 1024 / 1024).toFixed(2)} MB.`);
    } else {
      assert.ok(true, 'No significant memory leak detected.');
    }
});
