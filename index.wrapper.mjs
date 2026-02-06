import nativeModule from './index.js'

const NativePool = nativeModule.GenericObjectPool

/**
 * Type-safe wrapper for a generic resource pool
 * @template T
 */
export class GenericObjectPool {
  #dynamicSizing = false
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
  
  #scaleDownInterval = null
  #scaleUpInterval = null
  #lastAcquireTime = new Map()
  #isScaling = false
  #pendingAsync = 0
  
  #metrics = {
    scaleUpEvents: 0,
    scaleDownEvents: 0,
    resourcesCreated: 0,
    resourcesDestroyed: 0
  }

  /**
   * Create a pool with dynamic sizing capabilities
   * @param {Object} config - Configuration object
   * @param {number} config.min - Minimum pool size
   * @param {number} config.max - Maximum pool size
   * @param {number} [config.initial] - Initial pool size (defaults to min)
   * @param {Function} config.resourceFactory - Function to create new resources
   * @param {Function} [config.validateResource] - Optional function to validate resources
   * @param {Function} [config.resourceDestroyer] - Optional function to cleanup resources
   * @param {number} [config.scaleUpThreshold=5] - Number of pending requests before scaling up
   * @param {number} [config.scaleUpIncrement=1] - Number of resources to add when scaling up
   * @param {number} [config.idleTimeoutMs=30000] - Time before idle resources can be removed
   * @param {number} [config.scaleDownCheckIntervalMs=10000] - Interval to check for idle resources
   * @param {boolean} [config.validateOnAcquire=false] - Validate resources on acquire
   * @param {number} [config.createRetries=3] - Number of retries when creating resources fails
   * @returns {GenericObjectPool}
   */
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
      createRetries = 3
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

    // Initialize with initial size (sync - create resources eagerly)
    const resources = []
    const initialTarget = initial
    for (let i = 0; i < initial; i++) {
      try {
        const resource = resourceFactory()
        const isPromise = resource && typeof resource.then === 'function'
        if (isPromise) {
          // Defer async creation to background fill
          continue
        }
        resources.push(resource)
      } catch (err) {
        console.error('Failed to create initial resource:', err)
      }
    }

    // Create pool with resources
    const pool = new GenericObjectPool(resources)
    pool.#dynamicSizing = true
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

    // Track initial resource usage times
    for (const r of pool.resources) {
      pool.#lastAcquireTime.set(r, Date.now())
    }
    pool.#metrics.resourcesCreated = resources.length
    
    // Start monitoring intervals
    pool.#startScaleUpMonitoring()
    if (idleTimeoutMs > 0 && scaleDownCheckIntervalMs > 0) {
      pool.#startScaleDownMonitoring()
    }

    // Fill any missing initial resources in the background with retries
    if (pool.pool.size() < initialTarget) {
      pool.#fillToTarget(initialTarget).catch(err =>
        console.error('Failed to fill initial resources:', err)
      )
    }

    return pool
  }

  /**
   * Create a new resource pool
   * @param {T[]} resources - Initial resources in the pool
   */
  constructor(resources) {
    // 1. Store resources in a JS Array (Fast access)
    this.resources = [...resources]

    // 2. Map Resource -> Index for O(1) release
    this.resourceToIdx = new Map()
    for (const [i, r] of this.resources.entries()) {
      this.resourceToIdx.set(r, i)
    }

    // 3. Initialize Rust pool with just the COUNT
    this.pool = new NativePool(resources.length)
  }

  /**
   * Fill pool to a target size using retries
   * @private
   */
  async #fillToTarget(targetSize) {
    while (this.pool.size() < targetSize) {
      const resource = await this.#createResourceWithRetry()
      this.add(resource)
      this.#lastAcquireTime.set(resource, Date.now())
    }
  }

  /**
   * Create a resource with retry logic
   * @private
   */
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
          await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)))
        }
      }
    }
    throw lastError
  }

  /**
   * Check if we should scale up
   * @private
   */
  #shouldScaleUp() {
    if (!this.#dynamicSizing) return false
    if (this.pool.size() >= this.#maxSize) return false
    if (this.#isScaling) return false
    
    const pending = Math.max(this.pool.pendingCount(), this.#pendingAsync)
    return pending >= this.#scaleUpThreshold
  }

  /**
   * Scale up the pool
   * @private
   */
  async #scaleUp() {
    if (this.#isScaling) return
    this.#isScaling = true

    try {
      const currentSize = this.pool.size()
      const toAdd = Math.min(
        this.#scaleUpIncrement,
        this.#maxSize - currentSize
      )

      if (toAdd <= 0) {
        return
      }

      for (let i = 0; i < toAdd; i++) {
        try {
          const resource = await this.#createResourceWithRetry()
          this.add(resource)
          this.#lastAcquireTime.set(resource, Date.now())
        } catch (err) {
          console.error('Failed to scale up:', err)
        }
      }

      this.#metrics.scaleUpEvents++
    } finally {
      this.#isScaling = false
    }
  }

  /**
   * Start scale-up monitoring
   * @private
   */
  #startScaleUpMonitoring() {
    if (!this.#dynamicSizing) return
    
    this.#scaleUpInterval = setInterval(() => {
      if (this.#shouldScaleUp()) {
        this.#scaleUp().catch(err => console.error('Scale up error:', err))
      }
    }, 50) // Check every 50ms
    
    // Allow Node.js to exit even if interval is running
    if (this.#scaleUpInterval.unref) {
      this.#scaleUpInterval.unref()
    }
  }

  /**
   * Start scale-down monitoring
   * @private
   */
  #startScaleDownMonitoring() {
    this.#scaleDownInterval = setInterval(() => {
      this.#checkAndScaleDown()
    }, this.#scaleDownCheckIntervalMs)
    
    // Allow Node.js to exit even if interval is running
    if (this.#scaleDownInterval.unref) {
      this.#scaleDownInterval.unref()
    }
  }

  /**
   * Check and scale down idle resources
   * @private
   */
  #checkAndScaleDown() {
    if (!this.#dynamicSizing) return
    if (this.pool.size() <= this.#minSize) return
    if (this.#isScaling) return

    const now = Date.now()
    const available = this.pool.availableCount()
    const currentSize = this.pool.size()
    
    // Don't scale down if all resources are in use
    if (available === 0) return

    // Check how many resources have been idle
    let idleCount = 0
    for (const [resource, lastUsed] of this.#lastAcquireTime.entries()) {
      if (now - lastUsed > this.#idleTimeoutMs) {
        idleCount++
      }
    }

    // Only scale down if we have idle resources and won't go below min
    const canRemove = Math.min(
      idleCount,
      available,
      currentSize - this.#minSize
    )

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

  /**
   * Validate a resource
   * @private
   */
  async #validateResourceIfNeeded(resource) {
    if (!this.#validateResource) return true
    
    try {
      return await Promise.resolve(this.#validateResource(resource))
    } catch (err) {
      console.error('Resource validation error:', err)
      return false
    }
  }

  /**
   * Acquire a resource from the pool synchronously
   * Throws error if no resources available
   * @returns {T} A resource from the pool
   * @throws Error if no resources are available
   */
  acquire() {
    // Rust gives us the integer (Index)
    const idx = this.pool.acquire()
    // JS gives us the object (Array Lookup)
    return this.resources[idx]
  }

  /**
   * Acquire a resource from the pool asynchronously with retry
   * @param {number} [timeoutMs] - Optional timeout in milliseconds. If provided, will throw after timeout.
   * @returns {Promise<T>} Promise that resolves with a resource when one becomes available
   * @throws Error if timeout is exceeded before acquiring a resource
   */
  async acquireAsync(timeoutMs) {
    this.#pendingAsync += 1
    if (
      this.#dynamicSizing &&
      this.pool.availableCount() === 0 &&
      this.pool.size() < this.#maxSize
    ) {
      this.#scaleUp().catch(err => console.error('Scale up error:', err))
    }

    try {
      const idx = await this.pool.acquireAsync(timeoutMs)
      const resource = this.resources[idx]
      
      // Track usage time for scale-down decisions
      if (this.#dynamicSizing) {
        this.#lastAcquireTime.set(resource, Date.now())
      }

      // Validate if configured
      if (this.#dynamicSizing && this.#validateOnAcquire) {
        const isValid = await this.#validateResourceIfNeeded(resource)
        if (!isValid) {
          // Release invalid resource and try to replace it
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

  /**
   * Release a resource back to the pool
   * @param {T} resource - The resource to release
   */
  release(resource) {
    // O(1) Lookup
    const idx = this.resourceToIdx.get(resource)

    if (idx === undefined) {
      throw new Error('Resource not belonging to pool')
    }

    this.pool.release(idx)
  }

  /**
   * Add a new resource to the pool
   * @param {T} resource - The resource to add
   */
  add(resource) {
    const newIdx = this.resources.length
    this.resources.push(resource)
    this.resourceToIdx.set(resource, newIdx)
    this.pool.add(newIdx)
  }

  /**
   * Remove one available resource from the pool
   * @returns {boolean} true if a resource was removed, false if all are currently in use
   */
  removeOne() {
    const idx = this.pool.removeOne()
    if (idx === null) return false

    // We mark the slot as empty or null, but we don't resize the array
    // to keep indices stable.
    // Ideally, for a dynamic pool, you'd want a free-list in JS,
    // but for this implementation, we just remove the mapping.
    const resource = this.resources[idx]
    
    // Cleanup tracking
    if (this.#dynamicSizing) {
      this.#lastAcquireTime.delete(resource)
      
      // Call destroyer if provided
      if (this.#resourceDestroyer) {
        Promise.resolve(this.#resourceDestroyer(resource))
          .catch(err => console.error('Resource destroyer error:', err))
      }
      
      this.#metrics.resourcesDestroyed++
    }
    
    this.resourceToIdx.delete(resource)
    this.resources[idx] = null
    return true
  }

  /**
   * Use a resource from the pool with automatic release
   * @template R
   * @param {(resource: T) => Promise<R>} fn - Function to execute with the resource
   * @param {{optimistic?: boolean, timeout?: number}} [options] - Configuration options for acquisition
   * @returns {Promise<R>}
   */
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

  /**
   * Get the number of available resources in the pool
   * @returns {number} Number of available resources
   */
  availableCount() {
    return this.pool.availableCount()
  }
  /**
   * Get the total number of resources managed by the pool
   * @returns {number}
   */
  get size() {
    return this.pool.size()
  }
  get pendingCount() {
    return this.pool.pendingCount()
  }
  /**
   * Get the number of available resources
   * @returns {number}
   */
  get available() {
    return this.pool.availableCount()
  }
  /**
   * Get the number of used resources
   * @returns {number}
   */
  get numUsed() {
    return this.pool.size() - this.pool.availableCount()
  }

  /**
   * Destroy the pool and stop accepting new acquires
   */
  destroy() {
    // Stop monitoring intervals
    if (this.#scaleUpInterval) {
      clearInterval(this.#scaleUpInterval)
      this.#scaleUpInterval = null
    }
    if (this.#scaleDownInterval) {
      clearInterval(this.#scaleDownInterval)
      this.#scaleDownInterval = null
    }

    // Destroy Rust pool (closes semaphore)
    this.pool.destroy()
    
    // Call destroyer on all resources if provided
    if (this.#dynamicSizing && this.#resourceDestroyer) {
      for (const resource of this.resources) {
        if (resource !== null) {
          Promise.resolve(this.#resourceDestroyer(resource))
            .catch(err => console.error('Resource destroyer error:', err))
        }
      }
    }
    
    // Clear JS references
    this.resources = []
    this.resourceToIdx.clear()
    this.#lastAcquireTime.clear()
  }

  /**
   * Get pool metrics (for dynamic sizing)
   * @returns {Object} Metrics object
   */
  getMetrics() {
    return {
      currentSize: this.pool.size(),
      minSize: this.#minSize,
      maxSize: this.#maxSize,
      available: this.pool.availableCount(),
      inUse: this.pool.size() - this.pool.availableCount(),
      pending: this.pool.pendingCount(),
      scaleUpEvents: this.#metrics.scaleUpEvents,
      scaleDownEvents: this.#metrics.scaleDownEvents,
      resourcesCreated: this.#metrics.resourcesCreated,
      resourcesDestroyed: this.#metrics.resourcesDestroyed
    }
  }

  /**
   * Get minimum pool size (for dynamic sizing)
   * @returns {number}
   */
  get minSize() {
    return this.#minSize
  }

  /**
   * Get maximum pool size (for dynamic sizing)
   * @returns {number}
   */
  get maxSize() {
    return this.#maxSize
  }
}
