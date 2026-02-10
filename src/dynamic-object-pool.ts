import { BasePool } from './internal/base-pool';
import type { IObjectPool, PoolConfig, PoolMetrics } from './internal/interfaces';
import { SLOT_SYMBOL } from './internal/interfaces';

export class DynamicObjectPool<T extends object> implements IObjectPool<T> {
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

  // Dynamic State
  private pendingCreates = 0;
  private destroyedIndices: number[] = [];
  private lastActivity = 0;
  private opCount = 0;
  private isDestroyed = false;
  private scaleDownTimer: NodeJS.Timeout | null = null;

  constructor(basePool: BasePool, resources: (T | null)[], config: PoolConfig<T>, destroyedIndices: number[]) {
    this.pool = basePool;
    this.resources = resources;
    this.min = config.min;
    this.max = config.max;
    this.factory = config.resourceFactory;
    this.destroyer = config.resourceDestroyer;
    this.validator = config.validateResource;
    this.idleTimeout = config.idleTimeoutMs || 30000;
    this.scaleInterval = config.scaleDownIntervalMs || 10000;
    this.defaultTimeout = config.acquireTimeoutMs || 0;
    this.destroyedIndices = destroyedIndices;
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

    // 1. Try Fast Path
    let idx = this.pool.acquire();

    // 2. Scale Up
    if (idx === -1 && this.canScaleUp()) {
      this.triggerScaleUp().catch(console.error);
    }

    // 3. Wait
    if (idx === -1) {
      idx = await this.pool.acquireAsync(timeout);
    }

    if ((++this.opCount & 0xff) === 0) this.lastActivity = Date.now();

    const res = this.resources[idx]!;

    // 4. Validate
    if (this.validator) {
      let isValid = false;
      try {
        isValid = await this.validator(res);
      } catch (e) {
        isValid = false;
      }

      if (!isValid) {
        await this.destroyResourceInSlot(idx);
        return this.acquireAsync(timeout);
      }
    }

    return res;
  }

  public release(resource: T) {
    // @ts-ignore
    const idx = resource[SLOT_SYMBOL] as number;
    if ((++this.opCount & 0xff) === 0) this.lastActivity = Date.now();
    this.pool.release(idx);
  }

  public async use<R>(fn: (resource: T) => Promise<R>, timeoutMs?: number): Promise<R> {
    const resource = await this.acquireAsync(timeoutMs);
    try {
      return await fn(resource);
    } finally {
      this.release(resource);
    }
  }

  private canScaleUp(): boolean {
    return this.destroyedIndices.length > 0 && this.pendingCreates < this.destroyedIndices.length;
  }

  private async triggerScaleUp() {
    this.pendingCreates++;
    const slotIdx = this.destroyedIndices.pop();
    if (slotIdx === undefined) {
      this.pendingCreates--;
      return;
    }

    try {
      const res = await this.factory();
      // @ts-ignore
      res[SLOT_SYMBOL] = slotIdx;
      this.resources[slotIdx] = res;
      this.pool.release(slotIdx);
    } catch (error) {
      this.destroyedIndices.push(slotIdx);
      console.error('Scale up failed', error);
    } finally {
      this.pendingCreates--;
    }
  }

  private startScaleDownMonitor() {
    const run = () => {
      if (this.isDestroyed) return;
      this.scaleDownTimer = setTimeout(() => {
        this.checkScaleDown();
        run();
      }, this.scaleInterval);
      if (this.scaleDownTimer.unref) this.scaleDownTimer.unref();
    };
    run();
  }

  private checkScaleDown() {
    if (this.isDestroyed) return;
    const now = Date.now();
    if (now - this.lastActivity < this.idleTimeout) return;

    const activeCount = this.max - this.destroyedIndices.length;
    if (activeCount <= this.min) return;

    // Try to grab a resource to kill it
    const idx = this.pool.acquire();
    if (idx !== -1) {
      this.destroyResourceInSlot(idx).catch(console.error);
    }
  }

  private async destroyResourceInSlot(idx: number) {
    const res = this.resources[idx];
    if (res) {
      this.resources[idx] = null;
      // @ts-ignore
      delete res[SLOT_SYMBOL];
      if (this.destroyer)
        try {
          await this.destroyer(res);
        } catch (e) {}
    }
    this.destroyedIndices.push(idx);
  }

  public async destroy() {
    this.isDestroyed = true;
    if (this.scaleDownTimer) clearTimeout(this.scaleDownTimer);
    this.pool.destroy();
    await Promise.all(this.resources.map((r) => (r && this.destroyer ? this.destroyer(r) : Promise.resolve())));
    this.resources = [];
  }

  public getMetrics(): PoolMetrics {
    const available = this.pool.availableCount();
    const active = this.max - this.destroyedIndices.length;
    return {
      size: active,
      available,
      busy: active - available,
      capacity: this.max,
      pendingCreates: this.pendingCreates,
    };
  }
}
