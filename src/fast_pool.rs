use napi::bindgen_prelude::*;
use napi_derive::napi;

const MAGIC_VALUE: u32 = 0xBEEF_C0DE;

/// Fast resource pool with JavaScript-managed shared state.
/// 
/// This is a minimal Rust companion to the JavaScript FastResourcePool.
/// The actual resource management happens in JavaScript using SharedArrayBuffer.
#[napi]
pub struct FastPool {
    capacity: usize,
}

#[napi]
impl FastPool {
    /// Create a new FastPool with the specified capacity.
    #[napi(constructor)]
    pub fn new(capacity: u32) -> napi::Result<Self> {
        if capacity == 0 {
            return Err(Error::from_reason("Capacity must be greater than 0"));
        }
        
        if capacity > 65536 {
            return Err(Error::from_reason("Capacity too large (max 65536)"));
        }

        Ok(Self {
            capacity: capacity as usize,
        })
    }

    /// Get the capacity of the pool.
    #[napi]
    pub fn get_capacity(&self) -> u32 {
        self.capacity as u32
    }

    /// Get the magic value for validation.
    #[napi]
    pub fn get_magic_value(&self) -> u32 {
        MAGIC_VALUE
    }
}
