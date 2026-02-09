import { BasePool } from './internal/base-pool'
import type { IObjectPool, PoolConfig, PoolMetrics } from './internal/interfaces'
import { SLOT_SYMBOL } from './internal/interfaces'

export class StaticObjectPool<T extends object> implements IObjectPool<T> {
  private pool: BasePool
  private resources: (T | null)[]
  private factory: () => T | Promise<T>
  private destroyer?: (resource: T) => void | Promise<void>
  private validator?: (resource: T) => boolean | Promise<boolean>
  private defaultTimeout: number
  private capacity: number

  constructor(basePool: BasePool, resources: (T | null)[], config: PoolConfig<T>) {
    this.pool = basePool
    this.resources = resources
    this.capacity = config.max
    this.factory = config.resourceFactory
    this.destroyer = config.resourceDestroyer
    this.validator = config.validateResource
    this.defaultTimeout = config.acquireTimeoutMs || 0
  }

  public acquire(): T | null {
    const idx = this.pool.acquire()
    if (idx === -1) return null
    // Fast path: Direct array access
    return this.resources[idx]!
  }

  public async acquireAsync(timeoutMs?: number): Promise<T> {
    const idx = await this.pool.acquireAsync(timeoutMs ?? this.defaultTimeout)
    const resource = this.resources[idx]!

    // Validation is optional. If not present, this path is extremely fast.
    if (this.validator) {
      try {
        if (await this.validator(resource)) {
          return resource
        }
      } catch (e) {
        /* ignore validation error */
      }

      // Validation failed. Recreate resource in this slot.
      // We do not release the slot; we own it. We just swap the object.
      try {
        if (this.destroyer) await this.destroyer(resource)
        const newRes = await this.factory()
        // @ts-ignore
        newRes[SLOT_SYMBOL] = idx
        this.resources[idx] = newRes
        return newRes
      } catch (e) {
        // Critical failure: we own a slot but can't fill it.
        // Release slot so others can try (or fail), then throw.
        this.pool.release(idx)
        throw e
      }
    }

    return resource
  }

  public release(resource: T) {
    // @ts-ignore
    const idx = resource[SLOT_SYMBOL] as number
    // Optimization: In static pool, we assume caller is correct to avoid checks
    this.pool.release(idx)
  }

  public async use<R>(fn: (resource: T) => Promise<R>, timeoutMs?: number): Promise<R> {
    const resource = await this.acquireAsync(timeoutMs)
    try {
      return await fn(resource)
    } finally {
      this.release(resource)
    }
  }

  public async destroy() {
    this.pool.destroy()
    if (this.destroyer) {
      await Promise.all(this.resources.map((r) => (r ? this.destroyer!(r) : Promise.resolve())))
    }
    this.resources = []
  }

  public getMetrics(): PoolMetrics {
    const available = this.pool.availableCount()
    return {
      size: this.capacity,
      available,
      busy: this.capacity - available,
      capacity: this.capacity,
    }
  }
}
