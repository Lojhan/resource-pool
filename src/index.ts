import { BasePool } from './internal/base-pool';
import { ObjectPool } from './dynamic-object-pool';
import { EnginePool } from './engine-object-pool';
import { SLOT_SYMBOL } from './internal/interfaces';
import type { IObjectPool, PoolConfig } from './internal/interfaces';
export type { IObjectPool, PoolConfig, PoolMetrics } from './internal/interfaces';
export { EnginePool };

/**
 * Create an object pool with an async resource factory.
 *
 * @template T - The type of resources managed by the pool
 * @param config - Pool configuration with async resourceFactory
 * @param initialResources - Optional pre-created resources to populate the pool
 * @returns A fully initialized object pool
 */
export function createPool<T extends object>(
  config: {
    min?: number;
    max?: number;
    resourceFactory: () => Promise<T>;
    resourceDestroyer?: (resource: T) => void | Promise<void>;
    validateResource?: (resource: T) => boolean | Promise<boolean>;
    idleTimeoutMs?: number;
    scaleDownIntervalMs?: number;
    acquireTimeoutMs?: number;
  },
  initialResources?: T[],
): IObjectPool<T>;

/**
 * Create an object pool with a sync resource factory.
 * Resources are created immediately and the pool is ready to use right away.
 *
 * @template T - The type of resources managed by the pool
 * @param config - Pool configuration with synchronous resourceFactory
 * @param initialResources - Optional pre-created resources to populate the pool
 * @returns A fully initialized object pool ready for immediate use
 *
 * @example
 * ```ts
 * const pool = createPool({
 *   min: 2,
 *   max: 10,
 *   resourceFactory: () => ({ connection: new Connection() })
 * });
 *
 * const resource = pool.acquire();
 * ```
 */
export function createPool<T extends object>(
  config: {
    min?: number;
    max?: number;
    resourceFactory: () => T;
    resourceDestroyer?: (resource: T) => void | Promise<void>;
    validateResource?: (resource: T) => boolean | Promise<boolean>;
    idleTimeoutMs?: number;
    scaleDownIntervalMs?: number;
    acquireTimeoutMs?: number;
  },
  initialResources?: T[],
): IObjectPool<T>;

// Implementation
export function createPool<T extends object>(
  config: {
    min?: number;
    max?: number;
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
  },
  initialResources?: T[],
): IObjectPool<T> {
  if (!config) {
    throw new Error('Pool configuration is required');
  }

  if (!config.resourceFactory) {
    throw new Error('resourceFactory is required');
  }

  const INT32_MAX = 2147483647;
  let min = config.min;
  let max = config.max;

  // Rule: If neither min nor max is provided, it's a static pool
  if (min === undefined && max === undefined) {
    if (!initialResources || initialResources.length === 0) {
      throw new Error('Static pool (no min/max) requires initialResources');
    }
    min = max = initialResources.length;
  }

  // Rule: If only one is provided, validate and set defaults
  if (min === undefined && max !== undefined) {
    throw new Error('min is required when max is specified');
  }

  if (max === undefined && min !== undefined) {
    throw new Error('max is required when min is specified');
  }

  // At this point both min and max are defined
  min = min!;
  max = max!;

  // Rule: min must be non-negative
  if (min < 0) {
    throw new Error('min cannot be negative');
  }

  // Rule: max must be at least 1
  if (max < 1) {
    throw new Error('max must be at least 1');
  }

  // Rule: max cannot exceed INT32_MAX
  if (max > INT32_MAX) {
    throw new Error(`max cannot exceed ${INT32_MAX}`);
  }

  // Rule: max must be >= min
  if (max < min) {
    throw new Error('max must be >= min');
  }

  // Rule: For static pools (min === max), initialResources must match exactly if provided
  if (min === max && initialResources && initialResources.length > 0) {
    if (initialResources.length !== min) {
      throw new Error(
        `Static pool (min === max === ${min}) requires exactly ${min} initialResources, got ${initialResources.length}`,
      );
    }
  }

  // Rule: initialResources cannot exceed max
  if (initialResources && initialResources.length > max) {
    throw new Error(`initialResources length (${initialResources.length}) cannot exceed max (${max})`);
  }

  return createPoolInternal({ ...config, min, max } as PoolConfig<T>, initialResources || []);
}

function createPoolInternal<T extends object>(config: PoolConfig<T>, initialResources: T[]) {
  const basePool = new BasePool(config.max);
  const resources = new Array<T | null>(config.max).fill(null);
  const destroyedIndices: number[] = [];

  // Place provided resources
  let nextSlot = 0;
  for (let i = 0; i < Math.min(initialResources.length, config.max); i++) {
    Object.defineProperty(initialResources[i], SLOT_SYMBOL, {
      value: i,
      writable: false,
      enumerable: false,
    });
    resources[i] = initialResources[i];
    basePool.release(i);
    nextSlot = i + 1;
  }

  // Create min resources for sync factories
  const factory = config.resourceFactory;
  const isAsync = factory.constructor.name === 'AsyncFunction';

  if (!isAsync && nextSlot < config.min) {
    const syncFactory = factory as () => T;
    for (let i = nextSlot; i < config.min; i++) {
      const resource = syncFactory();
      Object.defineProperty(resource, SLOT_SYMBOL, {
        value: i,
        writable: false,
        enumerable: false,
      });
      resources[i] = resource;
      basePool.release(i);
      nextSlot = i + 1;
    }
  }

  // Mark remaining slots as available for on-demand creation
  for (let i = nextSlot; i < config.max; i++) {
    destroyedIndices.push(i);
  }

  return new ObjectPool<T>(basePool, resources, config, destroyedIndices);
}

/**
 * Create an EnginePool for index-based resource management
 * @param size - The number of slots in the pool
 * @returns A new EnginePool instance
 */
export function createEnginePool(size: number): EnginePool {
  return new EnginePool(size);
}
