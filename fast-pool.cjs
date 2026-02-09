/**
 * FastResourcePool - CommonJS Module
 * 
 * Zero-copy shared memory resource pool implementation.
 */

// Memory Layout Offsets
const OFFSET_MAGIC = 0;
const OFFSET_CAPACITY = 1;
const OFFSET_HEAD = 2;
const OFFSET_TAIL = 3;
const OFFSET_NOTIFY = 4;
const OFFSET_SLOTS_START = 5;

// Slot States
const STATE_FREE = 0;
const STATE_BUSY = 1;
const STATE_LOCKED = 2;

class FastResourcePool {
  constructor(capacity) {
    if (capacity <= 0 || capacity > 65536) {
      throw new Error('Capacity must be between 1 and 65536');
    }

    this.capacity = capacity;
    this.magicValue = 0xBEEFC0DE | 0;

    // Create SharedArrayBuffer for control plane
    const totalSize = OFFSET_SLOTS_START + capacity;
    const buffer = new SharedArrayBuffer(totalSize * 4);
    this.state = new Int32Array(buffer);

    // Initialize header
    Atomics.store(this.state, OFFSET_MAGIC, this.magicValue);
    Atomics.store(this.state, OFFSET_CAPACITY, capacity);
    Atomics.store(this.state, OFFSET_HEAD, 0);
    Atomics.store(this.state, OFFSET_TAIL, 0);
    Atomics.store(this.state, OFFSET_NOTIFY, 0);

    // Initialize all slots to FREE
    for (let i = 0; i < capacity; i++) {
      Atomics.store(this.state, OFFSET_SLOTS_START + i, STATE_FREE);
    }
  }

  acquire() {
    const cap = this.capacity;
    const start = Atomics.load(this.state, OFFSET_HEAD);

    for (let i = 0; i < cap; i++) {
      const index = (start + i) % cap;
      const slotOffset = OFFSET_SLOTS_START + index;
      const current = Atomics.load(this.state, slotOffset);

      if (current === STATE_FREE) {
        const original = Atomics.compareExchange(
          this.state,
          slotOffset,
          STATE_FREE,
          STATE_BUSY
        );

        if (original === STATE_FREE) {
          Atomics.store(this.state, OFFSET_HEAD, (index + 1) % cap);
          return index;
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

  release(handle) {
    if (handle < 0 || handle >= this.capacity) {
      throw new Error(`Invalid handle: ${handle} (capacity: ${this.capacity})`);
    }

    const slotOffset = OFFSET_SLOTS_START + handle;
    const original = Atomics.compareExchange(
      this.state,
      slotOffset,
      STATE_BUSY,
      STATE_FREE
    );

    if (original !== STATE_BUSY) {
      throw new Error(`Invalid release for slot ${handle} (state: ${original})`);
    }

    Atomics.add(this.state, OFFSET_NOTIFY, 1);
    Atomics.notify(this.state, OFFSET_NOTIFY, 1);
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
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      const slotOffset = OFFSET_SLOTS_START + i;
      if (Atomics.load(this.state, slotOffset) === STATE_FREE) {
        count++;
      }
    }
    return count;
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

    return original === STATE_FREE;
  }

  unlockSlot(index) {
    if (index < 0 || index >= this.capacity) {
      throw new Error(`Invalid index: ${index} (capacity: ${this.capacity})`);
    }

    const slotOffset = OFFSET_SLOTS_START + index;
    Atomics.store(this.state, slotOffset, STATE_FREE);
    Atomics.add(this.state, OFFSET_NOTIFY, 1);
    Atomics.notify(this.state, OFFSET_NOTIFY, 1);
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
      head: Atomics.load(this.state, OFFSET_HEAD),
      notifyCounter: Atomics.load(this.state, OFFSET_NOTIFY),
      valid: this.validate(),
    };
  }
}

module.exports = { FastResourcePool };
