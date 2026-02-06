import nativeModule from '../index.js'

const NativePool = nativeModule.GenericObjectPool

/**
 * Static-size pool implementation
 * @template T
 */
export class StaticObjectPool {
  /**
   * Create a new resource pool
   * @param {T[]} resources - Initial resources in the pool
   */
  constructor(resources) {
    this.resources = [...resources]

    this.resourceToIdx = new Map()
    for (const [i, r] of this.resources.entries()) {
      this.resourceToIdx.set(r, i)
    }

    this.pool = new NativePool(resources.length)
  }

  acquire() {
    const idx = this.pool.acquire()
    return this.resources[idx]
  }

  async acquireAsync(timeoutMs) {
    const idx = await this.pool.acquireAsync(timeoutMs)
    return this.resources[idx]
  }

  release(resource) {
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

  getMetrics() {
    const size = this.pool.size()
    const available = this.pool.availableCount()
    return {
      currentSize: size,
      minSize: size,
      maxSize: size,
      available,
      inUse: size - available,
      pending: this.pool.pendingCount(),
      scaleUpEvents: 0,
      scaleDownEvents: 0,
      resourcesCreated: size,
      resourcesDestroyed: 0,
    }
  }

  destroy() {
    this.pool.destroy()
    this.resources = []
    this.resourceToIdx.clear()
  }
}

/**
 * Index-only pool implementation
 */
export class EnginePool {
  /**
   * Create a new pool with a fixed size
   * @param {number} size
   */
  constructor(size) {
    this.pool = new NativePool(size)
  }

  acquire() {
    return this.pool.acquire()
  }

  async acquireAsync(timeoutMs) {
    return this.pool.acquireAsync(timeoutMs)
  }

  release(idx) {
    this.pool.release(idx)
  }

  add(idx) {
    this.pool.add(idx)
  }

  removeOne() {
    return this.pool.removeOne()
  }

  async use(fn, { optimistic = true, timeout } = {}) {
    let idx
    if (optimistic) {
      try {
        idx = this.pool.acquire()
      } catch {}
    }

    if (idx === undefined) {
      idx = await this.pool.acquireAsync(timeout)
    }

    try {
      return await fn(idx)
    } finally {
      this.pool.release(idx)
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

  getMetrics() {
    const size = this.pool.size()
    const available = this.pool.availableCount()
    return {
      currentSize: size,
      minSize: size,
      maxSize: size,
      available,
      inUse: size - available,
      pending: this.pool.pendingCount(),
      scaleUpEvents: 0,
      scaleDownEvents: 0,
      resourcesCreated: size,
      resourcesDestroyed: 0,
    }
  }

  destroy() {
    this.pool.destroy()
  }
}

/**
 * Dynamic-size pool implementation
 * @template T
 */
export class DynamicObjectPool extends StaticObjectPool {
  #minSize = 0
  #maxSize = Infinity
  #resourceFactory = null
  #validateResource = null
  #resourceDestroyer = null

  #scaleUpThreshold = 5
  #scaleUpIncrement = 1
  #idleTimeoutMs = 30000
  #scaleDownCheckIntervalMs = 10000
  #validateOnAcquire = false
  #createRetries = 3

  #scaleDownTimer = null
  #scaleUpCheckTimer = null
  #lastActivityAt = 0
  #isScaling = false
  #pendingAsync = 0
  #scaleUpFailureCount = 0
  #scaleUpCooldownUntil = 0

  #metrics = {
    scaleUpEvents: 0,
    scaleDownEvents: 0,
    resourcesCreated: 0,
    resourcesDestroyed: 0,
  }

  static withDynamicSizing(config) {
    const {
      min,
      max,
      initial = min,
      resourceFactory,
      validateResource = null,
      resourceDestroyer = null,
      scaleUpThreshold = 5,
      scaleUpIncrement = 1,
      idleTimeoutMs = 30000,
      scaleDownCheckIntervalMs = 10000,
      validateOnAcquire = undefined,
      createRetries = 3,
    } = config

    if (!resourceFactory) {
      throw new Error('resourceFactory is required for dynamic sizing')
    }

    if (max < min) {
      throw new Error('max size must be greater than or equal to min size')
    }

    if (initial < min || initial > max) {
      throw new Error('initial size must be between min and max')
    }

    const resources = []
    const initialTarget = initial
    for (let i = 0; i < initial; i++) {
      try {
        const resource = resourceFactory()
        const isPromise = resource && typeof resource.then === 'function'
        if (isPromise) {
          continue
        }
        resources.push(resource)
      } catch (err) {
        console.error('Failed to create initial resource:', err)
      }
    }

    const pool = new DynamicObjectPool(resources)
    pool.#minSize = min
    pool.#maxSize = max
    pool.#resourceFactory = resourceFactory
    pool.#validateResource = validateResource
    pool.#resourceDestroyer = resourceDestroyer
    pool.#scaleUpThreshold = scaleUpThreshold
    pool.#scaleUpIncrement = scaleUpIncrement
    pool.#idleTimeoutMs = idleTimeoutMs
    pool.#scaleDownCheckIntervalMs = scaleDownCheckIntervalMs
    pool.#validateOnAcquire = validateOnAcquire ?? Boolean(validateResource)
    pool.#createRetries = createRetries

    pool.#lastActivityAt = Date.now()
    pool.#metrics.resourcesCreated = resources.length

    if (idleTimeoutMs > 0 && scaleDownCheckIntervalMs > 0) {
      pool.#startScaleDownMonitoring()
    }

    if (pool.pool.size() < initialTarget) {
      pool.#fillToTarget(initialTarget).catch((err) => console.error('Failed to fill initial resources:', err))
    }

    return pool
  }

  async #fillToTarget(targetSize) {
    while (this.pool.size() < targetSize) {
      const resource = await this.#createResourceWithRetry()
      super.add(resource)
      this.#lastActivityAt = Date.now()
    }
  }

  async #createResourceWithRetry() {
    let lastError
    for (let attempt = 0; attempt < this.#createRetries; attempt++) {
      try {
        const resource = await Promise.resolve(this.#resourceFactory())
        this.#metrics.resourcesCreated++
        return resource
      } catch (err) {
        lastError = err
        if (attempt < this.#createRetries - 1) {
          const delay = Math.min(200, 10 * Math.pow(2, attempt))
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }
    throw lastError
  }

  #shouldScaleUp() {
    if (this.pool.size() >= this.#maxSize) return false
    if (this.#isScaling) return false
    if (Date.now() < this.#scaleUpCooldownUntil) return false

    const pending = this.#pendingAsync
    const available = this.pool.availableCount()
    return pending >= this.#scaleUpThreshold && pending > available
  }

  #maybeScaleUp() {
    if (this.#shouldScaleUp()) {
      this.#scaleUp().catch((err) => console.error('Scale up error:', err))
      return
    }

    if (this.#scaleUpCheckTimer || this.#pendingAsync === 0) return

    this.#scaleUpCheckTimer = setTimeout(() => {
      this.#scaleUpCheckTimer = null
      if (this.#shouldScaleUp()) {
        this.#scaleUp().catch((err) => console.error('Scale up error:', err))
      }
    }, 0)

    if (this.#scaleUpCheckTimer.unref) {
      this.#scaleUpCheckTimer.unref()
    }
  }

  async #scaleUp() {
    if (this.#isScaling) return
    this.#isScaling = true

    try {
      const currentSize = this.pool.size()
      const available = this.pool.availableCount()
      const pending = this.#pendingAsync
      const needed = Math.max(this.#scaleUpIncrement, pending - available)
      const toAdd = Math.min(needed, this.#maxSize - currentSize)

      if (toAdd <= 0) {
        return
      }

      for (let i = 0; i < toAdd; i++) {
        try {
          const resource = await this.#createResourceWithRetry()
          super.add(resource)
          this.#lastActivityAt = Date.now()
          this.#scaleUpFailureCount = 0
        } catch (err) {
          console.error('Failed to scale up:', err)
          this.#scaleUpFailureCount += 1
          this.#scaleUpCooldownUntil = Date.now() + Math.min(1000, 50 * this.#scaleUpFailureCount)
          break
        }
      }

      this.#metrics.scaleUpEvents++
    } finally {
      this.#isScaling = false
    }
  }

  #startScaleDownMonitoring() {
    const scheduleNext = () => {
      const jitter = Math.floor(this.#scaleDownCheckIntervalMs * 0.1 * (Math.random() - 0.5))
      const nextIn = Math.max(10, this.#scaleDownCheckIntervalMs + jitter)
      this.#scaleDownTimer = setTimeout(() => {
        this.#checkAndScaleDown()
        scheduleNext()
      }, nextIn)

      if (this.#scaleDownTimer.unref) {
        this.#scaleDownTimer.unref()
      }
    }

    scheduleNext()
  }

  #checkAndScaleDown() {
    if (this.pool.size() <= this.#minSize) return
    if (this.#isScaling) return

    const now = Date.now()
    const available = this.pool.availableCount()
    const currentSize = this.pool.size()

    if (available === 0) return
    if (now - this.#lastActivityAt <= this.#idleTimeoutMs) return

    const canRemove = Math.min(available, currentSize - this.#minSize)

    if (canRemove > 0) {
      for (let i = 0; i < canRemove; i++) {
        const removed = this.removeOne()
        if (removed) {
          this.#metrics.scaleDownEvents++
        } else {
          break
        }
      }
    }
  }

  async #validateResourceIfNeeded(resource) {
    if (!this.#validateResource) return true

    try {
      return await Promise.resolve(this.#validateResource(resource))
    } catch (err) {
      console.error('Resource validation error:', err)
      return false
    }
  }

  acquire() {
    const resource = super.acquire()
    this.#lastActivityAt = Date.now()
    return resource
  }

  async acquireAsync(timeoutMs) {
    this.#pendingAsync += 1
    this.#maybeScaleUp()

    try {
      const idx = await this.pool.acquireAsync(timeoutMs)
      const resource = this.resources[idx]

      this.#lastActivityAt = Date.now()

      if (this.#validateOnAcquire) {
        const isValid = await this.#validateResourceIfNeeded(resource)
        if (!isValid) {
          this.pool.release(idx)
          try {
            const newResource = await this.#createResourceWithRetry()
            this.resources[idx] = newResource
            this.resourceToIdx.delete(resource)
            this.resourceToIdx.set(newResource, idx)

            if (this.#resourceDestroyer) {
              await Promise.resolve(this.#resourceDestroyer(resource))
            }

            return newResource
          } catch (err) {
            console.error('Failed to replace invalid resource:', err)
            throw new Error('Resource validation failed and replacement failed')
          }
        }
      }

      return resource
    } finally {
      this.#pendingAsync -= 1
    }
  }

  release(resource) {
    super.release(resource)
    this.#lastActivityAt = Date.now()
  }

  add(resource) {
    super.add(resource)
    this.#lastActivityAt = Date.now()
  }

  removeOne() {
    const idx = this.pool.removeOne()
    if (idx === null) return false

    const resource = this.resources[idx]
    this.resourceToIdx.delete(resource)
    this.resources[idx] = null

    this.#lastActivityAt = Date.now()

    if (this.#resourceDestroyer) {
      Promise.resolve(this.#resourceDestroyer(resource)).catch((err) => console.error('Resource destroyer error:', err))
    }

    this.#metrics.resourcesDestroyed++
    return true
  }

  destroy() {
    if (this.#scaleDownTimer) {
      clearTimeout(this.#scaleDownTimer)
      this.#scaleDownTimer = null
    }
    if (this.#scaleUpCheckTimer) {
      clearTimeout(this.#scaleUpCheckTimer)
      this.#scaleUpCheckTimer = null
    }

    if (this.#resourceDestroyer) {
      for (const resource of this.resources) {
        if (resource !== null) {
          Promise.resolve(this.#resourceDestroyer(resource)).catch((err) =>
            console.error('Resource destroyer error:', err),
          )
        }
      }
    }

    super.destroy()

    this.#lastActivityAt = 0
  }

  getMetrics() {
    return {
      currentSize: this.pool.size(),
      minSize: this.#minSize,
      maxSize: this.#maxSize,
      available: this.pool.availableCount(),
      inUse: this.pool.size() - this.pool.availableCount(),
      pending: Math.max(this.pool.pendingCount(), this.#pendingAsync),
      scaleUpEvents: this.#metrics.scaleUpEvents,
      scaleDownEvents: this.#metrics.scaleDownEvents,
      resourcesCreated: this.#metrics.resourcesCreated,
      resourcesDestroyed: this.#metrics.resourcesDestroyed,
    }
  }

  get minSize() {
    return this.#minSize
  }

  get maxSize() {
    return this.#maxSize
  }
}
