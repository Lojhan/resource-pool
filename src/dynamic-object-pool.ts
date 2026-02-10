import { BasePool } from './internal/base-pool';
import type { IObjectPool, PoolConfig, PoolMetrics } from './internal/interfaces';
import { SLOT_SYMBOL } from './internal/interfaces';

const DEFAULT_FACTORY_TIMEOUT_MS = 5000;
const DEFAULT_DESTROYER_TIMEOUT_MS = 5000;
const DEFAULT_VALIDATOR_TIMEOUT_MS = 3000;

const DEFAULT_SCALE_DOWN_INTERVAL_MS = 10000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;

export class ObjectPool<T extends object> implements IObjectPool<T> {
  private pool: BasePool;
  private resources: (T | null)[];
  private factory: () => T | Promise<T>;
  private destroyer?: (resource: T) => void | Promise<void>;
  private validator?: (resource: T) => boolean | Promise<boolean>;

  private min: number;
  private max: number;
  private idleTimeout: number;
  private scaleInterval: number;
  private defaultTimeout: number;

  private factoryTimeoutMs: number;
  private destroyerTimeoutMs: number;
  private validatorTimeoutMs: number;

  private bubbleFactoryErrors: boolean;
  private bubbleDestroyerErrors: boolean;
  private bubbleValidationErrors: boolean;

  // Dynamic State
  private pendingCreates = 0;
  private availableIndexes: number[] = [];
  private lastActivity = 0;
  private opCount = 0;
  private isDestroyed = false;
  private scaleDownTimer: NodeJS.Timeout | null = null;

  constructor(basePool: BasePool, resources: (T | null)[], config: PoolConfig<T>, availableIndexes: number[]) {
    this.pool = basePool;
    this.resources = resources;
    this.min = config.min;
    this.max = config.max;

    this.factory = config.resourceFactory;
    this.destroyer = config.resourceDestroyer;
    this.validator = config.validateResource;

    this.bubbleFactoryErrors = config.bubbleFactoryErrors || false;
    this.bubbleDestroyerErrors = config.bubbleDestroyerErrors || false;
    this.bubbleValidationErrors = config.bubbleValidationErrors || false;

    this.factoryTimeoutMs = config.factoryTimeoutMs || DEFAULT_FACTORY_TIMEOUT_MS;
    this.destroyerTimeoutMs = config.destroyerTimeoutMs || DEFAULT_DESTROYER_TIMEOUT_MS;
    this.validatorTimeoutMs = config.validatorTimeoutMs || DEFAULT_VALIDATOR_TIMEOUT_MS;

    this.idleTimeout = config.idleTimeoutMs || DEFAULT_IDLE_TIMEOUT_MS;
    this.scaleInterval = config.scaleDownIntervalMs || DEFAULT_SCALE_DOWN_INTERVAL_MS;
    this.defaultTimeout = config.acquireTimeoutMs || 0;
    this.availableIndexes = availableIndexes;
    this.lastActivity = Date.now();

    if (this.max > this.min && this.idleTimeout > 0) {
      this.startScaleDownMonitor();
    }
  }

  public acquire(): T | null {
    if ((++this.opCount & 0xff) === 0) this.lastActivity = Date.now();
    const idx = this.pool.acquire();
    if (idx === -1) return null;
    return this.resources[idx]!;
  }

  public async acquireAsync(timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs ?? this.defaultTimeout;
    const deadline = timeout > 0 ? Date.now() + timeout : Infinity;

    while (true) {
      // Check timeout
      if (timeout > 0 && Date.now() >= deadline) {
        throw new Error(`Timeout acquiring resource (${timeout}ms)`);
      }

      // Try to acquire or trigger scale up
      let idx = this.pool.acquire();
      if (idx === -1 && this.canScaleUp()) {
        this.triggerScaleUp().catch(console.error);
      }

      // Wait for resource (BasePool has fast path internally)
      if (idx === -1) {
        const remainingTime = timeout > 0 ? deadline - Date.now() : timeout;
        idx = await this.pool.acquireAsync(remainingTime > 0 ? remainingTime : timeout);
      }

      if ((++this.opCount & 0xff) === 0) this.lastActivity = Date.now();

      const res = this.resources[idx]!;

      // Validate with timeout
      if (this.validator) {
        const isValid = await this.validateWithTimeout(res, this.validatorTimeoutMs);

        if (!isValid) {
          // Replace invalid resource in the same slot (keeps slot acquired)
          await this.replaceResourceInSlot(idx);
          return this.resources[idx]!;
        }
      }

      return res;
    }
  }

  public release(resource: T) {
    // @ts-ignore
    const idx = resource[SLOT_SYMBOL] as number;
    if ((++this.opCount & 0xff) === 0) this.lastActivity = Date.now();
    this.pool.release(idx);
  }

  public async use<R>(fn: (resource: T) => R | Promise<R>, timeoutMs?: number): Promise<R> {
    const resource = await this.acquireAsync(timeoutMs);
    try {
      return await fn(resource);
    } finally {
      this.release(resource);
    }
  }

  private canScaleUp(): boolean {
    return this.availableIndexes.length > 0 && this.pendingCreates < this.availableIndexes.length;
  }

  private async triggerScaleUp() {
    this.pendingCreates++;
    const slotIdx = this.availableIndexes.pop();
    if (slotIdx === undefined) {
      this.pendingCreates--;
      return;
    }

    try {
      const res = await this.factoryWithTimeout(this.factoryTimeoutMs);
      // @ts-ignore
      res[SLOT_SYMBOL] = slotIdx;
      this.resources[slotIdx] = res;
      this.pool.release(slotIdx);
    } catch (error) {
      this.availableIndexes.push(slotIdx);
      if (this.bubbleFactoryErrors) {
        throw error;
      }
      console.error('Scale up failed', error);
    } finally {
      this.pendingCreates--;
    }
  }

  private startScaleDownMonitor() {
    const run = () => {
      if (this.isDestroyed) return;
      this.scaleDownTimer = setTimeout(() => {
        if (this.isDestroyed) return;
        this.checkScaleDown();
        run();
      }, this.scaleInterval);
    };
    run();
  }

  private checkScaleDown() {
    if (this.isDestroyed) return;
    const now = Date.now();
    if (now - this.lastActivity < this.idleTimeout) return;

    const activeCount = this.max - this.availableIndexes.length;
    if (activeCount <= this.min) return;

    // Try to grab a resource to kill it
    const idx = this.pool.acquire();
    if (idx !== -1) {
      this.destroyResourceInSlot(idx);
    }
  }

  private async destroyResourceInSlot(idx: number) {
    const res = this.resources[idx];
    if (res && this.destroyer) {
      await this.destroyerWithTimeout(res, this.destroyerTimeoutMs);
    }

    this.resources[idx] = null;
    this.availableIndexes.push(idx);
  }

  private async replaceResourceInSlot(idx: number) {
    const res = this.resources[idx];
    if (res && this.destroyer) {
      await this.destroyerWithTimeout(res, this.destroyerTimeoutMs);
    }

    // Create new resource in the same slot
    try {
      const newRes = await this.factoryWithTimeout(this.factoryTimeoutMs);
      Object.defineProperty(newRes, SLOT_SYMBOL, {
        value: idx,
        writable: false,
        enumerable: false,
      });
      this.resources[idx] = newRes;
    } catch (error) {
      // If factory fails during replacement, re-throw as this is critical
      // The slot will remain acquired but empty, caller must handle
      throw error;
    }
  }

  private async destroyerWithTimeout(resource: T, timeoutMs: number): Promise<void> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      await Promise.race([
        this.destroyer!(resource),
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (this.bubbleDestroyerErrors) {
        throw error;
      }
      // Silently ignore destroyer errors when not bubbling
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private async factoryWithTimeout(timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const result = await Promise.race([
        this.factory(),
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Factory timeout')), timeoutMs);
        }),
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      // Factory errors always bubble - caller must handle
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private async validateWithTimeout(resource: T, timeoutMs: number): Promise<boolean> {
    if (!this.validator) return true;

    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      const result = await Promise.race([
        this.validator(resource),
        new Promise<boolean>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      if (this.bubbleValidationErrors) {
        throw error;
      }
      // Treat validation errors as invalid when not bubbling
      return false;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  public async destroy() {
    this.isDestroyed = true;
    if (this.scaleDownTimer) clearTimeout(this.scaleDownTimer);
    this.pool.destroy();

    if (this.destroyer) {
      await Promise.all(
        this.resources
          .filter((r): r is T => r !== null)
          .map((r) => this.destroyerWithTimeout(r, this.destroyerTimeoutMs)),
      );
    }

    this.resources = [];
  }

  public getMetrics(): PoolMetrics {
    const available = this.pool.availableCount();
    const active = this.max - this.availableIndexes.length;
    return {
      size: active,
      available,
      busy: active - available,
      capacity: this.max,
      pendingCreates: this.pendingCreates,
    };
  }
}
