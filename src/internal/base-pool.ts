const OFFSET_LOCK = 0
const OFFSET_COUNT = 1
const OFFSET_NOTIFY = 2
const OFFSET_STACK_START = 3

// 0 = Unlocked, 1 = Locked
const LOCK_UNLOCKED = 0
const LOCK_LOCKED = 1

export class BasePool {
  private buffer: SharedArrayBuffer
  private state: Int32Array
  private capacity: number
  private stackOffset: number

  constructor(capacityOrBuffer: number | SharedArrayBuffer) {
    if (capacityOrBuffer instanceof SharedArrayBuffer) {
      this.buffer = capacityOrBuffer
      this.state = new Int32Array(this.buffer)
      this.capacity = this.state.length - OFFSET_STACK_START
      this.stackOffset = OFFSET_STACK_START
    } else {
      this.capacity = capacityOrBuffer
      // Layout: [LOCK, COUNT, NOTIFY, ...STACK_INDICES]
      const totalInt32s = OFFSET_STACK_START + this.capacity
      this.buffer = new SharedArrayBuffer(totalInt32s * 4)
      this.state = new Int32Array(this.buffer)
      this.stackOffset = OFFSET_STACK_START

      // Initialize header
      Atomics.store(this.state, OFFSET_LOCK, LOCK_UNLOCKED)
      Atomics.store(this.state, OFFSET_COUNT, 0) // Start with 0 available
      Atomics.store(this.state, OFFSET_NOTIFY, 0)

      // Note: We don't fill the stack yet.
      // Higher level logic decides which slots are free to ensure synchronization
      // between the SAB and the actual JS resource array.
    }
  }

  public getBuffer() {
    return this.buffer
  }

  /**
   * O(1) Acquire using a LIFO stack protected by a spinlock.
   */
  public acquire(): number {
    const state = this.state

    // 1. Try to lock
    // Fast path: CAS 0 -> 1
    let locked = Atomics.compareExchange(state, OFFSET_LOCK, LOCK_UNLOCKED, LOCK_LOCKED) === LOCK_UNLOCKED

    if (!locked) {
      // Spin loop (wait for lock)
      while (true) {
        if (Atomics.load(state, OFFSET_LOCK) === LOCK_UNLOCKED) {
          if (Atomics.compareExchange(state, OFFSET_LOCK, LOCK_UNLOCKED, LOCK_LOCKED) === LOCK_UNLOCKED) {
            locked = true
            break
          }
        }
        // Yield to avoid burning CPU too hard in high contention
        // In strict JS environment we can't yield, but we can rely on randomness of OS scheduling
      }
    }

    // 2. Critical Section
    try {
      const count = Atomics.load(state, OFFSET_COUNT)
      if (count > 0) {
        const newCount = count - 1
        Atomics.store(state, OFFSET_COUNT, newCount)
        // Pop from stack: read value at newCount index
        return Atomics.load(state, this.stackOffset + newCount)
      }
      return -1
    } finally {
      // 3. Unlock
      Atomics.store(state, OFFSET_LOCK, LOCK_UNLOCKED)
    }
  }

  /**
   * O(1) Release
   */
  public release(handle: number) {
    const state = this.state

    // Spinlock
    while (Atomics.compareExchange(state, OFFSET_LOCK, LOCK_UNLOCKED, LOCK_LOCKED) !== LOCK_UNLOCKED) {}

    try {
      const count = Atomics.load(state, OFFSET_COUNT)
      // Push to stack
      Atomics.store(state, this.stackOffset + count, handle)
      Atomics.store(state, OFFSET_COUNT, count + 1)
    } finally {
      Atomics.store(state, OFFSET_LOCK, LOCK_UNLOCKED)
    }

    // Notify waiters (outside lock to reduce contention)
    Atomics.add(state, OFFSET_NOTIFY, 1)
    Atomics.notify(state, OFFSET_NOTIFY, 1)
  }

  /**
   * Async acquire with timeout support
   */
  public async acquireAsync(timeoutMs?: number): Promise<number> {
    const deadline = timeoutMs ? Date.now() + timeoutMs : Infinity

    while (true) {
      // Try sync acquire first
      const handle = this.acquire()
      if (handle !== -1) return handle

      if (timeoutMs && Date.now() >= deadline) {
        throw new Error(`Timeout acquiring resource (${timeoutMs}ms)`)
      }

      // Prepare to wait
      const notifyValue = Atomics.load(this.state, OFFSET_NOTIFY)

      // Double check before waiting (race condition fix)
      if (Atomics.load(this.state, OFFSET_COUNT) > 0) continue

      const timeLeft = deadline === Infinity ? Infinity : deadline - Date.now()
      if (timeLeft <= 0) continue

      const result = Atomics.waitAsync(this.state, OFFSET_NOTIFY, notifyValue, timeLeft)

      if (result.async) {
        // Keep process alive during wait
        const timer = setInterval(() => {}, 60 * 60 * 1000)
        try {
          await result.value
        } finally {
          clearInterval(timer)
        }
      }
    }
  }

  public availableCount() {
    return Atomics.load(this.state, OFFSET_COUNT)
  }

  public getCapacity() {
    return this.capacity
  }

  public destroy() {
    // Lock to prevent operations
    while (Atomics.compareExchange(this.state, OFFSET_LOCK, LOCK_UNLOCKED, LOCK_LOCKED) !== LOCK_UNLOCKED) {}

    Atomics.store(this.state, OFFSET_COUNT, 0)
    Atomics.store(this.state, OFFSET_NOTIFY, 0)
    // Release lock just in case, though buffer is technically dead
    Atomics.store(this.state, OFFSET_LOCK, LOCK_UNLOCKED)

    // Wake everyone up so they can fail gracefully
    Atomics.add(this.state, OFFSET_NOTIFY, 1)
    Atomics.notify(this.state, OFFSET_NOTIFY, Infinity)
  }
}
