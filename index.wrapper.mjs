import nativeModule from './index.js'

const NativePool = nativeModule.GenericObjectPool

/**
 * @template T
 * Type-safe wrapper for a generic resource pool
 */
export class GenericObjectPool {
  /**
   * @param {T[]} resources - Initial resources in the pool
   */
  constructor(resources) {
    this.pool = new NativePool(resources)
  }

  /**
   * Acquire a resource from the pool synchronously
   * Throws error if no resources available
   * @returns {T} A resource from the pool
   */
  acquire() {
    return this.pool.acquire()
  }

  /**
   * Acquire a resource from the pool asynchronously with retry
   * @param {number} [timeoutMs] - Optional timeout in milliseconds. If provided, will throw after timeout.
   * @returns {Promise<T>} Promise that resolves with a resource when one becomes available
   */
  async acquireAsync(timeoutMs) {
    return this.pool.acquireAsync(timeoutMs)
  }

  /**
   * Release a resource back to the pool
   * @param {T} resource - The resource to release
   * @returns {void}
   */
  release(resource) {
    this.pool.release(resource)
  }

  /**
   * Add a new resource to the pool
   * @param {T} resource - The resource to add
   * @returns {void}
   */
  add(resource) {
    this.pool.add(resource)
  }

  /**
   * Remove one available resource from the pool
   * @returns {boolean} true if a resource was removed, false if all are currently in use
   */
  removeOne() {
    return this.pool.removeOne()
  }

  /**
   * Get the number of available resources in the pool
   * @returns {number} Number of available resources
   */
  availableCount() {
    return this.pool.availableCount()
  }

  /**
   * Use a resource from the pool with automatic release
   * @template R
   * @param {(resource: T) => Promise<R>} fn - Function to execute with the resource
   * @returns {Promise<R>} Result of the function
   */
  async use(fn) {
    const resource = await this.acquireAsync()
    try {
      return await fn(resource)
    } finally {
      this.release(resource)
    }
  }

  /**
   * Get the number of available resources
   * @returns {number}
   */
  get available() {
    return this.pool.availableCount()
  }

  /**
   * Get the total number of resources managed by the pool
   * @returns {number}
   */
  get size() {
    return this.pool.size()
  }

  /**
   * Get the number of pending acquire requests
   * @returns {number}
   */
  get pendingCount() {
    return this.pool.pendingCount()
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
   * @returns {void}
   */
  destroy() {
    this.pool.destroy()
  }
}
