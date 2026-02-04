const nativeModule = require('./index.js')

const NativePool = nativeModule.GenericObjectPool

/** @typedef {import('./index.wrapper.d.ts').GenericObjectPool} GenericObjectPoolType */
/** @typedef {import('./index.wrapper.d.ts').PoolGuard} PoolGuardType */

/**
 * @template T
 * @extends {GenericObjectPoolType<T>}
 * @inheritdoc
 */
class GenericObjectPool {
  /**
   * @param {T[]} resources
   */
  constructor(resources) {
    // 1. Store resources in a JS Array (Fast access)
    this.resources = [...resources]

    // 2. Map Resource -> Index for O(1) release
    this.resourceToIdx = new Map()
    this.resources.forEach((r, i) => this.resourceToIdx.set(r, i))

    // 3. Initialize Rust pool with just the COUNT
    this.pool = new NativePool(resources.length)
  }

  acquire() {
    // Rust gives us the integer (Index)
    const idx = this.pool.acquire()
    // JS gives us the object (Array Lookup)
    return this.resources[idx]
  }

  async acquireAsync(timeoutMs) {
    const idx = await this.pool.acquireAsync(timeoutMs)
    return this.resources[idx]
  }

  release(resource) {
    // O(1) Lookup
    const idx = this.resourceToIdx.get(resource)

    if (idx === undefined) {
      throw new Error('Resource not belonging to pool')
    }

    this.pool.release(idx)
  }

  add(resource) {
    const newIdx = this.resources.length
    this.resources.push(resource)
    this.resourceToIdx.set(resource, newIdx)
    this.pool.add(newIdx)
  }

  removeOne() {
    const idx = this.pool.removeOne()
    if (idx === null) return false

    // We mark the slot as empty or null, but we don't resize the array
    // to keep indices stable.
    // Ideally, for a dynamic pool, you'd want a free-list in JS,
    // but for this implementation, we just remove the mapping.
    const resource = this.resources[idx]
    this.resourceToIdx.delete(resource)
    this.resources[idx] = null
    return true
  }

  async use(fn, { optimistic = true, timeout } = {}) {
    let resource
    if (optimistic) {
      try {
        const idx = this.pool.acquire()
        resource = this.resources[idx]
      } catch {}
    }

    if (!resource) {
      const idx = await this.pool.acquireAsync(timeout)
      resource = this.resources[idx]
    }

    try {
      return await fn(resource)
    } finally {
      // Manual inline release for performance
      const idx = this.resourceToIdx.get(resource)
      if (idx !== undefined) {
        this.pool.release(idx)
      }
    }
  }

  availableCount() {
    return this.pool.availableCount()
  }
  get size() {
    return this.pool.size()
  }
  get pendingCount() {
    return this.pool.pendingCount()
  }
  get available() {
    return this.pool.availableCount()
  }
  get numUsed() {
    return this.pool.size() - this.pool.availableCount()
  }

  destroy() {
    // Destroy Rust pool (closes semaphore)
    this.pool.destroy()
    // Clear JS references
    this.resources = []
    this.resourceToIdx.clear()
  }
}

module.exports = { GenericObjectPool }
