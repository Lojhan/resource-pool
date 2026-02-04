# @lojhan/resource-pool

![CI](https://github.com/Lojhan/resource-pool/workflows/CI/badge.svg)
[![npm version](https://img.shields.io/npm/v/@lojhan/resource-pool.svg)](https://www.npmjs.com/package/@lojhan/resource-pool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance, generic resource pool implementation for Node.js built with Rust and N-API.

This library provides a fast, efficient mechanism to manage access to a set of resources (such as database connections, worker threads, or expensive objects). It leverages Rust's performance and safety to outperform pure JavaScript implementations.

## Features

- 🚀 **High Performance**: Significant speed advantage over pure JS options due to native Rust implementation.
- 🚦 **Flexible Acquisition**: Supports both **synchronous** blocking `acquire()` and **asynchronous** `acquireAsync()` with timeouts.
- 🛡️ **Safety**: The `use()` pattern ensures resources are automatically released back to the pool, even if errors occur.
- 📦 **Generic**: Can store any JavaScript object.
- 📊 **Observability**: Real-time properties to monitor `size`, `available` resources, and `pending` requests.
- 🔒 **Concurrency**: Built to handle high concurrency environments efficiently.

## Installation

```bash
npm install @lojhan/resource-pool
```

## Usage

### Basic Usage with `use()` (Recommended)

The `use` method handles the full lifecycle of the acquisition, ensuring the resource is released back to the pool when your operation finishes or fails.

```javascript
import { GenericObjectPool } from '@lojhan/resource-pool'

// 1. Create a pool with some resources
// (You are responsible for creating the resource objects)
const dbConnections = [new Connection('db1'), new Connection('db2'), new Connection('db3')]
const pool = new GenericObjectPool(dbConnections)

async function handleRequest() {
  try {
    // 2. Use a resource
    // The pool will acquire a resource, run your function, and release it automatically.
    const result = await pool.use(async (connection) => {
      console.log(`Using connection: ${connection.id}`)
      return await connection.query('SELECT * FROM users')
    })

    console.log('Query result:', result)
  } catch (err) {
    console.error('Operation failed:', err)
  }
}

handleRequest()
```

### Manual Acquire & Release

You can manually control the acquisition if you need more granular control, but you must ensure `release()` is called.

```javascript
import { GenericObjectPool } from '@lojhan/resource-pool'

const pool = new GenericObjectPool([{ id: 1 }, { id: 2 }])

async function manualWork() {
  let resource
  try {
    // Acquire with a timeout (e.g., 5000ms)
    // Returns a Promise that resolves when a resource is available
    resource = await pool.acquireAsync(5000)

    // Do work with resource
    console.log('Processing with', resource.id)
    await processWork(resource)
  } catch (err) {
    if (err.message.includes('timeout')) {
      console.log('Timed out waiting for resource')
    } else {
      console.error('Error:', err)
    }
  } finally {
    // ALWAYS release the resource back to the pool
    if (resource) {
      pool.release(resource)
    }
  }
}
```

### Synchronous Acquisition

If you are in a synchronous context and know resources are available, you can use `acquire()`. This will throw if the pool is empty unless there are resources locally available.

```javascript
try {
  const resource = pool.acquire() // Throws if empty
  // ... use resource
  pool.release(resource)
} catch (e) {
  console.log('No resources immediately available')
}
```

## API Reference

### `new GenericObjectPool(resources: T[])`

Creates a pool pre-filled with the provided array of resources.

### `pool.use<R>(fn: (resource: T) => Promise<R>, options?): Promise<R>`

Acquires a resource, executes `fn`, and releases the resource.
**Options**:

- `timeout`: (number) Max time to wait for a resource in ms.
- `optimistic`: (boolean) Try to acquire synchronously first (default: true).

### `pool.acquireAsync(timeoutMs?: number): Promise<T>`

Returns a promise that resolves with a resource. If `timeoutMs` is provided, rejects if no resource is available within the time limit.

### `pool.acquire(): T`

Synchronously acquires a resource. Throws if none are available.

### `pool.release(resource: T): void`

Returns a resource to the pool, making it available for other consumers.

### `pool.add(resource: T): void`

Adds a new resource to the pool dynamically.

### `pool.removeOne(): boolean`

Removes a resource from the available pool (if one is available). Returns `true` if removed.

### `pool.destroy(): void`

Clears the pool and stops accepting new requests.

### Properties

- `pool.size`: Total number of resources in the pool.
- `pool.available`: Number of idle resources ready to be acquired.
- `pool.pendingCount`: Number of callers waiting for a resource.
- `pool.numUsed`: Number of resources currently acquired.

## Benchmarks

This library is significantly faster than popular JavaScript-based pools because the core locking and queueing logic is implemented in Rust.

| Library                   |        Mean [ms] | Relative Speed |
| :------------------------ | ---------------: | -------------: |
| **@lojhan/resource-pool** | **248.0 ± 17.5** |       **1.00** |
| generic-pool              |     821.2 ± 38.4 | 3.31x (slower) |
| tarn.js                   |    1150.7 ± 49.7 | 4.64x (slower) |

_Benchmarks run on macOS (Apple Silicon). Lower is better._

## License

MIT
