import { BasePool } from './internal/base-pool';
import { StaticObjectPool } from './static-object-pool';
import { DynamicObjectPool } from './dynamic-object-pool';
import { SLOT_SYMBOL } from './internal/interfaces';
import type { IObjectPool, PoolConfig } from './internal/interfaces';
export type { IObjectPool, PoolConfig, PoolMetrics } from './internal/interfaces';

export async function createPool<T extends object>(config: PoolConfig<T>): Promise<IObjectPool<T>> {
  if (config.max < config.min) throw new Error('Max must be >= Min');

  const basePool = new BasePool(config.max);
  const resources = new Array<T | null>(config.max).fill(null);
  const destroyedIndices: number[] = [];

  // Pre-fill Logic
  // For Static pools (min === max), we fill everything.
  // For Dynamic pools, we fill 'min', and the rest are marked as destroyed/available.
  const initialCount = config.min;

  // Parallel creation of initial resources
  const promises: Promise<void>[] = [];

  for (let i = 0; i < config.max; i++) {
    if (i < initialCount) {
      // Active slot
      promises.push(
        (async () => {
          try {
            const res = await config.resourceFactory();
            // @ts-ignore
            res[SLOT_SYMBOL] = i;
            resources[i] = res;
            basePool.release(i);
          } catch (e) {
            console.error('Failed to create initial resource', e);
            // If static, this is fatal? Or we leave it empty?
            // We'll mark it as destroyed so dynamic pool can retry.
            // Static pool will just have an empty slot until manual intervention or it throws on access.
            destroyedIndices.push(i);
          }
        })(),
      );
    } else {
      // Reserve slot for dynamic scaling
      destroyedIndices.push(i);
    }
  }

  await Promise.all(promises);

  // Factory Logic
  if (config.min === config.max) {
    if (destroyedIndices.length > 0) {
      console.warn(`Static Pool created with ${destroyedIndices.length} failed initial resources.`);
    }
    return new StaticObjectPool(basePool, resources, config);
  } else {
    return new DynamicObjectPool(basePool, resources, config, destroyedIndices);
  }
}
