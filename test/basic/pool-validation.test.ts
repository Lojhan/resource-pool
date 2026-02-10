import { test } from 'node:test';
import assert from 'node:assert';
import { createPool } from '../../src/index';

test('Validation - missing config throws', () => {
  assert.throws(
    () => {
      // @ts-expect-error - Testing runtime validation
      createPool(null);
    },
    (err: Error) => err.message === 'Pool configuration is required',
  );
});

test('Validation - missing resourceFactory throws', () => {
  assert.throws(
    () => {
      createPool({
        min: 1,
        max: 5,
        // @ts-expect-error - Testing runtime validation
        resourceFactory: undefined,
      });
    },
    (err: Error) => err.message === 'resourceFactory is required',
  );
});

test('Validation - static pool without initialResources throws', () => {
  assert.throws(
    () => {
      createPool({
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message === 'Static pool (no min/max) requires initialResources',
  );
});

test('Validation - min without max throws', () => {
  assert.throws(
    () => {
      createPool({
        min: 5,
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message === 'max is required when min is specified',
  );
});

test('Validation - max without min throws', () => {
  assert.throws(
    () => {
      createPool({
        max: 10,
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message === 'min is required when max is specified',
  );
});

test('Validation - negative min throws', () => {
  assert.throws(
    () => {
      createPool({
        min: -1,
        max: 5,
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message === 'min cannot be negative',
  );
});

test('Validation - max less than 1 throws', () => {
  assert.throws(
    () => {
      createPool({
        min: 0,
        max: 0,
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message === 'max must be at least 1',
  );
});

test('Validation - max exceeding INT32_MAX throws', () => {
  assert.throws(
    () => {
      createPool({
        min: 1,
        max: 2147483648, // INT32_MAX + 1
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message.includes('max cannot exceed'),
  );
});

test('Validation - max less than min throws', () => {
  assert.throws(
    () => {
      createPool({
        min: 10,
        max: 5,
        resourceFactory: () => ({ id: 1 }),
      });
    },
    (err: Error) => err.message === 'max must be >= min',
  );
});

test('Validation - static pool with wrong number of initialResources throws', () => {
  const resources = [{ id: 1 }, { id: 2 }];

  assert.throws(
    () => {
      createPool(
        {
          min: 3,
          max: 3,
          resourceFactory: () => ({ id: 1 }),
        },
        resources,
      );
    },
    (err: Error) => err.message.includes('Static pool (min === max === 3) requires exactly 3 initialResources, got 2'),
  );
});

test('Validation - initialResources exceeding max throws', () => {
  const resources = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

  assert.throws(
    () => {
      createPool(
        {
          min: 1,
          max: 3,
          resourceFactory: () => ({ id: 1 }),
        },
        resources,
      );
    },
    (err: Error) => err.message.includes('initialResources length (5) cannot exceed max (3)'),
  );
});

test('Validation - static pool with correct initialResources succeeds', async () => {
  const resources = [{ id: 1 }, { id: 2 }, { id: 3 }];

  const pool = createPool(
    {
      min: 3,
      max: 3,
      resourceFactory: () => ({ id: 99 }),
    },
    resources,
  );

  const metrics = pool.getMetrics();
  assert.equal(metrics.size, 3);
  assert.equal(metrics.available, 3);

  await pool.destroy();
});

test('Validation - dynamic pool with min=0 succeeds', async () => {
  const pool = createPool({
    min: 0,
    max: 5,
    resourceFactory: () => ({ id: 1 }),
  });

  const metrics = pool.getMetrics();
  assert.equal(metrics.size, 0);
  assert.equal(metrics.capacity, 5);

  await pool.destroy();
});

test('Validation - static pool from initialResources only succeeds', async () => {
  const resources = [{ id: 1 }, { id: 2 }];

  const pool = createPool(
    {
      resourceFactory: () => ({ id: 99 }),
    },
    resources,
  );

  const metrics = pool.getMetrics();
  assert.equal(metrics.size, 2);
  assert.equal(metrics.capacity, 2);
  assert.equal(metrics.available, 2);

  await pool.destroy();
});
