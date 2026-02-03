#![deny(clippy::all)]

use napi_derive::napi;
use napi::bindgen_prelude::*;
use napi::{JsObject, Ref};
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

#[napi]
pub struct GenericObjectPool {
  // Mutex protects the Vec, Semaphore protects the logic/concurrency
  pool: Arc<Mutex<Vec<Ref<()>>>>,
  semaphore: Arc<Semaphore>,
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
      pool: Arc::new(Mutex::new(refs)),
      semaphore: Arc::new(Semaphore::new(count)),
    })
  }

  #[napi(ts_return_type = "Promise<any>")]
  pub fn acquire(&self, env: Env) -> Result<JsObject> {
    // Try to acquire immediately, if not available return error
    match self.semaphore.try_acquire() {
      Ok(_permit) => {
        // We "forget" the permit because the JS side now "owns" the resource 
        // until they manually call release().
        _permit.forget(); 

        let mut pool = self.pool.lock().map_err(|_| Error::from_reason("Poisoned lock"))?;
        let js_ref = pool.pop().ok_or_else(|| Error::from_reason("Pool empty despite semaphore"))?;
        env.get_reference_value(&js_ref)
      }
      Err(_) => Err(Error::from_reason("No resources available"))
    }
  }

  #[napi]
  pub fn release(&self, env: Env, resource: JsObject) -> Result<()> {
    let js_ref = env.create_reference(resource)?;
    let mut pool = self.pool.lock().map_err(|_| Error::from_reason("Poisoned lock"))?;
    pool.push(js_ref);
    
    // Manually add a permit back since we "forgot" it during acquire
    self.semaphore.add_permits(1);
    Ok(())
  }

  #[napi]
  pub fn add(&self, env: Env, resource: JsObject) -> Result<()> {
    let js_ref = env.create_reference(resource)?;
    let mut pool = self.pool.lock().map_err(|_| Error::from_reason("Poisoned lock"))?;
    pool.push(js_ref);
    
    // Increasing pool capacity at runtime
    self.semaphore.add_permits(1);
    Ok(())
  }

  #[napi]
  pub fn remove_one(&self) -> Result<bool> {
    // Try to shrink the pool. try_acquire checks if a resource is currently "free"
    match self.semaphore.try_acquire() {
      Ok(permit) => {
        permit.forget(); // Permanently remove this permit's slot
        let mut pool = self.pool.lock().map_err(|_| Error::from_reason("Poisoned lock"))?;
        pool.pop();
        Ok(true)
      }
      Err(_) => Ok(false), // Everything is currently in use, cannot remove right now
    }
  }

  #[napi]
  pub fn available_count(&self) -> u32 {
    self.semaphore.available_permits() as u32
  }
}