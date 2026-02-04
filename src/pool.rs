use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::timeout;

#[derive(Debug, Clone, PartialEq)]
pub enum PoolError {
  Timeout,
  Closed,
  LockPoisoned,
  Empty,
}

impl std::fmt::Display for PoolError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      PoolError::Timeout => write!(f, "Timeout acquiring resource"),
      PoolError::Closed => write!(f, "Pool closed"),
      PoolError::LockPoisoned => write!(f, "Lock poisoned"),
      PoolError::Empty => write!(f, "Pool empty"),
    }
  }
}

impl std::error::Error for PoolError {}

pub struct CorePool<T> {
  pool: Arc<Mutex<Vec<T>>>,
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
    Self {
      pool: Arc::new(Mutex::new(items)),
      semaphore: Arc::new(Semaphore::new(count)),
      size: Arc::new(AtomicUsize::new(count)),
      pending: Arc::new(AtomicUsize::new(0)),
    }
  }

  pub fn try_acquire(&self) -> Option<T> {
    let permit = self.semaphore.try_acquire().ok()?;
    permit.forget();
    let mut pool = self.pool.lock().ok()?;
    pool.pop()
  }

  pub async fn acquire_async(&self, timeout_ms: Option<u64>) -> Result<T, PoolError> {
    self.pending.fetch_add(1, Ordering::Relaxed);
    let permit_result = if let Some(ms) = timeout_ms {
      timeout(Duration::from_millis(ms), self.semaphore.acquire()).await
    } else {
      Ok(self.semaphore.acquire().await)
    };
    self.pending.fetch_sub(1, Ordering::Relaxed);

    let permit = match permit_result {
      Ok(Ok(p)) => p,
      Ok(Err(_)) => return Err(PoolError::Closed), // Semaphore closed error
      Err(_) => return Err(PoolError::Timeout),    // Timeout error
    };

    permit.forget();

    let mut pool = self.pool.lock().map_err(|_| PoolError::LockPoisoned)?;
    pool.pop().ok_or(PoolError::Empty)
  }

  pub fn release(&self, item: T) {
    if let Ok(mut pool) = self.pool.lock() {
      pool.push(item);
      self.semaphore.add_permits(1);
    }
  }

  pub fn add(&self, item: T) {
    if let Ok(mut pool) = self.pool.lock() {
      pool.push(item);
      self.semaphore.add_permits(1);
      self.size.fetch_add(1, Ordering::Relaxed);
    }
  }

  pub fn remove_one(&self) -> bool {
    if let Ok(permit) = self.semaphore.try_acquire() {
      permit.forget();
      if let Ok(mut pool) = self.pool.lock() {
        if pool.pop().is_some() {
          self.size.fetch_sub(1, Ordering::Relaxed);
          return true;
        }
      }
    }
    false
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

  pub fn destroy(&self) {
    self.semaphore.close();
    if let Ok(mut pool) = self.pool.lock() {
      let dropped = pool.len();
      pool.clear();
      if dropped > 0 {
        self.size.fetch_sub(dropped, Ordering::Relaxed);
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Instant;

  #[tokio::test]
  async fn test_simple_acquire_release() {
    let pool = CorePool::new(vec![1, 2, 3]);

    let item = pool.acquire_async(None).await.unwrap();
    assert!(vec![1, 2, 3].contains(&item));
    assert_eq!(pool.available_count(), 2);

    pool.release(item);
    assert_eq!(pool.available_count(), 3);
  }

  #[tokio::test]
  async fn test_timeout() {
    let pool = CorePool::new(vec![1]);

    // Acquire the only item
    let _item = pool.acquire_async(None).await.unwrap();
    assert_eq!(pool.available_count(), 0);

    // Try to acquire again with a short timeout
    let start = Instant::now();
    let result = pool.acquire_async(Some(200)).await;
    let duration = start.elapsed();

    assert_eq!(result, Err(PoolError::Timeout));
    assert!(duration >= Duration::from_millis(200));
  }

  #[tokio::test(flavor = "multi_thread")]
  async fn test_concurrency() {
    let pool = CorePool::new(vec![1]); // Only 1 item
    let pool_clone = pool.clone();

    // Acquire the only item
    let _item1 = pool.acquire_async(None).await.unwrap();

    // Spawn a task that returns a resource after a delay
    let handle = tokio::spawn(async move {
      tokio::time::sleep(Duration::from_millis(50)).await;
      // Simulate releasing a resource (or adding a new one)
      pool_clone.release(2);
    });

    // Attempt to acquire another - should wait for the task to release/add
    let start = Instant::now();
    let _item2 = pool.acquire_async(Some(500)).await.unwrap();

    handle.await.unwrap();

    // Should have taken at least 50ms
    assert!(start.elapsed().as_millis() >= 40);

    assert_eq!(_item2, 2);
  }

  #[test]
  fn test_try_acquire() {
    let pool = CorePool::new(vec![10]);
    assert!(pool.try_acquire().is_some());
    assert!(pool.try_acquire().is_none());
  }
}
