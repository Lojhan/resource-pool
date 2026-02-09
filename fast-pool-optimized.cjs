/**
 * FastResourcePool - Optimized Version with Free List
 * 
 * Optimizations:
 * 1. Free List - O(1) lookup for free slots instead of O(n) linear scan
 * 2. Defensive release - Proper CAS to prevent double-release
 * 3. Better contention handling
 */

// Memory Layout Offsets
const OFFSET_MAGIC = 0;
const OFFSET_CAPACITY = 1;
const OFFSET_FREE_COUNT = 2; // Track available count
const OFFSET_NOTIFY = 3;
const OFFSET_SLOTS_START = 4;

// Slot States
const STATE_FREE = 0;
const STATE_BUSY = 1;
const STATE_LOCKED = 2;

class FastResourcePoolOptimized {
  constructor(capacity, useNative = false) {
    if (capacity <= 0 || capacity > 65536) {
      throw new Error('Capacity must be between 1 and 65536');
    }

    this.capacity = capacity;
    this.magicValue = 0xBEEFC0DE;
    this.nativePool = null;

    // Free list for O(1) lookups - maintained in JS
    // Using a simple array as a stack
    this.freeList = [];
    for (let i = capacity - 1; i >= 0; i--) {
      this.freeList.push(i);
    }

    // Try to load native module if requested
    if (useNative) {
      try {
        const { FastPool } = require('./index.js');
        this.nativePool = new FastPool(capacity);
      } catch (err) {
        this.nativePool = null;
      }
    }

    // Create SharedArrayBuffer for control plane (still used for validation)
    const totalSize = OFFSET_SLOTS_START + capacity;
    const buffer = new SharedArrayBuffer(totalSize * 4);
    this.state = new Int32Array(buffer);

    // Initialize header
    Atomics.store(this.state, OFFSET_MAGIC, this.magicValue);
    Atomics.store(this.state, OFFSET_CAPACITY, capacity);
    Atomics.store(this.state, OFFSET_FREE_COUNT, capacity);
    Atomics.store(this.state, OFFSET_NOTIFY, 0);

    // Initialize all slots to FREE
    for (let i = 0; i < capacity; i++) {
      Atomics.store(this.state, OFFSET_SLOTS_START + i, STATE_FREE);
    }
  }

  // O(1) acquire using free list
  acquire() {
    // Try to pop from free list
    if (this.freeList.length === 0) {
      return -1; // Pool exhausted
    }

    const index = this.freeList.pop();
    const slotOffset = OFFSET_SLOTS_START + index;

    // Atomic CAS to claim the slot
    const original = Atomics.compareExchange(
      this.state,
      slotOffset,
      STATE_FREE,
      STATE_BUSY
    );

    if (original === STATE_FREE) {
      // Successfully acquired
      Atomics.sub(this.state, OFFSET_FREE_COUNT, 1);
      return index;
    } else {
      // Someone else took it or it's locked - try the next one
      // This is a rare race condition
      return this.acquireSlow();
    }
  }

  // Fallback for race conditions - linear scan
  acquireSlow() {
    for (let i = 0; i < this.capacity; i++) {
      const slotOffset = OFFSET_SLOTS_START + i;
      const current = Atomics.load(this.state, slotOffset);

      if (current === STATE_FREE) {
        const original = Atomics.compareExchange(
          this.state,
          slotOffset,
          STATE_FREE,
          STATE_BUSY
        );

        if (original === STATE_FREE) {
          Atomics.sub(this.state, OFFSET_FREE_COUNT, 1);
          return i;
        }
      }
    }
    return -1;
  }

  async acquireAsync(timeoutMs) {
    const deadline = timeoutMs ? Date.now() + timeoutMs : undefined;

    // Try fast path first
    let handle = this.acquire();
    if (handle !== -1) return handle;

    // Slow path: Wait for notification
    while (true) {
      const timeout = deadline ? Math.max(0, deadline - Date.now()) : undefined;
      
      if (timeout !== undefined && timeout <= 0) {
        throw new Error(`Failed to acquire resource within ${timeoutMs}ms timeout`);
      }

      const currentNotifyValue = Atomics.load(this.state, OFFSET_NOTIFY);

      const result = Atomics.waitAsync(
        this.state,
        OFFSET_NOTIFY,
        currentNotifyValue,
        timeout
      );

      if (result.async) {
        const awaitResult = await result.value;
        
        if (awaitResult === 'timed-out') {
          throw new Error(`Failed to acquire resource within ${timeoutMs}ms timeout`);
        }
      }

      handle = this.acquire();
      if (handle !== -1) return handle;
    }
  }

  // Defensive release with CAS
  release(handle) {
    if (handle < 0 || handle >= this.capacity) {
      throw new Error(`Invalid handle: ${handle} (capacity: ${this.capacity})`);
    }

    const slotOffset = OFFSET_SLOTS_START + handle;

    // Use CAS to ensure we only release BUSY slots
    const original = Atomics.compareExchange(
      this.state,
      slotOffset,
      STATE_BUSY,
      STATE_FREE
    );

    if (original === STATE_BUSY) {
      // Successfully released - add back to free list
      this.freeList.push(handle);
      Atomics.add(this.state, OFFSET_FREE_COUNT, 1);
      Atomics.add(this.state, OFFSET_NOTIFY, 1);
      Atomics.notify(this.state, OFFSET_NOTIFY, 1);
    } else {
      // Slot was not busy - this is an error
      console.warn(`Warning: Attempted to release non-busy slot ${handle} (state: ${original})`);
    }
  }

  isSlotFree(index) {
    if (index < 0 || index >= this.capacity) {
      throw new Error(`Invalid index: ${index} (capacity: ${this.capacity})`);
    }

    const slotOffset = OFFSET_SLOTS_START + index;
    const state = Atomics.load(this.state, slotOffset);
    return state === STATE_FREE;
  }

  availableCount() {
    // Fast path - read from counter
    return Atomics.load(this.state, OFFSET_FREE_COUNT);
  }

  getCapacity() {
    return this.capacity;
  }

  validate() {
    return Atomics.load(this.state, OFFSET_MAGIC) === this.magicValue;
  }

  lockSlot(index) {
    if (index < 0 || index >= this.capacity) {
      throw new Error(`Invalid index: ${index} (capacity: ${this.capacity})`);
    }

    const slotOffset = OFFSET_SLOTS_START + index;
    const original = Atomics.compareExchange(
      this.state,
      slotOffset,
      STATE_FREE,
      STATE_LOCKED
    );

    if (original === STATE_FREE) {
      // Remove from free list
      const idx = this.freeList.indexOf(index);
      if (idx !== -1) {
        this.freeList.splice(idx, 1);
      }
      Atomics.sub(this.state, OFFSET_FREE_COUNT, 1);
    }

    return original === STATE_FREE;
  }

  unlockSlot(index) {
    if (index < 0 || index >= this.capacity) {
      throw new Error(`Invalid index: ${index} (capacity: ${this.capacity})`);
    }

    const slotOffset = OFFSET_SLOTS_START + index;
    
    const original = Atomics.compareExchange(
      this.state,
      slotOffset,
      STATE_LOCKED,
      STATE_FREE
    );

    if (original === STATE_LOCKED) {
      this.freeList.push(index);
      Atomics.add(this.state, OFFSET_FREE_COUNT, 1);
      Atomics.add(this.state, OFFSET_NOTIFY, 1);
      Atomics.notify(this.state, OFFSET_NOTIFY, 1);
    }
  }

  async use(fn, timeoutMs) {
    const handle = await this.acquireAsync(timeoutMs);
    try {
      return await fn(handle);
    } finally {
      this.release(handle);
    }
  }

  tryUse(fn) {
    const handle = this.acquire();
    if (handle === -1) return null;

    try {
      return fn(handle);
    } finally {
      this.release(handle);
    }
  }

  getDebugInfo() {
    let busy = 0;
    let locked = 0;
    let free = 0;

    for (let i = 0; i < this.capacity; i++) {
      const state = Atomics.load(this.state, OFFSET_SLOTS_START + i);
      if (state === STATE_FREE) free++;
      else if (state === STATE_BUSY) busy++;
      else if (state === STATE_LOCKED) locked++;
    }

    return {
      capacity: this.capacity,
      available: free,
      busy,
      locked,
      freeListSize: this.freeList.length,
      notifyCounter: Atomics.load(this.state, OFFSET_NOTIFY),
      valid: this.validate(),
    };
  }
}

module.exports = { FastResourcePoolOptimized };
