/**
 * Title: Optimized Memory Leak Detection for Pooled Resources
 * Description: A statistically rigorous harness for validating memory stability
 *              using Linear Regression and Composite Metric Tracking.
 *
 * Usage: node --test --expose-gc memory-leak.test.mjs
 */

import { strict as assert } from 'node:assert'
import process from 'node:process'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { GenericObjectPool } from '../../index.wrapper.mjs'

/**
 * Calculates the slope of the line of best fit (Linear Regression).
 * This provides a noise-resistant metric for memory trends.
 *
 * Formula: m = (n*Sum(xy) - Sum(x)*Sum(y)) / (n*Sum(x^2) - (Sum(x))^2)
 *
 * @param {number} yValues - Dependent variable (Memory usage in MB)
 * @param {number} xValues - Independent variable (Iteration count)
 * @returns {number} The slope (m).
 */
function calculateSlope(yValues, xValues) {
  const n = yValues.length
  if (n !== xValues.length) throw new Error('Dataset mismatch')

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0

  for (let i = 0; i < n; i++) {
    sumX += xValues[i]
    sumY += yValues[i]
    sumXY += xValues[i] * yValues[i]
    sumXX += xValues[i] * xValues[i]
  }

  const numerator = n * sumXY - sumX * sumY
  const denominator = n * sumXX - sumX * sumX

  if (denominator === 0) return 0 // Vertical line (undefined slope), assume 0
  return numerator / denominator
}

/**
 * Robust Garbage Collection Helper.
 *
 * A single global.gc() is often insufficient to collect all generations,
 * especially when WeakRefs or external buffers are involved.
 * This function "pumps" the GC multiple times while yielding to the event loop.
 */
async function forceGC() {
  if (!global.gc) {
    throw new Error('Garbage collection is not exposed. Run with node --expose-gc')
  }

  // Iterate multiple times to ensure promotion and sweeping
  for (let i = 0; i < 4; i++) {
    global.gc()
    // Yield to event loop to allow cleanup callbacks (e.g. socket close) to run
    await new Promise((resolve) => setImmediate(resolve))
  }
  // Small delay for final stabilization
  await setTimeout(50)
}

/**
 * Captures the specific memory metrics relevant to Node.js applications.
 *
 * We track:
 * - HeapUsed: JS Objects (closures, wrappers)
 * - External: C++ Bindings (Buffers > 8KB, file descriptors)
 *
 * We intentionally exclude RSS to avoid OS-level paging noise.
 */
function getCompositeMemoryMB() {
  const mem = process.memoryUsage()
  return (mem.heapUsed + mem.external) / 1024 / 1024
}

async function runLeakTest(mode) {
  console.log(`\n=== Starting Memory Leak Test (${mode.toUpperCase()}) ===`)

  if (!global.gc) {
    console.warn('⚠️ Garbage collection not exposed. Skipping strict memory leak check.')
    return
  }

  // 1. Setup Resource Pool
  // We use 10KB buffers to force 'external' memory allocation (bypassing slab)
  const factory = () => ({
    id: Math.random(),
    payload: Buffer.alloc(1024 * 10),
  })

  const POOL_SIZE = 100
  const resources = Array.from({ length: POOL_SIZE }, factory)
  const pool = new GenericObjectPool(resources)

  console.log(`Pool initialized with ${pool.availableCount()} resources.`)

  // 2. Warm-up Phase
  // Crucial for JIT optimization and initial heap expansion
  const WARMUP_ITERATIONS = 5000
  console.log(`Warming up (${WARMUP_ITERATIONS} iterations)...`)

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const res = mode === 'async' ? await pool.acquireAsync() : pool.acquire()
    res.id++
    pool.release(res)
  }

  // Establish Baseline
  await forceGC()
  const baselineMemory = getCompositeMemoryMB()
  console.log(`Baseline Memory: ${baselineMemory.toFixed(2)} MB`)

  // 3. Measurement Loop
  // Reduced iterations for CI speed, but sufficient for trend analysis
  const ITERATIONS = 50000
  const SAMPLE_INTERVAL = 1000

  const samples = []
  const xValues = []

  console.log(`Running Main Loop (${ITERATIONS} iterations)...`)

  for (let i = 0; i <= ITERATIONS; i++) {
    const res = mode === 'async' ? await pool.acquireAsync() : pool.acquire()
    res.id++
    pool.release(res)

    if (i % SAMPLE_INTERVAL === 0) {
      // Force GC to ensure we are measuring retained memory (actual leak)
      // and not just temporary allocation pressure.
      await forceGC()
      const currentMem = getCompositeMemoryMB()
      samples.push(currentMem)
      xValues.push(i)
    }
  }

  // 4. Final Cleanup & Analysis
  await forceGC()
  const finalMemory = getCompositeMemoryMB()

  // Add final stable point to regression dataset
  samples.push(finalMemory)
  xValues.push(ITERATIONS)

  console.log(`Final Memory: ${finalMemory.toFixed(2)} MB`)

  // Calculate Slope
  const slope = calculateSlope(samples, xValues)

  // Project growth over 1 million iterations to make the number human-readable
  const projectedGrowthPer1M = slope * 1_000_000

  console.log('--- Statistical Analysis ---')
  console.log(`Slope: ${slope.toExponential(4)} MB/iter`)
  console.log(`Projected Growth (per 1M ops): ${projectedGrowthPer1M.toFixed(2)} MB`)

  // 5. Assertion
  // Threshold: Allow < 5MB growth per 1M operations (0.005 KB/op).
  // This accounts for minor internal V8 fragmentation/metadata growth.
  // A true leak of 10KB buffers would be 10,000 MB per 1M ops.
  const LEAK_THRESHOLD_MB_PER_1M = 5.0

  if (projectedGrowthPer1M > LEAK_THRESHOLD_MB_PER_1M) {
    console.error('FAILURE: Significant memory growth trend detected.')
    console.error(`Trend: ${samples.map((n) => n.toFixed(1)).join(' -> ')}`)
    assert.fail(
      `Memory Leak Detected! Growth rate of ${projectedGrowthPer1M.toFixed(2)} MB/1M ops exceeds limit of ${LEAK_THRESHOLD_MB_PER_1M} MB.`,
    )
  } else {
    console.log('SUCCESS: Memory usage is statistically stable.')
    assert.ok(true)
  }
}

test('Memory Leak Check - Async', async () => {
  await runLeakTest('async')
})

test('Memory Leak Check - Sync', async () => {
  await runLeakTest('sync')
})
