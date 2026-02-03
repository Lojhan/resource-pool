/**
 * Type-safe wrapper for a generic resource pool
 */
export class GenericObjectPool<T> {
  /**
   * Create a new resource pool
   * @param resources - Initial resources in the pool
   */
  constructor(resources: T[])

  /**
   * Acquire a resource from the pool synchronously
   * Throws error if no resources available
   * @returns A resource from the pool
   * @throws Error if no resources are available
   */
  acquire(): T

  /**
   * Acquire a resource from the pool asynchronously with retry
   * @param timeoutMs - Optional timeout in milliseconds. If provided, will throw after timeout.
   * @returns Promise that resolves with a resource when one becomes available
   * @throws Error if timeout is exceeded before acquiring a resource
   */
  acquireAsync(timeoutMs?: number): Promise<T>

  /**
   * Release a resource back to the pool
   * @param resource - The resource to release
   */
  release(resource: T): void

  /**
   * Add a new resource to the pool
   * @param resource - The resource to add
   */
  add(resource: T): void

  /**
   * Remove one available resource from the pool
   * @returns true if a resource was removed, false if all are currently in use
   */
  removeOne(): boolean

  /**
   * Get the number of available resources in the pool
   * @returns Number of available resources
   */
  availableCount(): number
}
