import { test } from 'node:test';
import assert from 'node:assert';
import { createPool } from '../../src/index';

const createTestFactory = (id?: number) => {
  let counter = id ?? 0;
  return () => {
    return {
      id: counter++,
      created: Date.now(),
    };
  };
};

test('createPool - throws when max < min', async () => {
  const config = {
    min: 10,
    max: 5,
    resourceFactory: createTestFactory(),
  };

  assert.throws(
    () => {
      createPool(config);
    },
    (err: Error) => {
      return err.message.includes('max must be >= min');
    },
  );
});
