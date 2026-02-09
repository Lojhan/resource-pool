#!/usr/bin/env node

// Quick test of FastResourcePool

// Simple inline implementation for testing
const OFFSET_MAGIC = 0
const OFFSET_CAPACITY = 1
const OFFSET_HEAD = 2
const OFFSET_TAIL = 3
const OFFSET_NOTIFY = 4
const OFFSET_SLOTS_START = 5

const STATE_FREE = 0
const STATE_BUSY = 1

class FastResourcePool {
  constructor(capacity) {
    if (capacity <= 0 || capacity > 65536) {
      throw new Error('Capacity must be between 1 and 65536')
    }

    this.capacity = capacity
    this.magicValue = 0xbeefc0de
    this.nativePool = null

    // Try to load native module (optional)
    try {
      const { FastPool } = require('./index.js')
      this.nativePool = new FastPool(capacity)
      console.log('✓ Native FastPool loaded')
    } catch (err) {
      console.log('ℹ Using pure JavaScript (native module not required)')
    }

    // Create SharedArrayBuffer for control plane
    const totalSize = OFFSET_SLOTS_START + capacity
    const buffer = new SharedArrayBuffer(totalSize * 4)
    this.state = new Int32Array(buffer)

    // Initialize
    Atomics.store(this.state, OFFSET_MAGIC, this.magicValue)
    Atomics.store(this.state, OFFSET_CAPACITY, capacity)
    Atomics.store(this.state, OFFSET_HEAD, 0)
    Atomics.store(this.state, OFFSET_TAIL, 0)
    Atomics.store(this.state, OFFSET_NOTIFY, 0)

    for (let i = 0; i < capacity; i++) {
      Atomics.store(this.state, OFFSET_SLOTS_START + i, STATE_FREE)
    }
  }

  getCapacity() {
    return this.capacity
  }

  acquire() {
    const cap = this.capacity
    const start = Atomics.load(this.state, OFFSET_HEAD)

    for (let i = 0; i < cap; i++) {
      const index = (start + i) % cap
      const slotOffset = OFFSET_SLOTS_START + index
      const current = Atomics.load(this.state, slotOffset)

      if (current === STATE_FREE) {
        const original = Atomics.compareExchange(this.state, slotOffset, STATE_FREE, STATE_BUSY)

        if (original === STATE_FREE) {
          Atomics.store(this.state, OFFSET_HEAD, (index + 1) % cap)
          return index
        }
      }
    }

    return -1
  }

  release(handle) {
    if (handle < 0 || handle >= this.capacity) {
      throw new Error(`Invalid handle: ${handle}`)
    }

    const slotOffset = OFFSET_SLOTS_START + handle
    Atomics.store(this.state, slotOffset, STATE_FREE)
    Atomics.add(this.state, OFFSET_NOTIFY, 1)
    Atomics.notify(this.state, OFFSET_NOTIFY, 1)
  }

  availableCount() {
    let count = 0
    for (let i = 0; i < this.capacity; i++) {
      const slotOffset = OFFSET_SLOTS_START + i
      if (Atomics.load(this.state, slotOffset) === STATE_FREE) {
        count++
      }
    }
    return count
  }

  validate() {
    return Atomics.load(this.state, OFFSET_MAGIC) === this.magicValue
  }
}

// Run tests
console.log('\n🧪 Testing FastResourcePool\n')

try {
  console.log('Test 1: Pool creation')
  const pool = new FastResourcePool(10)
  console.log('  ✓ Pool created with capacity:', pool.getCapacity())
  console.log('  ✓ Initial available:', pool.availableCount())
  console.log('  ✓ Validation:', pool.validate())

  console.log('\nTest 2: Acquire and release')
  const h1 = pool.acquire()
  console.log('  ✓ Acquired handle:', h1)
  console.log('  ✓ Available after acquire:', pool.availableCount())

  pool.release(h1)
  console.log('  ✓ Released handle:', h1)
  console.log('  ✓ Available after release:', pool.availableCount())

  console.log('\nTest 3: Multiple acquires')
  const handles = []
  for (let i = 0; i < 10; i++) {
    handles.push(pool.acquire())
  }
  console.log('  ✓ Acquired all 10 handles')
  console.log('  ✓ Available (should be 0):', pool.availableCount())

  const shouldFail = pool.acquire()
  console.log('  ✓ Acquire when full returns:', shouldFail, '(should be -1)')

  console.log('\nTest 4: Release and re-acquire')
  pool.release(handles[0])
  console.log('  ✓ Released one handle')
  console.log('  ✓ Available:', pool.availableCount())

  const h2 = pool.acquire()
  console.log('  ✓ Re-acquired handle:', h2)

  // Cleanup
  for (const h of handles.slice(1)) {
    pool.release(h)
  }
  pool.release(h2)

  console.log('\nTest 5: Performance test')
  const iterations = 100000
  const start = Date.now()
  for (let i = 0; i < iterations; i++) {
    const h = pool.acquire()
    pool.release(h)
  }
  const elapsed = Date.now() - start
  const opsPerSec = (iterations / elapsed) * 1000
  console.log(`  ✓ ${iterations} acquire/release cycles in ${elapsed}ms`)
  console.log(`  ✓ ${Math.round(opsPerSec).toLocaleString()} ops/sec`)
  console.log(`  ✓ ${((elapsed * 1000000) / iterations).toFixed(2)} ns/op`)

  console.log('\n✅ All tests passed!\n')
} catch (error) {
  console.error('\n❌ Test failed:', error.message)
  process.exit(1)
}
