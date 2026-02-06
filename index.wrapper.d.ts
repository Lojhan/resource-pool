/**
 * Configuration for dynamic pool sizing
 */
export interface DynamicSizingConfig<T> {
  /** Minimum pool size */
  min: number
  /** Maximum pool size */
  max: number
  /** Initial pool size (defaults to min) */
  initial?: number
  /** Function to create new resources */
  resourceFactory: () => T | Promise<T>
  /** Optional function to validate resources (return true if valid) */
  validateResource?: (resource: T) => boolean | Promise<boolean>
  /** Optional function to cleanup/destroy resources */
  resourceDestroyer?: (resource: T) => void | Promise<void>
  /** Number of pending requests before scaling up (default: 5) */
  scaleUpThreshold?: number
  /** Number of resources to add when scaling up (default: 1) */
  scaleUpIncrement?: number
  /** Time in ms before idle resources can be removed (default: 30000) */
  idleTimeoutMs?: number
  /** Interval in ms to check for idle resources (default: 10000) */
  scaleDownCheckIntervalMs?: number
  /** Whether to validate resources on acquire (default: false) */
  validateOnAcquire?: boolean
  /** Number of retries when creating resources fails (default: 3) */
  createRetries?: number
}

/**
 * Pool metrics for monitoring
 */
export interface PoolMetrics {
  /** Current total size of the pool */
  currentSize: number
  /** Minimum size (for dynamic pools) */
  minSize: number
  /** Maximum size (for dynamic pools) */
  maxSize: number
  /** Number of available resources */
  available: number
  /** Number of resources currently in use */
  inUse: number
  /** Number of pending acquisition requests */
  pending: number
  /** Number of scale-up events */
  scaleUpEvents: number
  /** Number of scale-down events */
  scaleDownEvents: number
  /** Total resources created */
  resourcesCreated: number
  /** Total resources destroyed */
  resourcesDestroyed: number
}

/**
 * Type-safe wrapper for a generic resource pool
 */
export declare class GenericObjectPool<T> extends StaticObjectPool<T> {
  /**
   * Create a pool with dynamic sizing capabilities
   */
  static withDynamicSizing<T>(config: DynamicSizingConfig<T>): DynamicObjectPool<T>

  /**
   * Create a pool with dynamic sizing capabilities
   */
  static dynamic<T>(config: DynamicSizingConfig<T>): DynamicObjectPool<T>

  /**
   * Create a pool using the static implementation
   */
  static static<T>(resources: T[]): StaticObjectPool<T>

  /**
   * Create an index-only pool implementation
   */
  static engine(size: number): EnginePool

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

  /**
   * Use a resource from the pool with automatic release
   * @param fn - Function to execute with the resource
   * @param options - Configuration options for acquisition
   */
  use<R>(
    fn: (resource: T) => Promise<R>,
    options?: {
      /** Try to acquire synchronously first. Defaults to true. */
      optimistic?: boolean
      /** Timeout in milliseconds for async acquisition */
      timeout?: number
    },
  ): Promise<R>

  /**
   * Get pool metrics (for dynamic pools)
   */
  getMetrics(): PoolMetrics
}

export declare class StaticObjectPool<T = any> {
  constructor(resources: T[])
  acquire(): T
  acquireAsync(timeoutMs?: number): Promise<T>
  release(resource: T): void
  add(resource: T): void
  removeOne(): boolean
  availableCount(): number
  getMetrics(): PoolMetrics
  use<R>(fn: (resource: T) => Promise<R>, options?: { optimistic?: boolean; timeout?: number }): Promise<R>
  get size(): number
  get pendingCount(): number
  get available(): number
  get numUsed(): number
  destroy(): void
}

export declare class DynamicObjectPool<T = any> extends StaticObjectPool<T> {
  static withDynamicSizing<T>(config: DynamicSizingConfig<T>): DynamicObjectPool<T>
  acquireAsync(timeoutMs?: number): Promise<T>
  release(resource: T): void
  add(resource: T): void
  removeOne(): boolean
  destroy(): void
  getMetrics(): PoolMetrics
  get minSize(): number
  get maxSize(): number
}

export declare class EnginePool {
  constructor(size: number)
  acquire(): number
  acquireAsync(timeoutMs?: number): Promise<number>
  release(idx: number): void
  add(idx: number): void
  removeOne(): number | null
  use<R>(fn: (idx: number) => Promise<R>, options?: { optimistic?: boolean; timeout?: number }): Promise<R>
  availableCount(): number
  getMetrics(): PoolMetrics
  get size(): number
  get pendingCount(): number
  get available(): number
  get numUsed(): number
  destroy(): void
}
