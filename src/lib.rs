#![deny(clippy::all)]

mod pool;

use crate::pool::{CorePool, PoolError};
use napi::bindgen_prelude::*;
use napi::{JsObject, Ref};
use napi_derive::napi;

#[napi]
pub struct GenericObjectPool {
  inner: CorePool<Ref<()>>,
}

#[napi]
impl GenericObjectPool {
  #[napi(constructor)]
  pub fn new(env: Env, initial_values: Vec<JsObject>) -> Result<Self> {
    let count = initial_values.len();
    let mut refs = Vec::with_capacity(count);
    for val in initial_values {
      refs.push(env.create_reference(val)?);
    }
    Ok(GenericObjectPool {
      inner: CorePool::new(refs),
    })
  }

  #[napi(ts_return_type = "Promise<any>")]
  pub fn acquire(&self, env: Env) -> Result<JsObject> {
    // Try to acquire immediately
    match self.inner.try_acquire() {
      Some(js_ref) => env.get_reference_value(&js_ref),
      None => Err(Error::from_reason("No resources available")),
    }
  }

  #[napi(ts_return_type = "Promise<any>")]
  pub fn acquire_async(&self, env: Env, timeout_ms: Option<u32>) -> Result<JsObject> {
    let inner = self.inner.clone();

    let future = async move {
      inner
        .acquire_async(timeout_ms.map(|t| t as u64))
        .await
        .map_err(|e| match e {
          PoolError::Timeout => Error::from_reason(format!(
            "Failed to acquire resource within {:?}ms timeout",
            timeout_ms.unwrap_or(0)
          )),
          PoolError::Empty => Error::from_reason("Pool empty"),
          _ => Error::from_reason(e.to_string()),
        })
    };

    env.execute_tokio_future(future, |&mut env, js_ref: Ref<()>| {
      env.get_reference_value::<JsObject>(&js_ref)
    })
  }

  #[napi]
  pub fn release(&self, env: Env, resource: JsObject) -> Result<()> {
    let js_ref = env.create_reference(resource)?;
    self.inner.release(js_ref);
    Ok(())
  }

  #[napi]
  pub fn add(&self, env: Env, resource: JsObject) -> Result<()> {
    let js_ref = env.create_reference(resource)?;
    self.inner.add(js_ref);
    Ok(())
  }

  #[napi]
  pub fn remove_one(&self) -> Result<bool> {
    Ok(self.inner.remove_one())
  }

  #[napi]
  pub fn available_count(&self) -> u32 {
    self.inner.available_count() as u32
  }
}
