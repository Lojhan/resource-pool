#![deny(clippy::all)]

mod pool;

use crate::pool::{CorePool, PoolError};
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct GenericObjectPool {
  inner: CorePool<ObjectRef<false>>,
}

#[napi]
impl GenericObjectPool {
  #[napi(constructor)]
  pub fn new(_env: Env, initial_values: Vec<Object>) -> Result<Self> {
    let count = initial_values.len();
    let mut refs = Vec::with_capacity(count);
    for val in initial_values {
      refs.push(val.create_ref()?);
    }
    Ok(GenericObjectPool {
      inner: CorePool::new(refs),
    })
  }

  #[napi]
  pub fn acquire(&self, _env: Env) -> Result<ObjectRef<false>> {
    match self.inner.try_acquire() {
      Some(js_ref) => Ok(js_ref),
      None => Err(Error::from_reason("No resources available")),
    }
  }

  #[napi]
  pub async fn acquire_async(&self, timeout_ms: Option<u32>) -> Result<ObjectRef<false>> {
    let inner = self.inner.clone();

    let permit = inner
      .acquire_async(timeout_ms.map(|t| t as u64))
      .await
      .map_err(|e| match e {
        PoolError::Timeout => Error::from_reason(format!(
          "Failed to acquire resource within {:?}ms timeout",
          timeout_ms.unwrap_or(0)
        )),
        PoolError::Empty => Error::from_reason("Pool empty"),
        _ => Error::from_reason(e.to_string()),
      })?;

    Ok(permit)
  }

  #[napi]
  pub fn release(&self, _env: Env, resource: Object) -> Result<()> {
    let js_ref = resource.create_ref()?;
    self.inner.release(js_ref);
    Ok(())
  }

  #[napi]
  pub fn add(&self, _env: Env, resource: Object) -> Result<()> {
    let js_ref = resource.create_ref()?;
    self.inner.add(js_ref);
    Ok(())
  }

  #[napi]
  pub fn remove_one(&self, env: Env) -> Result<bool> {
    if let Some(item) = self.inner.remove_one() {
      item.unref(&env)?;
      Ok(true)
    } else {
      Ok(false)
    }
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
  pub fn destroy(&self, env: Env) -> Result<()> {
    for item in self.inner.drain() {
      item.unref(&env)?;
    }
    Ok(())
  }
}
