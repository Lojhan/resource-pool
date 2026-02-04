import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ITERATIONS = 1_000_000
const POOL_SIZE = 10

// Helper to resolve paths in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const competitorsDir = path.join(__dirname, 'competitors')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node run-single.js <competitor-name>')
  process.exit(1)
}

async function run() {
  const modulePath = path.join(competitorsDir, `${target}.js`)

  try {
    const module = await import(modulePath)
    const competitor = module.default

    const pool = await competitor.setup(POOL_SIZE)

    // Warmup
    try {
      await competitor.run(pool, 100)
    } catch {}

    // Run
    await competitor.run(pool, ITERATIONS)

    await competitor.teardown(pool)
  } catch (err) {
    // If module not found or other errors
    console.error(`Failed to run competitor '${target}':`, err)
    process.exit(1)
  }
}

run()
