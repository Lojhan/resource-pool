export const SLOT_SYMBOL = Symbol('poolSlotIndex');

export type PoolConfig<T> = {
  min: number;
  max: number;

  resourceFactory: (() => T) | (() => Promise<T>);
  resourceDestroyer?: (resource: T) => void | Promise<void>;
  validateResource?: (resource: T) => boolean | Promise<boolean>;

  factoryTimeoutMs?: number;
  destroyerTimeoutMs?: number;
  validatorTimeoutMs?: number;

  bubbleFactoryErrors?: boolean;
  bubbleDestroyerErrors?: boolean;
  bubbleValidationErrors?: boolean;

  idleTimeoutMs?: number;
  scaleDownIntervalMs?: number;
  acquireTimeoutMs?: number;
};

export type PoolMetrics = {
  size: number;
  available: number;
  busy: number;
  capacity: number;
  pendingCreates?: number; // Dynamic only
};

export interface IObjectPool<T> {
  acquire(): T | null;
  acquireAsync(timeoutMs?: number): Promise<T>;
  release(resource: T): void;
  use<R>(fn: (resource: T) => R | Promise<R>, timeoutMs?: number): Promise<R>;
  destroy(): Promise<void>;
  getMetrics(): PoolMetrics;
}
