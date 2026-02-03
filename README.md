# resource-pool

![https://github.com/Lojhan/resource-pool/actions](https://github.com/Lojhan/resource-pool/workflows/CI/badge.svg)

A high-performance, thread-safe resource pool implementation for Node.js, written in Rust using NAPI-RS. Perfect for managing limited resources like database connections, HTTP clients, or any reusable objects.

## Features

- 🚀 **High Performance**: Native Rust implementation for blazing-fast resource management
- 🔒 **Thread-Safe**: Built with `Arc<Mutex>` and Tokio's `Semaphore` for safe concurrent access
- ⏱️ **Async Support**: `acquireAsync()` method with optional timeout for async/await workflows
- 💾 **Type Safe**: Full TypeScript support with generic typing
- 📦 **Zero Dependencies**: Self-contained, no external dependencies in production
- ✅ **Comprehensive Tests**: 13+ test cases covering all scenarios

## Installation

```bash
npm install resource-pool
# or
yarn add resource-pool
```

## Quick Start

### Basic Usage

```typescript
import { GenericObjectPool } from 'resource-pool'

// Create a pool with initial resources
const resources = [
  { id: 1, name: 'Connection 1' },
  { id: 2, name: 'Connection 2' },
  { id: 3, name: 'Connection 3' },
]
const pool = new GenericObjectPool(resources)

// Acquire a resource synchronously
const resource = pool.acquire()
console.log(resource) // { id: 1, name: 'Connection 1' }

// Use the resource
// ...

// Release it back to the pool
pool.release(resource)
```

### Async Acquisition with Retry

```typescript
// Acquire a resource asynchronously (with automatic retry)
const resource = await pool.acquireAsync()

// Use the resource
// ...

// Release when done
pool.release(resource)
```

### With Timeout

```typescript
try {
  // Acquire with 5 second timeout
  const resource = await pool.acquireAsync(5000)
  
  // Use the resource
  // ...
  
  pool.release(resource)
} catch (err) {
  console.error('Failed to acquire resource within timeout:', err.message)
}
```

### Dynamic Pool Management

```typescript
const pool = new GenericObjectPool([{ id: 1 }])

// Add resources dynamically
pool.add({ id: 2 })
pool.add({ id: 3 })

// Check available count
console.log(pool.availableCount()) // 3

// Remove an available resource
const removed = pool.removeOne()
console.log(removed) // true
```

## API Reference

### `constructor(resources: T[])`

Create a new resource pool with initial resources.

```typescript
const pool = new GenericObjectPool([resource1, resource2])
```

### `acquire(): T`

Acquire a resource from the pool synchronously.

**Throws**: Error if no resources are available.

```typescript
const resource = pool.acquire()
```

### `acquireAsync(timeoutMs?: number): Promise<T>`

Acquire a resource asynchronously with automatic retry.

- `timeoutMs` (optional): Timeout in milliseconds. Throws if exceeded.
- Returns: Promise that resolves with an available resource
- **Throws**: Error if timeout is exceeded before acquiring a resource

```typescript
const resource = await pool.acquireAsync()
const resourceWithTimeout = await pool.acquireAsync(5000)
```

### `release(resource: T): void`

Release a resource back to the pool.

```typescript
pool.release(resource)
```

### `add(resource: T): void`

Add a new resource to the pool.

```typescript
pool.add(newResource)
```

### `removeOne(): boolean`

Remove one available resource from the pool.

- Returns: `true` if a resource was removed, `false` if all are in use

```typescript
const removed = pool.removeOne()
```

### `availableCount(): number`

Get the number of available resources in the pool.

```typescript
const count = pool.availableCount()
```

## Type Safety

The pool is fully generic and works with TypeScript:

```typescript
interface DatabaseConnection {
  id: number
  query(sql: string): Promise<any>
  close(): Promise<void>
}

const pool = new GenericObjectPool<DatabaseConnection>([
  conn1,
  conn2,
])

// Full type inference
const connection = await pool.acquireAsync()
await connection.query('SELECT * FROM users') // ✓ Type-safe
connection.nonexistent() // ✗ TypeScript error
```

## Concurrency Example

```typescript
// Pool with 2 resources, 3 concurrent operations
const pool = new GenericObjectPool([{ id: 1 }, { id: 2 }])

const operations = [
  (async () => {
    const resource = await pool.acquireAsync()
    await doWork(resource) // 1s
    pool.release(resource)
  })(),
  (async () => {
    const resource = await pool.acquireAsync()
    await doWork(resource) // 1s
    pool.release(resource)
  })(),
  (async () => {
    const resource = await pool.acquireAsync() // Will wait ~1s
    await doWork(resource) // 1s
    pool.release(resource)
  })(),
]

await Promise.all(operations)
// Total time: ~2s (parallelism proven!)
```

## Performance Characteristics

- **Acquire**: O(1) when resources available, retries with 10ms intervals when pool exhausted
- **Release**: O(1)
- **Memory**: Minimal overhead, uses native Rust implementation
- **Thread Safety**: Lock-free when possible, mutex-protected for concurrent access

## Testing

Run the comprehensive test suite:

```bash
npm run test:node
```

Tests include:
- ✅ Pool creation and basic operations
- ✅ Acquire/release cycles
- ✅ Pool exhaustion handling
- ✅ Dynamic resource management
- ✅ Type safety with complex objects
- ✅ 3 parallel operations with 2 resources
- ✅ Timeout handling

## Development

### Requirements

- Rust 1.70+
- Node.js 18+
- Yarn 4+

### Build

```bash
yarn build
```

### Test

```bash
yarn test:node  # Native tests
yarn test       # All tests
```

### Lint & Format

```bash
yarn lint
yarn format
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


## Test in local

- yarn
- yarn build
- yarn test

And you will see:

```bash
$ ava --verbose

  ✔ sync function from native code
  ✔ sleep function from native code (201ms)
  ─

  2 tests passed
✨  Done in 1.12s.
```

## Release package

Ensure you have set your **NPM_TOKEN** in the `GitHub` project setting.

In `Settings -> Secrets`, add **NPM_TOKEN** into it.

When you want to release the package:

```bash
npm version [<newversion> | major | minor | patch | premajor | preminor | prepatch | prerelease [--preid=<prerelease-id>] | from-git]

git push
```

GitHub actions will do the rest job for you.

> WARN: Don't run `npm publish` manually.
