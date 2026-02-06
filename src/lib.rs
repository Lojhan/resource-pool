#![deny(clippy::all)]

mod pool;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use pool::{CorePool, PoolError};

#[napi]
pub struct GenericObjectPool {
  inner: CorePool,
}

#[napi]
impl GenericObjectPool {
  #[napi(constructor)]
  pub fn new(size: u32) -> Self {
    let mut indices = Vec::with_capacity(size as usize);
    for i in 0..size {
      indices.push(i);
    }
    GenericObjectPool {
      inner: CorePool::new(indices),
    }
  }

  #[napi]
  pub fn acquire(&self) -> Result<u32> {
    match self.inner.try_acquire() {
      Some(idx) => Ok(idx),
      None => Err(Error::from_reason("No resources available")),
    }
  }

  #[napi]
  pub async fn acquire_async(&self, timeout_ms: Option<u32>) -> Result<u32> {
    self
      .inner
      .acquire_async(timeout_ms.map(|t| t as u64))
      .await
      .map_err(|e| match e {
        PoolError::Timeout => Error::from_reason(format!(
          "Failed to acquire resource within {:?}ms timeout",
          timeout_ms.unwrap_or(0)
        )),
        PoolError::Closed => Error::from_reason("Pool closed"),
      })
  }

  #[napi]
  pub fn release(&self, idx: u32) {
    self.inner.release(idx);
  }

  #[napi]
  pub fn add(&self, idx: u32) {
    self.inner.add(idx);
  }

  #[napi]
  pub fn remove_one(&self) -> Option<u32> {
    self.inner.remove_one()
  }

  #[napi]
  pub fn available_count(&self) -> u32 {
    self.inner.available_count() as u32
  }

  #[napi]
  pub fn size(&self) -> u32 {
    self.inner.size() as u32
  }

  #[napi]
  pub fn pending_count(&self) -> u32 {
    self.inner.pending_count() as u32
  }

  #[napi]
  pub fn destroy(&self) {
    self.inner.close();
  }
}
