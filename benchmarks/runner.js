import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 1_000_000;
const POOL_SIZE = 10;

// Helper to resolve paths in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const competitorsDir = path.join(__dirname, 'competitors');

async function loadCompetitors() {
  const files = fs.readdirSync(competitorsDir).filter((f) => f.endsWith('.js'));
  const loaded = [];

  for (const file of files) {
    const modulePath = path.join(competitorsDir, file);
    const module = await import(modulePath);
    if (module.default && module.default.name && module.default.run) {
      loaded.push(module.default);
    }
  }
  return loaded;
}

async function runBenchmark(competitor) {
  console.log(`Preparing ${competitor.name}...`);

  // Setup
  const pool = await competitor.setup(POOL_SIZE);

  // Warmup (run 100 ops to JIT compile hot paths)
  try {
    await competitor.run(pool, 100);
  } catch (e) {
    console.error(`Warmup failed for ${competitor.name}:`, e);
  }

  // Measure
  process.stdout.write(`Running ${competitor.name} (${new Intl.NumberFormat().format(ITERATIONS)} ops)... `);
  const start = performance.now();

  await competitor.run(pool, ITERATIONS);

  const end = performance.now();
  const duration = end - start;
  const opsPerSec = Math.floor(ITERATIONS / (duration / 1000));

  console.log(`Done.`);

  // Teardown
  await competitor.teardown(pool);

  return {
    name: competitor.name,
    duration,
    opsPerSec,
  };
}

async function main() {
  console.log('=== Resource Pool Benchmark Runner ===\n');
  console.log(`Iterations: ${new Intl.NumberFormat().format(ITERATIONS)}`);
  console.log(`Pool Size:  ${POOL_SIZE}\n`);

  const competitors = await loadCompetitors();
  const results = [];

  for (const comp of competitors) {
    results.push(await runBenchmark(comp));
    console.log('');
  }

  // Sort by fastest
  results.sort((a, b) => b.opsPerSec - a.opsPerSec);

  console.table(
    results.map((r) => ({
      Name: r.name,
      'Duration (ms)': parseFloat(r.duration.toFixed(2)),
      'Ops/Sec': new Intl.NumberFormat().format(r.opsPerSec),
    })),
  );
}

main().catch(console.error);
