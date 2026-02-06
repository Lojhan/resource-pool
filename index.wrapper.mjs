import { DynamicObjectPool, EnginePool, StaticObjectPool } from './implementations/index.mjs'

/**
 * Wrapper facade that defaults to static implementation
 * @template T
 */
export class GenericObjectPool extends StaticObjectPool {
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

export { StaticObjectPool, DynamicObjectPool, EnginePool }
