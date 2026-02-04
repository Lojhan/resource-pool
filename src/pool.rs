use crossbeam_queue::SegQueue;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::timeout;

#[derive(Debug, Clone, PartialEq)]
pub enum PoolError {
  Timeout,
  Closed,
  Empty,
}

impl std::fmt::Display for PoolError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      PoolError::Timeout => write!(f, "Timeout acquiring resource"),
      PoolError::Closed => write!(f, "Pool closed"),
      PoolError::Empty => write!(f, "Pool empty"),
    }
  }
}

impl std::error::Error for PoolError {}

/// A high-performance, lock-free pool core.
/// It uses a Hybrid Architecture:
/// - `SegQueue` (Lock-Free) for storing the resources (indices).
/// - `Semaphore` (Async-Aware) for managing the wait queue and permits.
pub struct CorePool<T> {
  pool: Arc<SegQueue<T>>,
  semaphore: Arc<Semaphore>,
  size: Arc<AtomicUsize>,
  pending: Arc<AtomicUsize>,
}

impl<T> Clone for CorePool<T> {
  fn clone(&self) -> Self {
    Self {
      pool: self.pool.clone(),
      semaphore: self.semaphore.clone(),
      size: self.size.clone(),
      pending: self.pending.clone(),
    }
  }
}

impl<T> CorePool<T> {
  pub fn new(items: Vec<T>) -> Self {
    let count = items.len();
    let queue = SegQueue::new();
    for item in items {
      queue.push(item);
    }
    Self {
      pool: Arc::new(queue),
      semaphore: Arc::new(Semaphore::new(count)),
      size: Arc::new(AtomicUsize::new(count)),
      pending: Arc::new(AtomicUsize::new(0)),
    }
  }

  /// Synchronously attempts to acquire a resource.
  /// If successful, the permit is "forgotten" (leaked) to the caller
  /// and must be restored via `release()`.
  pub fn try_acquire(&self) -> Option<T> {
    let permit = self.semaphore.try_acquire().ok()?;
    permit.forget();
    self.pool.pop()
  }

  /// Asynchronously acquires a resource.
  /// Handles the "wait queue" using Tokio's semaphore.
  pub async fn acquire_async(&self, timeout_ms: Option<u64>) -> Result<T, PoolError> {
    // Optimization: Fast path try_acquire before awaiting
    if let Ok(permit) = self.semaphore.try_acquire() {
      permit.forget();
      if let Some(item) = self.pool.pop() {
        return Ok(item);
      } else {
        // Fallback (should be rare/impossible): return permit and wait properly
        self.semaphore.add_permits(1);
      }
    }

    self.pending.fetch_add(1, Ordering::Relaxed);

    // The Async Wait
    let permit_result = if let Some(ms) = timeout_ms {
      timeout(Duration::from_millis(ms), self.semaphore.acquire()).await
    } else {
      Ok(self.semaphore.acquire().await)
    };

    self.pending.fetch_sub(1, Ordering::Relaxed);

    let permit = match permit_result {
      Ok(Ok(p)) => p,
      Ok(Err(_)) => return Err(PoolError::Closed), // Semaphore closed
      Err(_) => return Err(PoolError::Timeout),    // Timeout
    };

    // "Forget" the permit so it persists while the user holds the resource.
    permit.forget();

    self.pool.pop().ok_or(PoolError::Empty)
  }

  /// Returns a resource to the pool and restores the semaphore permit.
  /// This wakes up the next waiter in the queue.
  pub fn release(&self, item: T) {
    self.pool.push(item);
    self.semaphore.add_permits(1);
  }

  pub fn add(&self, item: T) {
    self.pool.push(item);
    self.semaphore.add_permits(1);
    self.size.fetch_add(1, Ordering::Relaxed);
  }

  pub fn remove_one(&self) -> Option<T> {
    // We must acquire a permit to remove an item to ensure we don't
    // remove an item that is currently reserved for a waiter.
    if let Ok(permit) = self.semaphore.try_acquire() {
      permit.forget();
      if let Some(item) = self.pool.pop() {
        self.size.fetch_sub(1, Ordering::Relaxed);
        return Some(item);
      }
    }
    None
  }

  pub fn available_count(&self) -> usize {
    self.semaphore.available_permits()
  }

  pub fn size(&self) -> usize {
    self.size.load(Ordering::Relaxed)
  }

  pub fn pending_count(&self) -> usize {
    self.pending.load(Ordering::Relaxed)
  }

  pub fn drain(&self) -> Vec<T> {
    self.semaphore.close();
    let mut items = Vec::new();
    while let Some(item) = self.pool.pop() {
      items.push(item);
    }
    let dropped = items.len();
    if dropped > 0 {
      self.size.fetch_sub(dropped, Ordering::Relaxed);
    }
    items
  }
}
