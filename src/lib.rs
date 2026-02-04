#![deny(clippy::all)]

mod pool;

use crate::pool::{CorePool, PoolError};
use napi::bindgen_prelude::*;
use napi::sys;
use napi_derive::napi;
use parking_lot::Mutex;
use std::sync::Arc;

struct WrappedRef(sys::napi_ref);

unsafe impl Send for WrappedRef {}
unsafe impl Sync for WrappedRef {}

#[napi]
pub struct GenericObjectPool {
  resources: Arc<Mutex<Vec<Option<WrappedRef>>>>,
  inner: CorePool<usize>,
}

#[napi]
impl GenericObjectPool {
  #[napi(constructor)]
  pub fn new(env: Env, initial_values: Vec<Object>) -> Result<Self> {
    let count = initial_values.len();
    let mut refs = Vec::with_capacity(count);
    let mut indices = Vec::with_capacity(count);

    for (i, val) in initial_values.into_iter().enumerate() {
      let mut ref_ptr = std::ptr::null_mut();
      unsafe {
        let status = sys::napi_create_reference(env.raw(), val.raw(), 1, &mut ref_ptr);
        if status != sys::Status::napi_ok {
          return Err(Error::from_status(status.into()));
        }
      }
      refs.push(Some(WrappedRef(ref_ptr)));
      indices.push(i);
    }

    Ok(GenericObjectPool {
      resources: Arc::new(Mutex::new(refs)),
      inner: CorePool::new(indices),
    })
  }

  #[napi]
  pub fn acquire(&self, env: Env) -> Result<Object<'_>> {
    match self.inner.try_acquire() {
      Some(idx) => {
        let resources = self.resources.lock();
        if let Some(Some(r)) = resources.get(idx) {
          unsafe {
            let mut result = std::ptr::null_mut();
            let status = sys::napi_get_reference_value(env.raw(), r.0, &mut result);
            if status != sys::Status::napi_ok {
              return Err(Error::from_status(status.into()));
            }
            Ok(Object::from_raw(env.raw(), result))
          }
        } else {
          Err(Error::from_reason("Resource invalid or removed"))
        }
      }
      None => Err(Error::from_reason("No resources available")),
    }
  }

  #[napi]
  pub async fn acquire_idx_async(&self, timeout_ms: Option<u32>) -> Result<u32> {
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

    Ok(permit as u32)
  }

  #[napi]
  pub fn get_resource(&'_ self, env: Env, idx: u32) -> Result<Object<'_>> {
    let resources = self.resources.lock();
    if let Some(Some(r)) = resources.get(idx as usize) {
      unsafe {
        let mut result = std::ptr::null_mut();
        let status = sys::napi_get_reference_value(env.raw(), r.0, &mut result);
        if status != sys::Status::napi_ok {
          return Err(Error::from_status(status.into()));
        }
        Ok(Object::from_raw(env.raw(), result))
      }
    } else {
      Err(Error::from_reason("Resource invalid or removed"))
    }
  }

  #[napi]
  pub fn release(&self, env: Env, resource: Object) -> Result<()> {
    let resources = self.resources.lock();
    let mut found_idx = None;

    let resource_raw = resource.raw();

    for (i, opt_ref) in resources.iter().enumerate() {
      if let Some(r) = opt_ref {
        unsafe {
          let mut val_ptr: sys::napi_value = std::ptr::null_mut();
          let status = sys::napi_get_reference_value(env.raw(), r.0, &mut val_ptr);
          if status == sys::Status::napi_ok {
            let mut result = false;
            sys::napi_strict_equals(env.raw(), val_ptr, resource_raw, &mut result);
            if result {
              found_idx = Some(i);
              break;
            }
          }
        }
      }
    }

    if let Some(idx) = found_idx {
      self.inner.release(idx);
      Ok(())
    } else {
      Err(Error::from_reason("Resource not belonging to pool"))
    }
  }

  #[napi]
  pub fn add(&self, env: Env, resource: Object) -> Result<()> {
    let mut resources = self.resources.lock();
    let mut ref_ptr = std::ptr::null_mut();
    unsafe {
      let status = sys::napi_create_reference(env.raw(), resource.raw(), 1, &mut ref_ptr);
      if status != sys::Status::napi_ok {
        return Err(Error::from_status(status.into()));
      }
    }
    resources.push(Some(WrappedRef(ref_ptr)));
    let new_idx = resources.len() - 1;
    self.inner.add(new_idx);
    Ok(())
  }

  #[napi]
  pub fn remove_one(&self, env: Env) -> Result<bool> {
    if let Some(idx) = self.inner.remove_one() {
      let mut resources = self.resources.lock();
      if idx < resources.len() {
        if let Some(r) = resources[idx].take() {
          unsafe {
            sys::napi_delete_reference(env.raw(), r.0);
          }
        }
      }
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
    let mut resources = self.resources.lock();
    for idx in self.inner.drain() {
      if idx < resources.len() {
        if let Some(r) = resources[idx].take() {
          unsafe {
            sys::napi_delete_reference(env.raw(), r.0);
          }
        }
      }
    }
    Ok(())
  }
}
