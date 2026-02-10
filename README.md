# @lojhan/resource-pool

![CI](https://github.com/Lojhan/resource-pool/workflows/CI/badge.svg)
[![npm version](https://img.shields.io/npm/v/@lojhan/resource-pool.svg)](https://www.npmjs.com/package/@lojhan/resource-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance, zero-dependency resource pooling library for Node.js and TypeScript. Achieve **40M+ operations/sec** with intelligent auto-scaling, resource validation, and built-in timeout protection.

Perfect for managing database connections, worker threads, HTTP clients, or any reusable resource with automatic lifecycle management and production-ready reliability.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Pool Types](#pool-types)
- [API Reference](#api-reference)
  - [createPool()](#createpool)
  - [Configuration Options](#configuration-options)
  - [Pool Methods](#pool-methods)
- [Validation Rules](#validation-rules)
- [Examples](#examples)
- [Benchmarks](#benchmarks)
- [TypeScript Support](#typescript-support)
- [License](#license)

## Features

- ⚡ **Blazing Fast**: 40M+ ops/sec with zero-allocation hot paths
- 🎯 **Two Pool Types**: Auto-scaling ObjectPool & lightweight EnginePool (index-based)
- 🔄 **Flexible Acquisition**: Sync (`acquire()`), async (`acquireAsync()`), or automatic (`use()`)
- 🛡️ **Production Ready**: Resource validation, timeout protection, automatic cleanup
- 🏗️ **Static & Dynamic**: Fixed-size (min === max) or auto-scaling (min < max) pools
- 📊 **Built-In Metrics**: Monitor pool utilization, pending requests, and scaling events
- 🔒 **Type-Safe**: Full TypeScript support with comprehensive type inference
- 🚀 **Zero Dependencies**: Pure TypeScript, no native bindings, minimal overhead

## Installation

```bash
npm install @lojhan/resource-pool
```

Or with yarn/pnpm:

```bash
yarn add @lojhan/resource-pool
pnpm add @lojhan/resource-pool
```

## Quick Start

```typescript
import { createPool } from '@lojhan/resource-pool';

// Create a pool that auto-scales from 2 to 10 resources
const pool = createPool({
  min: 2,
  max: 10,
  resourceFactory: async () => {
    const conn = new DatabaseConnection();
    await conn.connect();
    return conn;
  },
  resourceDestroyer: async (conn) => await conn.close(),
  validateResource: async (conn) => conn.isConnected(),
});

// Automatic resource management (recommended)
const result = await pool.use(async (connection) => {
  return await connection.query('SELECT * FROM users');
});

// Or manual acquire/release
const conn = await pool.acquireAsync(5000); // 5s timeout
try {
  await conn.query('SELECT 1');
} finally {
  pool.release(conn);
}

// Cleanup
await pool.destroy();
```

## Pool Types

### ObjectPool (Resource Management)

The main pool implementation that manages resource lifecycle. Supports both fixed-size and auto-scaling configurations.

#### Fixed-Size Pool (min === max)

Pre-allocates all resources upfront. Best for stable, predictable workloads.

```typescript
const pool = createPool({
  min: 10,
  max: 10,
  resourceFactory: () => new DatabaseConnection(),
});
```

**Best for:**

- Known capacity requirements
- Stable workloads
- Minimal latency (all resources pre-created)

#### Dynamic Pool (min < max)

Starts with minimum resources, scales up on demand, scales down when idle.

```typescript
const pool = createPool({
  min: 2,
  max: 50,
  resourceFactory: async () => new DatabaseConnection(),
  idleTimeoutMs: 30000, // Remove idle resources after 30s
  scaleDownIntervalMs: 10000, // Check every 10s
});
```

**Best for:**

- Variable workloads
- Traffic spikes
- Resource-constrained environments
- Automatic cleanup

### EnginePool (Index Management)

Lightweight pool that manages slot indices instead of resources. For maximum performance and custom resource management.

```typescript
import { EnginePool } from '@lojhan/resource-pool';

const workers = [new Worker('./worker.js'), new Worker('./worker.js')];
const pool = new EnginePool(workers.length);

const idx = await pool.acquireAsync();
try {
  await workers[idx].process(data);
} finally {
  pool.release(idx);
}
```

**Best for:**

- Maximum throughput (39M+ ops/sec)
- Pre-indexed resource arrays
- Load shedding patterns
- Custom resource routing

## API Reference

### createPool()

Creates an ObjectPool for managing resource lifecycle.

```typescript
function createPool<T extends object>(
  config: {
    min?: number;
    max?: number;
    resourceFactory: (() => T) | (() => Promise<T>);
    resourceDestroyer?: (resource: T) => void | Promise<void>;
    validateResource?: (resource: T) => boolean | Promise<boolean>;

    // Timeout protection
    factoryTimeoutMs?: number; // Default: 5000
    destroyerTimeoutMs?: number; // Default: 5000
    validatorTimeoutMs?: number; // Default: 3000

    // Error handling
    bubbleFactoryErrors?: boolean; // Default: false
    bubbleDestroyerErrors?: boolean; // Default: false
    bubbleValidationErrors?: boolean; // Default: false

    // Auto-scaling (dynamic pools only)
    idleTimeoutMs?: number; // Default: 30000
    scaleDownIntervalMs?: number; // Default: 10000

    // Acquisition
    acquireTimeoutMs?: number; // Default: 0 (no timeout)
  },
  initialResources?: T[],
): IObjectPool<T>;
```

### Configuration Options

#### Required Configuration

##### `resourceFactory: () => T | Promise<T>` **(required)**

Function that creates new resources. Can be sync or async.

```typescript
// Sync factory
resourceFactory: () => new Connection();

// Async factory
resourceFactory: async () => {
  const conn = new Connection();
  await conn.connect();
  return conn;
};
```

#### Size Configuration

##### `min?: number` and `max?: number`

Pool size boundaries. See [Validation Rules](#validation-rules) for requirements.

```typescript
// Fixed-size pool (static)
{ min: 10, max: 10 }

// Dynamic pool (auto-scaling)
{ min: 2, max: 50 }

// Static pool from initialResources
{ resourceFactory, /* no min/max */ }
```

#### Optional Lifecycle Hooks

##### `resourceDestroyer?: (resource: T) => void | Promise<void>`

Called when resources are destroyed (scale-down, validation failure, or pool destruction).

```typescript
resourceDestroyer: async (conn) => {
  await conn.close();
  console.log('Connection closed');
};
```

##### `validateResource?: (resource: T) => boolean | Promise<boolean>`

Validates resources before returning from `acquireAsync()`. Invalid resources are destroyed and replaced.

```typescript
validateResource: async (conn) => {
  try {
    await conn.ping();
    return true; // Valid
  } catch {
    return false; // Will be replaced
  }
};
```

#### Timeout Protection

##### `factoryTimeoutMs?: number` (default: 5000)

Maximum time to wait for resource creation. Prevents hanging on slow factories.

##### `destroyerTimeoutMs?: number` (default: 5000)

Maximum time to wait for resource destruction. Prevents hanging on cleanup.

##### `validatorTimeoutMs?: number` (default: 3000)

Maximum time to wait for resource validation. Treats timeout as invalid.

```typescript
{
  factoryTimeoutMs: 10000,    // 10s to create
  destroyerTimeoutMs: 5000,   // 5s to destroy
  validatorTimeoutMs: 2000,   // 2s to validate
}
```

#### Error Handling

##### `bubbleFactoryErrors?: boolean` (default: false)

Controls whether factory errors in background scale-up operations are thrown or logged.

##### `bubbleDestroyerErrors?: boolean` (default: false)

If `true`, errors during resource destruction are thrown. If `false`, errors are silently ignored.

##### `bubbleValidationErrors?: boolean` (default: false)

If `true`, validation errors are thrown. If `false`, errors are treated as invalid (return `false`).

```typescript
{
  bubbleDestroyerErrors: true, // Throw on cleanup errors
  bubbleValidationErrors: true, // Throw on validation errors
}
```

#### Auto-Scaling (Dynamic Pools)

##### `idleTimeoutMs?: number` (default: 30000)

Duration before idle resources are destroyed. Only applies when `min < max`.

##### `scaleDownIntervalMs?: number` (default: 10000)

How often to check for idle resources. Only applies when `min < max`.

```typescript
{
  min: 5,
  max: 50,
  idleTimeoutMs: 60000,       // Remove after 60s idle
  scaleDownIntervalMs: 15000, // Check every 15s
}
```

#### Acquisition Timeout

##### `acquireTimeoutMs?: number` (default: 0)

Default timeout for `acquireAsync()` if not specified per-call. `0` means no timeout.

```typescript
{
  acquireTimeoutMs: 5000, // Default 5s timeout for all acquires
}
```

### Pool Methods

#### `acquire(): T | null`

Synchronously acquire a resource. Returns `null` if none available.

```typescript
const resource = pool.acquire();
if (resource) {
  // Use resource
  pool.release(resource);
} else {
  // Pool exhausted
}
```

#### `acquireAsync(timeoutMs?: number): Promise<T>`

Asynchronously acquire resource, waiting if necessary. Throws on timeout.

```typescript
const resource = await pool.acquireAsync(5000); // 5s timeout
try {
  await resource.doWork();
} finally {
  pool.release(resource);
}
```

#### `use<R>(fn: (resource: T) => R | Promise<R>, timeoutMs?: number): Promise<R>`

**Recommended.** Automatically acquires, executes function, and releases resource (even on error).

```typescript
const result = await pool.use(async (conn) => {
  return await conn.query('SELECT * FROM users');
});
// Connection released automatically
```

#### `release(resource: T): void`

Return resource to pool.

```typescript
pool.release(resource);
```

#### `destroy(): Promise<void>`

Shutdown pool and destroy all resources.

```typescript
await pool.destroy();
```

#### `getMetrics(): PoolMetrics`

Get current pool statistics.

```typescript
const metrics = pool.getMetrics();
console.log({
  size: metrics.size, // Current active resources
  available: metrics.available, // Idle resources
  busy: metrics.busy, // In-use resources
  capacity: metrics.capacity, // Max capacity
  pendingCreates: metrics.pendingCreates, // Resources being created
});
```

### EnginePool

Index-based pool for maximum performance.

```typescript
import { EnginePool } from '@lojhan/resource-pool';

const pool = new EnginePool(size: number);

// Same methods as ObjectPool but returns indices
const idx: number = await pool.acquireAsync();
pool.release(idx);
await pool.use(async (idx) => { ... });
```

## Validation Rules

`createPool()` enforces strict validation rules:

### Required Parameters

- `resourceFactory` is **always required**
- If `min` is specified, `max` is **required**
- If `max` is specified, `min` is **required**

### Static Pool (no min/max)

- When neither `min` nor `max` are provided:
  - `initialResources` are **required**
  - Pool size is `initialResources.length`
  - Pool is **fixed-size** (min === max)

```typescript
// ✅ Valid static pool
createPool(
  {
    resourceFactory: () => new Connection(),
  },
  [conn1, conn2, conn3],
); // min: 3, max: 3
```

### Size Constraints

- `min` must be **non-negative** (>= 0)
- `max` must be **at least 1** (>= 1)
- `max` must be **>= min**
- `max` cannot exceed **INT32_MAX** (2,147,483,647)

### Static Pool (min === max)

- If `initialResources` are provided, length must **exactly equal min**

```typescript
// ❌ Error: Static pool requires exactly 5 resources
createPool(
  {
    min: 5,
    max: 5,
    resourceFactory: () => new Connection(),
  },
  [conn1, conn2, conn3],
); // Only 3 provided

// ✅ Valid
createPool(
  {
    min: 5,
    max: 5,
    resourceFactory: () => new Connection(),
  },
  [conn1, conn2, conn3, conn4, conn5],
); // Exactly 5
```

### Initial Resources

- Cannot exceed `max` capacity

```typescript
// ❌ Error: 10 resources exceed max of 5
createPool(
  {
    min: 2,
    max: 5,
    resourceFactory: () => new Connection(),
  },
  tenConnections,
); // 10 resources

// ✅ Valid

createPool(
  {
    min: 2,
    max: 5,
    resourceFactory: () => new Connection(),
  },
  [conn1, conn2, conn3],
); // 3 resources OK
```

### Dynamic Pool (min < max)

- `min: 0` is **allowed** for lazy/on-demand pools
- `initialResources` are optional

```typescript
// ✅ Valid: Lazy pool
createPool({
  min: 0,
  max: 10,
  resourceFactory: () => new Connection(),
}); // Starts with 0 resources, scales up on demand
```

## Examples

### Database Connection Pool

```typescript
import { createPool } from '@lojhan/resource-pool';
import { Client } from 'pg';

const pool = createPool({
  min: 5,
  max: 20,
  resourceFactory: async () => {
    const client = new Client({
      host: 'localhost',
      database: 'mydb',
    });
    await client.connect();
    return client;
  },
  resourceDestroyer: async (client) => {
    await client.end();
  },
  validateResource: async (client) => {
    try {
      await client.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
  idleTimeoutMs: 60000,
  validatorTimeoutMs: 2000,
});

// Use in your application
async function getUser(id: number) {
  return pool.use(async (client) => {
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  });
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  await pool.destroy();
  process.exit(0);
});
```

### Worker Thread Pool

```typescript
import { createPool } from '@lojhan/resource-pool';
import { Worker } from 'worker_threads';

const pool = createPool({
  min: 4,
  max: 8,
  resourceFactory: () => new Worker('./worker.js'),
  resourceDestroyer: async (worker) => {
    await worker.terminate();
  },
  factoryTimeoutMs: 10000,
});

async function processTask(data: any) {
  return pool.use(async (worker) => {
    return new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage(data);
    });
  });
}
```

### HTTP Client Pool with Validation

```typescript
import { createPool } from '@lojhan/resource-pool';
import fetch from 'node-fetch';

interface HTTPClient {
  fetch: typeof fetch;
  lastUsed: number;
}

const pool = createPool({
  min: 2,
  max: 10,
  resourceFactory: () => ({
    fetch,
    lastUsed: Date.now(),
  }),
  validateResource: (client) => {
    // Invalidate clients older than 5 minutes
    return Date.now() - client.lastUsed < 5 * 60 * 1000;
  },
  idleTimeoutMs: 120000,
});

async function makeRequest(url: string) {
  return pool.use(async (client) => {
    client.lastUsed = Date.now();
    const response = await client.fetch(url);
    return response.json();
  });
}
```

### Load Shedding with EnginePool

```typescript
import { EnginePool } from '@lojhan/resource-pool';
import { Worker } from 'worker_threads';

const workers = Array.from({ length: 4 }, () => new Worker('./worker.js'));
const pool = new EnginePool(workers.length);

async function processWithLoadShedding(task: any) {
  // Fast-fail if no workers available
  const idx = pool.acquire();
  if (idx === null) {
    throw new Error('SERVICE_OVERLOADED');
  }

  try {
    return await new Promise((resolve, reject) => {
      workers[idx].once('message', resolve);
      workers[idx].once('error', reject);
      workers[idx].postMessage(task);
    });
  } finally {
    pool.release(idx);
  }
}

// Health check
function getHealth() {
  const metrics = pool.getMetrics();
  return {
    utilization: (metrics.busy / metrics.capacity) * 100,
    available: metrics.available,
  };
}
```

### Static Pool with Pre-created Resources

```typescript
import { createPool } from '@lojhan/resource-pool';

// Pre-create expensive resources
const connections = await Promise.all(
  Array.from({ length: 5 }, async () => {
    const conn = new ExpensiveConnection();
    await conn.initialize();
    return conn;
  }),
);

// Create static pool from existing resources
const pool = createPool(
  {
    resourceFactory: () => new ExpensiveConnection(), // Fallback (not called if static)
    resourceDestroyer: async (conn) => await conn.close(),
  },
  connections, // Exactly 5 resources, pool is min: 5, max: 5
);

// All resources are immediately available
const conn = pool.acquire(); // Never null in static pool
if (conn) {
  // Use connection
  pool.release(conn);
}
```

## Benchmarks

Performance on modern hardware (Apple M1 Pro):

| Library                         | acquire/release | .use() pattern | vs generic-pool |
| :------------------------------ | --------------: | -------------: | :-------------- |
| **ObjectPool (Dynamic)**        |   48.1M ops/sec |  11.7M ops/sec | **25x faster**  |
| **ObjectPool (Static)**         |   41.6M ops/sec |  12.7M ops/sec | **22x faster**  |
| **EnginePool**                  |   39.2M ops/sec |  13.1M ops/sec | **21x faster**  |
| generic-pool                    |    1.9M ops/sec |   1.7M ops/sec | baseline        |
| tarn                            |    0.9M ops/sec |   0.9M ops/sec | 0.5x            |

**Dynamic vs Static**: Dynamic pools (min < max) allow auto-scaling, while static pools (min === max) have fixed size.

Comparison summary:

- **generic-pool**: ~1.9M ops/sec
- **tarn**: ~0.9M ops/sec
- **@lojhan/resource-pool**: 40-48M ops/sec

Run benchmarks locally:

```bash
cd benchmarks
npm install
npm run bench
```

## TypeScript Support

Full TypeScript support with comprehensive type inference.

```typescript
import { createPool, type IObjectPool, type PoolMetrics } from '@lojhan/resource-pool';

interface DatabaseConnection {
  query(sql: string): Promise<any>;
  close(): Promise<void>;
}

// Type-safe pool
const pool: IObjectPool<DatabaseConnection> = createPool({
  min: 5,
  max: 10,
  resourceFactory: async (): Promise<DatabaseConnection> => {
    const conn = new DatabaseConnection();
    await conn.connect();
    return conn;
  },
});

// Type inference works automatically
const result = await pool.use(async (conn) => {
  // conn is typed as DatabaseConnection
  return await conn.query('SELECT 1');
});

// Metrics are typed
const metrics: PoolMetrics = pool.getMetrics();
console.log(metrics.size, metrics.available, metrics.busy);
```

## Best Practices

### Always Use `use()` Method

```typescript
// ❌ BAD: Prone to leaks if error occurs
const resource = await pool.acquireAsync();
await doSomething(resource);
pool.release(resource);

// ✅ GOOD: Guaranteed release
await pool.use(async (resource) => {
  await doSomething(resource);
});
```

### Implement Resource Validation

```typescript
const pool = createPool({
  min: 5,
  max: 10,
  resourceFactory: async () => createConnection(),
  validateResource: async (conn) => {
    try {
      await conn.ping();
      return true;
    } catch {
      return false; // Will be replaced
    }
  },
  validatorTimeoutMs: 2000,
});
```

### Set Reasonable Timeouts

```typescript
const pool = createPool({
  min: 5,
  max: 10,
  resourceFactory: async () => createConnection(),
  factoryTimeoutMs: 10000, // 10s to create
  destroyerTimeoutMs: 5000, // 5s to destroy
  validatorTimeoutMs: 2000, // 2s to validate
  acquireTimeoutMs: 5000, // 5s default acquire timeout
});
```

### Monitor Pool Metrics

```typescript
setInterval(() => {
  const metrics = pool.getMetrics();
  console.log({
    utilization: (metrics.busy / metrics.capacity) * 100,
    available: metrics.available,
    pending: metrics.pendingCreates,
  });
}, 10000);
```

### Graceful Shutdown

```typescript
async function shutdown() {
  console.log('Shutting down pool...');
  await pool.destroy();
  console.log('Pool destroyed');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

## Troubleshooting

### Pool Exhaustion / Timeouts

**Symptoms:** `acquireAsync()` times out frequently

**Solutions:**

1. Increase `max` pool size
2. Check for resource leaks (not releasing resources)
3. Reduce `acquireTimeoutMs` to fail faster
4. Implement load shedding with EnginePool

### Resources Not Scaling Down

**Symptoms:** Pool stays at max size even when idle

**Solutions:**

1. Check `idleTimeoutMs` is set (default: 30000)
2. Verify `min < max` (only dynamic pools scale)
3. Check `scaleDownIntervalMs` (default: 10000)

### Validation Failures

**Symptoms:** Frequent resource replacements

**Solutions:**

1. Check `validateResource` logic is correct
2. Increase `validatorTimeoutMs` if validation is slow
3. Monitor metrics for `pendingCreates` spikes

### Memory Leaks

**Symptoms:** Memory usage grows over time

**Solutions:**

1. Ensure `resourceDestroyer` properly cleans up
2. Always use `pool.use()` or try/finally with manual acquire
3. Call `pool.destroy()` on shutdown

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md)

```bash
npm install
npm test
npm run bench
```

## License

MIT © [Lojhan](https://github.com/Lojhan)
