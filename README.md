# @lojhan/resource-pool

![CI](https://github.com/Lojhan/resource-pool/workflows/CI/badge.svg)
[![npm version](https://img.shields.io/npm/v/@lojhan/resource-pool.svg)](https://www.npmjs.com/package/@lojhan/resource-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance, generic resource pool implementation for Node.js built with Rust and N-API.

This library provides a fast, efficient mechanism to manage access to a set of resources (such as database connections, worker threads, or expensive objects). It leverages Rust's performance and safety to outperform pure JavaScript implementations.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Pool Implementations](#pool-implementations)
- [Usage](#usage)
  - [StaticObjectPool](#staticobjectpool---fixed-size-pool)
  - [DynamicObjectPool](#dynamicobjectpool---auto-scaling-pool)
  - [EnginePool](#enginepool---index-based-pool)
- [API Reference](#api-reference)
- [Choosing the Right Implementation](#choosing-the-right-implementation)
- [Real-World Examples](#real-world-examples)
- [Benchmarks](#benchmarks)
- [TypeScript Support](#typescript-support)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🚀 **High Performance**: Significant speed advantage over pure JS options due to native Rust implementation.
- 🚦 **Flexible Acquisition**: Supports both **synchronous** blocking `acquire()` and **asynchronous** `acquireAsync()` with timeouts.
- 🛡️ **Safety**: The `use()` pattern ensures resources are automatically released back to the pool, even if errors occur.
- 📦 **Generic**: Can store any JavaScript object.
- 📊 **Observability**: Real-time properties to monitor `size`, `available` resources, and `pending` requests.
- 🔒 **Concurrency**: Built to handle high concurrency environments efficiently.
- 🔄 **Multiple Implementations**: Choose from static pools, dynamic auto-scaling pools, or lightweight index-based pools.

## Installation

```bash
npm install @lojhan/resource-pool
```

## Quick Start

```javascript
import { StaticObjectPool } from '@lojhan/resource-pool/implementations';

// 1. Create your resources
const connections = [new DatabaseConnection(), new DatabaseConnection(), new DatabaseConnection()];

// 2. Create a pool
const pool = new StaticObjectPool(connections);

// 3. Use resources safely
const result = await pool.use(async (connection) => {
  return await connection.query('SELECT * FROM users');
});
```

That's it! The pool handles acquisition, release, and cleanup automatically.

## Pool Implementations

This library provides three distinct pool implementations to suit different use cases:

### 1. **StaticObjectPool** - Object Pool with Fixed Size

A traditional object pool that manages a fixed set of resources. Best for scenarios where you know the exact number of resources needed upfront.

**Use when:**

- You have a fixed number of resources (e.g., database connections)
- Resource creation is expensive and should be done upfront
- You want predictable memory usage

### 2. **DynamicObjectPool** - Auto-Scaling Object Pool

Extends `StaticObjectPool` with automatic scaling capabilities. The pool grows when demand increases and shrinks when resources are idle.

**Use when:**

- Resource demand varies over time
- You want to optimize resource usage automatically
- You need resource validation and lifecycle management
- You want to balance performance with resource efficiency

### 3. **EnginePool** - Lightweight Index-Based Pool for Load Shedding

A minimal pool that manages indices (0, 1, 2...) instead of objects. Ultra-lightweight and optimized for implementing load shedding algorithms that fail fast under load.

**Use when:**

- You need load shedding or circuit breaker patterns
- You want to reject requests instead of queuing indefinitely
- You already have resources in an array/structure
- Maximum performance and minimal latency are critical
- You're implementing graceful degradation strategies

## Usage

### StaticObjectPool - Fixed-Size Pool

Perfect for managing a known set of resources like database connections.

```javascript
import { StaticObjectPool } from '@lojhan/resource-pool/implementations';

// Create a pool with pre-initialized resources
const dbConnections = [new Connection('db1'), new Connection('db2'), new Connection('db3')];
const pool = new StaticObjectPool(dbConnections);

// Recommended: Use the `use()` method for automatic resource management
async function handleRequest() {
  const result = await pool.use(async (connection) => {
    console.log(`Using connection: ${connection.id}`);
    return await connection.query('SELECT * FROM users');
  });
  console.log('Query result:', result);
}

// Manual acquire/release (ensure you always release!)
async function manualWork() {
  let resource;
  try {
    resource = await pool.acquireAsync(5000); // 5s timeout
    await processWork(resource);
  } finally {
    if (resource) {
      pool.release(resource);
    }
  }
}

// Synchronous acquisition (throws if no resources available)
try {
  const resource = pool.acquire();
  // ... use resource
  pool.release(resource);
} catch (e) {
  console.log('No resources immediately available');
}

// Monitor pool state
console.log('Available:', pool.available);
console.log('In use:', pool.numUsed);
console.log('Pending:', pool.pendingCount);
```

### DynamicObjectPool - Auto-Scaling Pool

Automatically scales resources based on demand. Perfect for variable workloads.

```javascript
import { DynamicObjectPool } from '@lojhan/resource-pool/implementations';

// Create a dynamic pool with comprehensive configuration
const pool = DynamicObjectPool.withDynamicSizing({
  // Size constraints
  min: 2, // Minimum number of resources
  max: 10, // Maximum number of resources
  initial: 3, // Initial size (between min and max)

  // Resource lifecycle callbacks
  resourceFactory: async () => {
    // Create new resources on demand
    return new DatabaseConnection(config);
  },

  resourceDestroyer: async (resource) => {
    // Clean up resources when scaling down
    await resource.close();
  },

  validateResource: async (resource) => {
    // Optional: validate resources before use
    return resource.isConnected();
  },

  // Scaling behavior
  scaleUpThreshold: 5, // Scale up when 5+ requests are waiting
  scaleUpIncrement: 2, // Add 2 resources at a time when scaling up
  idleTimeoutMs: 30000, // Remove idle resources after 30s
  scaleDownCheckIntervalMs: 10000, // Check for scale-down every 10s

  // Validation
  validateOnAcquire: true, // Validate resources when acquired
  createRetries: 3, // Retry resource creation 3 times on failure
});

// Use the pool (same API as StaticObjectPool)
await pool.use(async (connection) => {
  return await connection.query('SELECT * FROM users');
});

// Monitor scaling metrics
const metrics = pool.getMetrics();
console.log({
  currentSize: metrics.currentSize,
  minSize: metrics.minSize,
  maxSize: metrics.maxSize,
  available: metrics.available,
  inUse: metrics.inUse,
  pending: metrics.pending,
  scaleUpEvents: metrics.scaleUpEvents,
  scaleDownEvents: metrics.scaleDownEvents,
  resourcesCreated: metrics.resourcesCreated,
  resourcesDestroyed: metrics.resourcesDestroyed,
});

// Clean up when done
pool.destroy();
```

### EnginePool - Index-Based Pool with Load Shedding

Lightweight pool that manages indices instead of objects. Ideal for implementing load shedding algorithms that reject requests when the system is overloaded.

```javascript
import { EnginePool } from '@lojhan/resource-pool/implementations';

// Pre-allocate your resources in an array
const workers = [
  new Worker('./worker.js'),
  new Worker('./worker.js'),
  new Worker('./worker.js'),
  new Worker('./worker.js'),
];

// Create an index pool for load shedding
const pool = new EnginePool(workers.length);

// Load shedding thresholds
const MAX_QUEUE_DEPTH = 5;
const ACQUIRE_TIMEOUT_MS = 100; // Fail fast

// Load shedding: reject requests when overloaded
async function handleRequest(req, res) {
  // Check if system is overloaded
  if (pool.pendingCount >= MAX_QUEUE_DEPTH) {
    res.status(503).json({
      error: 'Service overloaded',
      message: 'Too many pending requests, try again later',
      retryAfter: 1,
    });
    return;
  }

  // Try to acquire with short timeout (fail fast)
  try {
    const result = await pool.use(
      async (idx) => {
        const worker = workers[idx];
        return await worker.processTask(req.body);
      },
      { timeout: ACQUIRE_TIMEOUT_MS },
    );

    res.json({ result });
  } catch (err) {
    if (err.message.includes('timeout')) {
      // Load shedding: reject rather than queue
      res.status(503).json({
        error: 'Service busy',
        message: 'Unable to process request, please retry',
        retryAfter: 1,
      });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
}

// Advanced load shedding with graceful degradation
async function smartLoadShedding(task) {
  const utilization = pool.numUsed / pool.size;

  // Immediate rejection if fully utilized
  if (utilization >= 1.0 && pool.pendingCount > 0) {
    throw new Error('SERVICE_OVERLOADED: All workers busy');
  }

  // Dynamic timeout based on load
  const timeout = utilization < 0.7 ? 1000 : 100;

  try {
    // Try optimistic acquire first
    let idx;
    try {
      idx = pool.acquire();
    } catch {
      // Fall back to async with load-based timeout
      idx = await pool.acquireAsync(timeout);
    }

    try {
      return await workers[idx].processTask(task);
    } finally {
      pool.release(idx);
    }
  } catch (err) {
    // Shed load with informative error
    throw new Error(`LOAD_SHED: ${err.message} (utilization: ${(utilization * 100).toFixed(1)}%)`);
  }
}

// Monitor load and emit metrics
setInterval(() => {
  const metrics = pool.getMetrics();
  const utilization = ((metrics.inUse / metrics.currentSize) * 100).toFixed(1);

  console.log({
    utilization: `${utilization}%`,
    available: metrics.available,
    inUse: metrics.inUse,
    pending: metrics.pending,
    isOverloaded: metrics.pending > MAX_QUEUE_DEPTH,
  });
}, 5000);
```

## API Reference

### Common Pool Methods (All Implementations)

All pool implementations share these core methods:

#### `pool.use<R>(fn: (resource: T | number) => Promise<R>, options?): Promise<R>`

Acquires a resource, executes `fn`, and automatically releases the resource.

**Options:**

- `timeout` (number): Max time to wait for a resource in milliseconds
- `optimistic` (boolean): Try synchronous acquire first (default: `true`)

**Returns:** Promise resolving to the function's return value

```javascript
const result = await pool.use(
  async (resource) => {
    return await resource.doWork();
  },
  { timeout: 5000 },
);
```

#### `pool.acquireAsync(timeoutMs?: number): Promise<T | number>`

Acquires a resource asynchronously. Returns a Promise that resolves when a resource becomes available.

**Parameters:**

- `timeoutMs` (optional): Maximum wait time in milliseconds

**Returns:** Promise resolving to the resource (or index for `EnginePool`)

**Throws:** Error if timeout is reached

```javascript
const resource = await pool.acquireAsync(5000);
```

#### `pool.acquire(): T | number`

Synchronously acquires a resource.

**Returns:** The resource (or index for `EnginePool`)

**Throws:** Error if no resources are immediately available

```javascript
try {
  const resource = pool.acquire();
} catch (err) {
  console.log('No resources available');
}
```

#### `pool.release(resource: T | number): void`

Returns a resource to the pool, making it available for other consumers.

**Parameters:**

- `resource`: The resource to release (or index for `EnginePool`)

```javascript
pool.release(resource);
```

#### `pool.availableCount(): number`

Returns the number of idle resources ready to be acquired.

#### `pool.destroy(): void`

Destroys the pool, clearing all resources and stopping any background tasks.

### Common Properties

- `pool.size`: Total number of resources in the pool
- `pool.available`: Number of idle resources ready to be acquired
- `pool.pendingCount`: Number of callers waiting for a resource
- `pool.numUsed`: Number of resources currently in use

### StaticObjectPool Specific

#### Constructor

```typescript
new StaticObjectPool<T>(resources: T[])
```

Creates a pool with a fixed set of resources.

**Parameters:**

- `resources`: Array of pre-initialized resources

#### Additional Methods

##### `pool.add(resource: T): void`

Adds a new resource to the pool dynamically.

```javascript
pool.add(newConnection);
```

##### `pool.removeOne(): boolean`

Removes one idle resource from the pool.

**Returns:** `true` if a resource was removed, `false` if none were available

```javascript
if (pool.removeOne()) {
  console.log('Resource removed');
}
```

##### `pool.getMetrics(): PoolMetrics`

Returns detailed pool metrics.

**Returns:**

```typescript
{
  currentSize: number;
  minSize: number;
  maxSize: number;
  available: number;
  inUse: number;
  pending: number;
  scaleUpEvents: number;
  scaleDownEvents: number;
  resourcesCreated: number;
  resourcesDestroyed: number;
}
```

### DynamicObjectPool Specific

Extends all `StaticObjectPool` methods with dynamic sizing capabilities.

#### Static Factory Method

```typescript
DynamicObjectPool.withDynamicSizing<T>(config: DynamicSizingConfig<T>): DynamicObjectPool<T>
```

Creates a dynamically-sized pool with automatic scaling.

**Configuration:**

```typescript
interface DynamicSizingConfig<T> {
  // Required
  min: number; // Minimum pool size
  max: number; // Maximum pool size
  resourceFactory: () => T | Promise<T>; // Factory to create resources

  // Optional
  initial?: number; // Initial size (default: min)
  validateResource?: (resource: T) => boolean | Promise<boolean>;
  resourceDestroyer?: (resource: T) => void | Promise<void>;
  scaleUpThreshold?: number; // Pending requests to trigger scale-up (default: 5)
  scaleUpIncrement?: number; // Resources to add per scale-up (default: 1)
  idleTimeoutMs?: number; // Time before removing idle resources (default: 30000)
  scaleDownCheckIntervalMs?: number; // Interval for scale-down checks (default: 10000)
  validateOnAcquire?: boolean; // Validate resources on acquire (default: false)
  createRetries?: number; // Retries for resource creation (default: 3)
}
```

#### Additional Properties

- `pool.minSize`: Minimum pool size
- `pool.maxSize`: Maximum pool size

### EnginePool Specific

Works with indices (numbers) instead of objects.

#### Constructor

```typescript
new EnginePool(size: number)
```

Creates a pool managing indices from 0 to size-1.

**Parameters:**

- `size`: Number of indices to manage

```javascript
const pool = new EnginePool(4); // Manages indices: 0, 1, 2, 3
```

#### Methods

All methods are the same as other pools, but work with `number` (indices) instead of objects:

- `acquire(): number` - Returns an index
- `acquireAsync(timeoutMs?: number): Promise<number>` - Returns a Promise<index>
- `release(idx: number): void` - Releases an index
- `add(idx: number): void` - Adds an index to the pool
- `removeOne(): number | null` - Removes and returns an index, or null
- `use<R>(fn: (idx: number) => Promise<R>, options?): Promise<R>`

## Choosing the Right Implementation

### StaticObjectPool

**Best for:**

- Database connection pools with fixed size
- Pre-allocated expensive objects
- Predictable, stable workloads
- Maximum performance with known resource count

**Example use cases:**

- PostgreSQL connection pool (fixed 10 connections)
- WebGL context pool
- File descriptor pool
- Pre-warmed HTTP agents

### DynamicObjectPool

**Best for:**

- Variable workload patterns
- Cloud environments with dynamic scaling
- Resource-constrained systems
- Services with unpredictable traffic

**Example use cases:**

- API services with varying traffic
- Background job processors
- Serverless function pools
- Multi-tenant systems

**Benefits:**

- Automatically scales with demand
- Reduces resource usage during idle periods
- Built-in resource validation and health checks
- Lifecycle management (creation/destruction)

### EnginePool

**Best for:**

- Load shedding and fast-fail patterns
- Managing access to array-indexed resources
- High-throughput systems that reject overload
- Rate limiting and backpressure

**Example use cases:**

- Load shedding in high-traffic APIs
- Worker thread pools with fail-fast behavior
- Circuit breaker implementations
- Real-time systems with strict latency SLAs
- Microservices with graceful degradation

**Benefits:**

- Ultra-lightweight (no object mapping overhead)
- Fastest performance for quick acquire/reject decisions
- Direct array index access
- Ideal for implementing load shedding algorithms
- Perfect for preventing cascading failures

## Real-World Examples

### Database Connection Pool

```javascript
import { DynamicObjectPool } from '@lojhan/resource-pool/implementations';
import { Pool } from 'pg';

const pool = DynamicObjectPool.withDynamicSizing({
  min: 2,
  max: 20,
  initial: 5,
  resourceFactory: async () => {
    const client = await new Pool(dbConfig).connect();
    return client;
  },
  validateResource: async (client) => {
    try {
      await client.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
  resourceDestroyer: async (client) => {
    await client.release();
  },
  scaleUpThreshold: 3,
  idleTimeoutMs: 60000,
});

// Use in your application
app.get('/users', async (req, res) => {
  const users = await pool.use(async (client) => {
    const result = await client.query('SELECT * FROM users');
    return result.rows;
  });
  res.json(users);
});
```

### Load Shedding API with Worker Pool

```javascript
import { EnginePool } from '@lojhan/resource-pool/implementations';
import { Worker } from 'worker_threads';
import express from 'express';

const app = express();

// Pre-create workers
const workers = Array.from({ length: 4 }, () => new Worker('./cpu-intensive-worker.js'));

const pool = new EnginePool(workers.length);

// Load shedding configuration
const MAX_PENDING = 10;
const FAST_TIMEOUT = 50; // milliseconds

// Implement load shedding middleware
app.post('/api/process', async (req, res) => {
  // Shed load if queue is too deep
  if (pool.pendingCount >= MAX_PENDING) {
    return res.status(503).json({
      error: 'Service overloaded',
      pending: pool.pendingCount,
      retryAfter: 2,
    });
  }

  try {
    // Fast-fail with short timeout
    const result = await pool.use(
      async (idx) => {
        const worker = workers[idx];
        worker.postMessage(req.body);

        return new Promise((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
        });
      },
      { timeout: FAST_TIMEOUT },
    );

    res.json({ result });
  } catch (err) {
    if (err.message.includes('timeout')) {
      // Load shed with 503 Service Unavailable
      res.status(503).json({
        error: 'Service busy',
        message: 'Request processing capacity exceeded',
      });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Health check endpoint with load information
app.get('/health', (req, res) => {
  const metrics = pool.getMetrics();
  const utilization = metrics.inUse / metrics.currentSize;

  res.json({
    status: utilization < 0.9 ? 'healthy' : 'degraded',
    utilization: `${(utilization * 100).toFixed(1)}%`,
    available: metrics.available,
    pending: metrics.pending,
  });
});
```

### HTTP Agent Pool

```javascript
import { StaticObjectPool } from '@lojhan/resource-pool/implementations';
import https from 'https';

// Create a pool of HTTP agents with keep-alive
const agents = Array.from(
  { length: 5 },
  () =>
    new https.Agent({
      keepAlive: true,
      maxSockets: 50,
    }),
);

const pool = new StaticObjectPool(agents);

async function makeRequest(url) {
  return pool.use(async (agent) => {
    const response = await fetch(url, { agent });
    return response.json();
  });
}
```

## Benchmarks

This library is significantly faster than popular JavaScript-based pools because the core locking and queueing logic is implemented in Rust.

| Name                               | Duration (ms) |    Ops/Sec |
| :--------------------------------- | ------------: | ---------: |
| GenericObjectPool (Static/Sync)    |         98.74 | 10,127,612 |
| GenericObjectPool (Engine/Index)   |        114.67 |  8,720,727 |
| GenericObjectPool (Dynamic/Sync)   |         165.4 |  6,045,994 |
| GenericObjectPool (Engine) .use()  |        203.83 |  4,906,147 |
| GenericObjectPool (Static) .use()  |        208.65 |  4,792,609 |
| GenericObjectPool (Dynamic) .use() |        217.22 |  4,603,536 |
| generic-pool (Async)               |        670.11 |  1,492,293 |
| generic-pool .use()                |        700.59 |  1,427,365 |
| tarn (Pure JS/Async)               |        992.29 |  1,007,765 |
| tarn (manual .use)                 |       1099.27 |    909,696 |

_Benchmarks run on macOS (Apple Silicon). Lower is better._

## TypeScript Support

All implementations are fully typed with comprehensive TypeScript definitions.

```typescript
import {
  StaticObjectPool,
  DynamicObjectPool,
  EnginePool,
  DynamicSizingConfig,
  PoolMetrics,
} from '@lojhan/resource-pool/implementations';

// Type-safe pool with custom resources
interface DatabaseConnection {
  query(sql: string): Promise<any>;
  close(): Promise<void>;
}

const pool = new StaticObjectPool<DatabaseConnection>([await createConnection(), await createConnection()]);

// Type inference works automatically
const result = await pool.use(async (conn) => {
  // conn is automatically typed as DatabaseConnection
  return await conn.query('SELECT 1');
});

// Dynamic pool with type-safe config
const dynamicPool = DynamicObjectPool.withDynamicSizing<DatabaseConnection>({
  min: 2,
  max: 10,
  resourceFactory: async () => createConnection(),
  validateResource: async (conn) => {
    try {
      await conn.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
});
```

## Migration Guide

### From older versions using `GenericObjectPool`

If you're using the low-level `GenericObjectPool` export from older versions or need to migrate:

```javascript
// Old (index-based native pool)
import { GenericObjectPool } from '@lojhan/resource-pool';
const pool = new GenericObjectPool(5);
const idx = await pool.acquireAsync();
// use workers[idx]
pool.release(idx);

// New (recommended - use EnginePool for same behavior)
import { EnginePool } from '@lojhan/resource-pool/implementations';
const pool = new EnginePool(5);
const idx = await pool.acquireAsync();
// use workers[idx]
pool.release(idx);

// Or upgrade to object-based pool
import { StaticObjectPool } from '@lojhan/resource-pool/implementations';
const pool = new StaticObjectPool(workers);
const worker = await pool.acquireAsync();
// use worker directly
pool.release(worker);
```

## Troubleshooting

### Resource Leaks

Always use the `use()` method when possible to prevent resource leaks:

```javascript
// ❌ Bad - resource may leak if error occurs
const resource = await pool.acquireAsync();
await doWork(resource);
pool.release(resource);

// ✅ Good - resource always released
await pool.use(async (resource) => {
  await doWork(resource);
});
```

### Deadlocks

Avoid acquiring multiple resources from the same pool within nested operations:

```javascript
// ❌ Bad - potential deadlock
await pool.use(async (resource1) => {
  await pool.use(async (resource2) => {
    // This can deadlock if pool size < 2
  });
});

// ✅ Good - acquire resources at the same level
const resource1 = await pool.acquireAsync();
const resource2 = await pool.acquireAsync();
try {
  await doWork(resource1, resource2);
} finally {
  pool.release(resource1);
  pool.release(resource2);
}
```

### DynamicObjectPool not scaling

If your dynamic pool isn't scaling as expected:

1. Check `scaleUpThreshold` - ensure it matches your workload
2. Verify `resourceFactory` doesn't throw errors
3. Monitor metrics with `pool.getMetrics()` to see scale events
4. Ensure `max` is greater than `min`

```javascript
// Debug scaling behavior
const metrics = pool.getMetrics();
console.log('Scale events:', {
  scaleUp: metrics.scaleUpEvents,
  scaleDown: metrics.scaleDownEvents,
  created: metrics.resourcesCreated,
  destroyed: metrics.resourcesDestroyed,
});
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
