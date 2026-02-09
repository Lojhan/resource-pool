/**
 * Fast Resource Pool - Zero-Copy Shared Memory Architecture
 *
 * Type definitions for the high-performance resource pool using SharedArrayBuffer.
 *
 * This pool uses Int32Array for SharedArrayBuffer views to enable Atomics operations.
 */

/**
 * High-performance resource pool with zero-copy shared memory architecture.
 */
export declare class FastResourcePool {
  /**
   * Create a new FastResourcePool.
   *
   * @param capacity - Number of resource slots (max 65536)
   */
  constructor(capacity: number)

  /**
   * Acquire a resource slot (synchronous, lock-free).
   *
   * This is the HOT PATH with ~5-10ns overhead.
   *
   * @returns Resource handle (0 to capacity-1) or -1 if pool is full
   */
  acquire(): number

  /**
   * Acquire a resource slot asynchronously with backpressure handling.
   *
   * @param timeoutMs - Optional timeout in milliseconds
   * @returns Resource handle (0 to capacity-1)
   * @throws Error if timeout expires
   */
  acquireAsync(timeoutMs?: number): Promise<number>

  /**
   * Release a resource slot back to the pool.
   *
   * @param handle - Resource handle to release
   */
  release(handle: number): void

  /**
   * Check if a specific slot is free.
   *
   * Note: This is a snapshot and may be stale immediately.
   */
  isSlotFree(index: number): boolean

  /**
   * Get the current count of available (FREE) slots.
   */
  availableCount(): number

  /**
   * Get the total capacity of the pool.
   */
  getCapacity(): number

  /**
   * Validate buffer integrity.
   */
  validate(): boolean

  /**
   * Lock a slot for maintenance.
   *
   * @returns true if successfully locked, false if slot was not free
   */
  lockSlot(index: number): boolean

  /**
   * Unlock a slot, making it available again.
   */
  unlockSlot(index: number): void

  /**
   * Helper method for using resources with automatic release.
   */
  use<T>(fn: (handle: number) => Promise<T>, timeoutMs?: number): Promise<T>

  /**
   * Synchronous version of use().
   *
   * Returns null if pool is full.
   */
  tryUse<T>(fn: (handle: number) => T): T | null

  /**
   * Get debug information about the pool state.
   */
  getDebugInfo(): {
    capacity: number
    available: number
    busy: number
    locked: number
    head: number
    notifyCounter: number
    valid: boolean
  }
}

/**
 * Create a FastResourcePool with the specified capacity.
 */
export declare function createFastPool(capacity: number): FastResourcePool
