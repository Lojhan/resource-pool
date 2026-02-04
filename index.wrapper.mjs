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
}
