const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node run_tests.js <directory>')
  process.exit(1)
}

function findTests(currentDir, list) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      findTests(fullPath, list)
    } else if (entry.isFile() && (entry.name.endsWith('.test.cjs') || entry.name.endsWith('.test.mjs'))) {
      list.push(fullPath)
    }
  }
  return list
}

const testFiles = []
if (fs.existsSync(dir)) {
  findTests(dir, testFiles)
} else {
  console.error(`Directory not found: ${dir}`)
  process.exit(1)
}

if (testFiles.length === 0) {
  console.log(`No test files found in ${dir}`)
  process.exit(0)
}

const memoryLeakTests = testFiles.filter((f) => f.includes('memory_leak_check'))
const regularTests = testFiles.filter((f) => !f.includes('memory_leak_check'))

if (regularTests.length > 0) {
  console.log(`Running ${regularTests.length} regular test files in ${dir}...`)
  const result = spawnSync(process.execPath, ['--expose-gc', '--test', ...regularTests], { stdio: 'inherit' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (memoryLeakTests.length > 0) {
  console.log(`Running ${memoryLeakTests.length} memory leak test files in ${dir} (sequentially)...`)
  const result = spawnSync(process.execPath, ['--expose-gc', '--test', '--test-concurrency=1', ...memoryLeakTests], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

process.exit(0)
