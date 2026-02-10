import { BasePool } from './internal/base-pool';
import type { PoolMetrics } from './internal/interfaces';

/**
 * EnginePool - An index-only pool for advanced use cases
 *
 * EnginePool is a low-level pool that returns integers (indices) instead of resources.
 * This enables developers to implement custom resource management strategies,
 * such as bucket algorithms, custom caching, or resource-specific logic.
 *
 * Example use case:
 * ```typescript
 * const pool = new EnginePool(10); // Pool of 10 slots
 * const idx = await pool.acquireAsync();
 * // Use idx to access your custom resource management
 * myResourceManager.use(idx, fn);
 * pool.release(idx);
 * ```
 */
export class EnginePool {
  private pool: BasePool;
  private defaultTimeout: number;

  constructor(size: number) {
    this.pool = new BasePool(size);
    this.defaultTimeout = 0;

    // Initialize all slots as available
    for (let i = 0; i < size; i++) {
      this.pool.release(i);
    }
  }

  /**
   * Synchronously acquire an available slot
   * @returns The slot index, or -1 if no slots are available
   */
  public acquire(): number {
    return this.pool.acquire();
  }

  /**
   * Asynchronously acquire a slot with optional timeout
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @returns The slot index
   * @throws If timeout is exceeded
   */
  public async acquireAsync(timeoutMs?: number): Promise<number> {
    return this.pool.acquireAsync(timeoutMs ?? this.defaultTimeout);
  }

  /**
   * Release a previously acquired slot back to the pool
   * @param idx - The slot index to release
   */
  public release(idx: number): void {
    this.pool.release(idx);
  }

  /**
   * Use a slot with automatic release via a callback
   * Optionally acquires optimistically (fast path)
   * @param fn - Function that receives the slot index
   * @param timeoutMs - Optional timeout for async acquisition
   * @returns The result of the function
   */
  public async use<R>(
    fn: (idx: number) => Promise<R>,
    { optimistic = true, timeout }: { optimistic?: boolean; timeout?: number } = {},
  ): Promise<R> {
    let idx: number | undefined;

    // Try optimistic acquire (fast path)
    if (optimistic) {
      idx = this.acquire();
      if (idx === -1) {
        idx = undefined;
      }
    }

    // Fall back to async acquire if optimistic failed
    if (idx === undefined) {
      idx = await this.acquireAsync(timeout);
    }

    try {
      return await fn(idx);
    } finally {
      this.release(idx);
    }
  }

  /**
   * Get current pool metrics
   */
  public getMetrics(): PoolMetrics {
    const size = this.pool.getCapacity();
    const available = this.pool.availableCount();
    return {
      size,
      available,
      busy: size - available,
      capacity: size,
    };
  }

  /**
   * Get the total number of available slots
   */
  public availableCount(): number {
    return this.pool.availableCount();
  }

  /**
   * Get the total size of the pool
   */
  public get size(): number {
    return this.pool.getCapacity();
  }

  /**
   * Get the number of pending requests
   * (EnginePool doesn't track pending requests, returns 0)
   */
  public get pendingCount(): number {
    return 0;
  }

  /**
   * Get the number of available slots (alias for availableCount)
   */
  public get available(): number {
    return this.availableCount();
  }

  /**
   * Get the number of busy slots
   */
  public get numUsed(): number {
    return this.size - this.available;
  }

  /**
   * Destroy the pool and clean up resources
   */
  public destroy(): void {
    // BasePool doesn't have explicit cleanup needed,
    // but we keep this for API consistency
  }
}
