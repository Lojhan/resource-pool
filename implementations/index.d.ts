/**
 * Configuration for dynamic pool sizing
 */
export interface DynamicSizingConfig<T> {
  min: number
  max: number
  initial?: number
  resourceFactory: () => T | Promise<T>
  validateResource?: (resource: T) => boolean | Promise<boolean>
  resourceDestroyer?: (resource: T) => void | Promise<void>
  scaleUpThreshold?: number
  scaleUpIncrement?: number
  idleTimeoutMs?: number
  scaleDownCheckIntervalMs?: number
  validateOnAcquire?: boolean
  createRetries?: number
}

/**
 * Pool metrics for monitoring
 */
export interface PoolMetrics {
  currentSize: number
  minSize: number
  maxSize: number
  available: number
  inUse: number
  pending: number
  scaleUpEvents: number
  scaleDownEvents: number
  resourcesCreated: number
  resourcesDestroyed: number
}

export declare class StaticObjectPool<T> {
  constructor(resources: T[])
  acquire(): T
  acquireAsync(timeoutMs?: number): Promise<T>
  release(resource: T): void
  add(resource: T): void
  removeOne(): boolean
  use<R>(fn: (resource: T) => Promise<R>, options?: { optimistic?: boolean; timeout?: number }): Promise<R>
  availableCount(): number
  getMetrics(): PoolMetrics
  get size(): number
  get pendingCount(): number
  get available(): number
  get numUsed(): number
  destroy(): void
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

export declare class DynamicObjectPool<T> extends StaticObjectPool<T> {
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
