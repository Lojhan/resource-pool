import nativeModule from './index.js'

const NativePool = nativeModule.GenericObjectPool

/**
 * Type-safe wrapper for a generic resource pool
 * @template T
 */
export class GenericObjectPool {
  /**
   * Create a new resource pool
   * @param {T[]} resources - Initial resources in the pool
   */
  constructor(resources) {
    // 1. Store resources in a JS Array (Fast access)
    this.resources = [...resources]

    // 2. Map Resource -> Index for O(1) release
    this.resourceToIdx = new Map()
    this.resources.forEach((r, i) => this.resourceToIdx.set(r, i))

    // 3. Initialize Rust pool with just the COUNT
    this.pool = new NativePool(resources.length)
  }

  /**
   * Acquire a resource from the pool synchronously
   * Throws error if no resources available
   * @returns {T} A resource from the pool
   * @throws Error if no resources are available
   */
  acquire() {
    // Rust gives us the integer (Index)
    const idx = this.pool.acquire()
    // JS gives us the object (Array Lookup)
    return this.resources[idx]
  }

  /**
   * Acquire a resource from the pool asynchronously with retry
   * @param {number} [timeoutMs] - Optional timeout in milliseconds. If provided, will throw after timeout.
   * @returns {Promise<T>} Promise that resolves with a resource when one becomes available
   * @throws Error if timeout is exceeded before acquiring a resource
   */
  async acquireAsync(timeoutMs) {
    const idx = await this.pool.acquireAsync(timeoutMs)
    return this.resources[idx]
  }

  /**
   * Release a resource back to the pool
   * @param {T} resource - The resource to release
   */
  release(resource) {
    // O(1) Lookup
    const idx = this.resourceToIdx.get(resource)

    if (idx === undefined) {
      throw new Error('Resource not belonging to pool')
    }

    this.pool.release(idx)
  }

  /**
   * Add a new resource to the pool
   * @param {T} resource - The resource to add
   */
  add(resource) {
    const newIdx = this.resources.length
    this.resources.push(resource)
    this.resourceToIdx.set(resource, newIdx)
    this.pool.add(newIdx)
  }

  /**
   * Remove one available resource from the pool
   * @returns {boolean} true if a resource was removed, false if all are currently in use
   */
  removeOne() {
    const idx = this.pool.removeOne()
    if (idx === null) return false

    // We mark the slot as empty or null, but we don't resize the array
    // to keep indices stable.
    // Ideally, for a dynamic pool, you'd want a free-list in JS,
    // but for this implementation, we just remove the mapping.
    const resource = this.resources[idx]
    this.resourceToIdx.delete(resource)
    this.resources[idx] = null
    return true
  }

  /**
   * Use a resource from the pool with automatic release
   * @template R
   * @param {(resource: T) => Promise<R>} fn - Function to execute with the resource
   * @param {{optimistic?: boolean, timeout?: number}} [options] - Configuration options for acquisition
   * @returns {Promise<R>}
   */
  async use(fn, { optimistic = true, timeout } = {}) {
    let resource
    if (optimistic) {
      try {
        const idx = this.pool.acquire()
        resource = this.resources[idx]
      } catch {}
    }

    if (!resource) {
      const idx = await this.pool.acquireAsync(timeout)
      resource = this.resources[idx]
    }

    try {
      return await fn(resource)
    } finally {
      // Manual inline release for performance
      const idx = this.resourceToIdx.get(resource)
      if (idx !== undefined) {
        this.pool.release(idx)
      }
    }
  }

  /**
   * Get the number of available resources in the pool
   * @returns {number} Number of available resources
   */
  availableCount() {
    return this.pool.availableCount()
  }
  /**
   * Get the total number of resources managed by the pool
   * @returns {number}
   */
  get size() {
    return this.pool.size()
  }
  get pendingCount() {
    return this.pool.pendingCount()
  }
  /**
   * Get the number of available resources
   * @returns {number}
   */
  get available() {
    return this.pool.availableCount()
  }
  /**
   * Get the number of used resources
   * @returns {number}
   */
  get numUsed() {
    return this.pool.size() - this.pool.availableCount()
  }

  /**
   * Destroy the pool and stop accepting new acquires
   */
  destroy() {
    // Destroy Rust pool (closes semaphore)
    this.pool.destroy()
    // Clear JS references
    this.resources = []
    this.resourceToIdx.clear()
  }
}
