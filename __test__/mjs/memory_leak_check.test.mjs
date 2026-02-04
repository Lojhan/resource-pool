import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { GenericObjectPool } from '../../index.wrapper.mjs'

function formatMemory(usage) {
  return `RSS: ${(usage.rss / 1024 / 1024).toFixed(2)} MB, Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`
}

test('Memory Leak Check (MJS) - Async', async () => {
  await runLeakTest('async')
})

test('Memory Leak Check (MJS) - Sync', async () => {
  await runLeakTest('sync')
})

async function runLeakTest(mode) {
  console.log(`Starting Memory Leak Test (${mode.toUpperCase()})...`)

  // 1. Setup Pool
  const factory = () => ({
    id: Math.random(),
    payload: Buffer.alloc(1024 * 10), // 10KB payload to make leaks obvious
  })

  const resources = Array.from({ length: 100 }, factory)
  const pool = new GenericObjectPool(resources)

  console.log(`Pool created with ${pool.availableCount()} resources.`)

  const ITERATIONS = 500000
  const LOG_INTERVAL = 50000
  const WARMUP_ITERATIONS = 20000

  console.log(`Warming up for ${WARMUP_ITERATIONS} iterations...`)
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    let res
    if (mode === 'async') {
      res = await pool.acquireAsync(null)
    } else {
      res = pool.acquire()
    }
    res.id = res.id + 1
    pool.release(res)
  }

  if (global.gc) global.gc()
  await new Promise((r) => setTimeout(r, 200))

  const initialMemory = process.memoryUsage()
  console.log('Baseline Memory (after warmup):', formatMemory(initialMemory))

  const memorySamples = []

  // 2. Run Loop
  for (let i = 0; i < ITERATIONS; i++) {
    let res
    if (mode === 'async') {
      res = await pool.acquireAsync(null)
    } else {
      res = pool.acquire()
    }
    res.id = res.id + 1
    pool.release(res)

    if (i % LOG_INTERVAL === 0) {
      if (global.gc) global.gc()
      const currentMemory = process.memoryUsage()
      const rssMB = currentMemory.rss / 1024 / 1024
      memorySamples.push(rssMB)
      const deltaRSS = (currentMemory.rss - initialMemory.rss) / 1024 / 1024
      console.log(`Iteration ${i}: RSS = ${rssMB.toFixed(2)} MB (Delta: ${deltaRSS.toFixed(2)} MB)`)
    }
  }

  // 3. Final Check
  if (global.gc) global.gc()
  await new Promise((r) => setTimeout(r, 1000))
  if (global.gc) global.gc()

  const finalMemory = process.memoryUsage()
  const finalRSS = finalMemory.rss / 1024 / 1024
  memorySamples.push(finalRSS)
  console.log('Final Memory:', formatMemory(finalMemory))

  const sampleCountToCheck = 5
  if (memorySamples.length >= sampleCountToCheck) {
    const recentSamples = memorySamples.slice(-sampleCountToCheck)
    const min = Math.min(...recentSamples)
    const max = Math.max(...recentSamples)
    const spread = max - min

    console.log(
      `Stability Check (last ${sampleCountToCheck} samples): Min=${min.toFixed(2)} MB, Max=${max.toFixed(2)} MB, Spread=${spread.toFixed(2)} MB`,
    )

    const STABILITY_THRESHOLD_MB = 10

    // Check if distinct upward trend bigger than threshold
    const firstOfRecent = recentSamples[0]
    const lastOfRecent = recentSamples[recentSamples.length - 1]

    if (lastOfRecent > firstOfRecent + STABILITY_THRESHOLD_MB) {
      assert.fail(
        `POTENTIAL LEAK: Memory did not stabilize. Grew from ${firstOfRecent.toFixed(2)} to ${lastOfRecent.toFixed(2)} MB in last segment.`,
      )
    } else {
      assert.ok(true, 'Memory stabilized.')
    }
  } else {
    console.warn('Not enough samples for stability check, passing based on final check.')
    assert.ok(true, 'Test passed (insufficient samples for stability).')
  }
}
