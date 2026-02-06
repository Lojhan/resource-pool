use parking_lot::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::timeout;

#[derive(Debug, Clone, PartialEq)]
pub enum PoolError {
  Timeout,
  Closed,
}

impl std::fmt::Display for PoolError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      PoolError::Timeout => write!(f, "Timeout acquiring resource"),
      PoolError::Closed => write!(f, "Pool closed"),
    }
  }
}

impl std::error::Error for PoolError {}

/// A simple, high-performance pool.
///
/// It relies on `tokio::Semaphore` to handle the "Async Wait" logic
/// and a `Mutex<Vec<u32>>` for storage.
///
/// The Logic:
/// 1. The Semaphore holds the *count* of available resources.
/// 2. The Mutex holds the *actual* resources.
/// 3. We ONLY touch the Mutex if we have successfully acquired a permit from the Semaphore.
///    This guarantees the Mutex never blocks for long and the Vec is never empty when we look.
#[derive(Clone)]
pub struct CorePool {
  // Use a standard Mutex. It is faster than SegQueue for simple integer operations
  // because it doesn't allocate nodes on the heap.
  resources: Arc<Mutex<Vec<u32>>>,
  semaphore: Arc<Semaphore>,
  size: Arc<AtomicUsize>,
  pending: Arc<AtomicUsize>,
}

impl CorePool {
  pub fn new(items: Vec<u32>) -> Self {
    let count = items.len();
    Self {
      resources: Arc::new(Mutex::new(items)),
      semaphore: Arc::new(Semaphore::new(count)),
      size: Arc::new(AtomicUsize::new(count)),
      pending: Arc::new(AtomicUsize::new(0)),
    }
  }

  #[inline]
  pub fn try_acquire(&self) -> Option<u32> {
    // 1. Try to get a permit. If this fails, the pool is empty/closed.
    let permit = self.semaphore.try_acquire().ok()?;

    // 2. We have a permit, so the Mutex MUST contain at least one item.
    // We explicitly forget the permit because the caller now "owns" the slot.
    permit.forget();

    // 3. Pop the index.
    let mut lock = self.resources.lock();
    lock.pop()
  }

  pub async fn acquire_async(&self, timeout_ms: Option<u64>) -> Result<u32, PoolError> {
    // Fast path: try to acquire without registering a waker
    if let Ok(permit) = self.semaphore.try_acquire() {
      permit.forget();
      let mut lock = self.resources.lock();
      return Ok(
        lock
          .pop()
          .expect("Pool desync: Permit acquired but queue empty"),
      );
    }

    self.pending.fetch_add(1, Ordering::Relaxed);

    // The Async Wait
    let acquire_future = self.semaphore.acquire();

    let permit_result = if let Some(ms) = timeout_ms {
      timeout(Duration::from_millis(ms), acquire_future).await
    } else {
      Ok(acquire_future.await)
    };

    self.pending.fetch_sub(1, Ordering::Relaxed);

    match permit_result {
      Ok(Ok(permit)) => {
        permit.forget();
        let mut lock = self.resources.lock();
        // Safe expect: Semaphore guarantees count > 0
        Ok(
          lock
            .pop()
            .expect("Pool desync: Permit acquired but queue empty"),
        )
      }
      Ok(Err(_)) => Err(PoolError::Closed), // Semaphore closed
      Err(_) => Err(PoolError::Timeout),    // Timeout
    }
  }

  pub fn release(&self, idx: u32) {
    {
      let mut lock = self.resources.lock();
      lock.push(idx);
    }
    // Restore the permit AFTER pushing the resource to avoid race conditions
    // where a waiter wakes up before the data is in the Vec.
    self.semaphore.add_permits(1);
  }

  pub fn add(&self, idx: u32) {
    {
      let mut lock = self.resources.lock();
      lock.push(idx);
    }
    self.size.fetch_add(1, Ordering::Relaxed);
    self.semaphore.add_permits(1);
  }

  pub fn remove_one(&self) -> Option<u32> {
    // To remove, we must consume a permit permanently
    if let Ok(permit) = self.semaphore.try_acquire() {
      permit.forget(); // We consume the permit

      let mut lock = self.resources.lock();
      let item = lock.pop();
      if item.is_some() {
        self.size.fetch_sub(1, Ordering::Relaxed);
      }
      return item;
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

  pub fn close(&self) {
    self.semaphore.close();
    let mut lock = self.resources.lock();
    let dropped = lock.len();
    lock.clear();
    if dropped > 0 {
      self.size.fetch_sub(dropped, Ordering::Relaxed);
    }
  }
}
