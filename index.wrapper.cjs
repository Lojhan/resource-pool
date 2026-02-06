const { DynamicObjectPool, EnginePool, StaticObjectPool } = require('./implementations/index.cjs')

/**
 * Wrapper facade that defaults to static implementation
 * @template T
 */
class GenericObjectPool extends StaticObjectPool {
  static withDynamicSizing(config) {
    return DynamicObjectPool.withDynamicSizing(config)
  }

  static dynamic(config) {
    return DynamicObjectPool.withDynamicSizing(config)
  }

  static static(resources) {
    return new StaticObjectPool(resources)
  }

  static engine(size) {
    return new EnginePool(size)
  }
}

module.exports = { GenericObjectPool, StaticObjectPool, DynamicObjectPool, EnginePool }
