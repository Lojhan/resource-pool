# Resource Pool

![CI](https://github.com/Lojhan/resource-pool/workflows/CI/badge.svg)
[![npm version](https://img.shields.io/npm/v/@lojhan/resource-pool.svg)](https://www.npmjs.com/package/@lojhan/resource-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance, generic resource pool implementation for Node.js, built with Rust and N-API. It provides robust concurrency control, async acquisition timeouts, and lifecycle management for any type of reusable resource (database connections, worker threads, sophisticated clients, etc.).

## Features

- 🚀 **High Performance**: Native Rust implementation using `Arc<Mutex>` and Tokio `Semaphore` for minimal overhead.
- ⚡ **Async First**: Non-blocking `acquireAsync` with timeout support.
- 🛡️ **Leak Protection**: `.use()` helper handles acquisition and release automatically, even on errors.
- 📊 **Observability**: Metrics for pool size, available resources, used resources, and pending acquisitions.
- 🛑 **Graceful Shutdown**: `.destroy()` method ensuring no new resources are acquired during shutdown.
- 💾 **Type Safe**: Full TypeScript support with generics.

## Installation

```bash
npm install @lojhan/resource-pool
# or
yarn add @lojhan/resource-pool
```

## Usage

### Basic Usage

```typescript
import { GenericObjectPool } from '@lojhan/resource-pool'

// 1. Create a pool
const dbConnections = [new Connection('db1'), new Connection('db2')]
const pool = new GenericObjectPool(dbConnections)

// 2. Safely use a resource
await pool.use(async (conn) => {
  console.log('Got connection:', conn.name)
  await conn.query('SELECT 1')
  // Automatically released after this block !
})
```

### Manual Acquisition (Advanced)

If you need fine-grained control over the lifecycle:

```typescript
try {
  // Acquire with a 5s timeout
  const resource = await pool.acquireAsync(5000)

  try {
    await doWork(resource)
  } finally {
    // ALWAYS release the resource
    pool.release(resource)
  }
} catch (err) {
  if (err.message.includes('timeout')) {
    console.error('Timed out waiting for resource')
  }
}
```

## API Reference

### `constructor(resources: T[])`

Initialize the pool with a set of pre-created resources.

### Acquistion Methods

#### `use<R>(fn: (resource: T) => Promise<R>): Promise<R>`

**Recommended.** Acquires a resource, runs the callback, and guarantees the resource is released back to the pool, even if the callback throws an error.

#### `acquireAsync(timeoutMs?: number): Promise<T>`

Returns a Promise that resolves when a resource becomes available.

- `timeoutMs`: Optional functionality to reject the promise if no resource is available within the specified time.

#### `acquire(): T` (Synchronous)

Immediately returns a resource if available, or throws an error if the pool is empty.

### Management & Lifecycle

#### `add(resource: T): void`

Add a new resource instance to the pool dynamically.

#### `removeOne(): boolean`

Removes one _available_ resource from the pool. Returns `true` if successful, or `false` if all resources are currently in use.

#### `destroy(): void`

Closes the pool.

- Rejects any current `pending` acquisitions with a "Pool closed" error.
- Prevents any future acquisitions.
- Clears internal storage.

### Observability (Getters)

- `pool.size`: Total number of resources managed by the pool.
- `pool.available`: Number of resources currently idle and ready to be acquired.
- `pool.numUsed`: Number of resources currently checked out.
- `pool.pendingCount`: Number of callers currently waiting in line for a resource.

## Example: Managing Database Connections

```typescript
import { GenericObjectPool } from '@lojhan/resource-pool'

// Valid for any resource type
interface DBConnection {
  id: number
  query: (sql: string) => Promise<any>
}

// Initialize resource set
const connections: DBConnection[] = createConnections(10)

const pool = new GenericObjectPool(connections)

async function handleRequest() {
  // Metrics check
  if (pool.pendingCount > 50) {
    throw new Error('System overloaded')
  }

  return pool.use(async (conn) => {
    return await conn.query('SELECT * FROM users')
  })
}

// Shutdown
process.on('SIGTERM', () => {
  pool.destroy()
  closeConnections(connections)
})
```

## Behavior & Concurrency

The pool uses a **First-In-First-Out (FIFO)** fair queuing strategy.

- If resources are available, acquisition is instant.
- If all resources are busy, callers wait in a queue.
- If a timeout is specified, the caller is removed from the queue if the timeout elapses.

## License

MIT
