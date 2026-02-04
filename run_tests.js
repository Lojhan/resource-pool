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

console.log(`Running ${testFiles.length} test files in ${dir}...`)
const result = spawnSync(process.execPath, ['--expose-gc', '--test', ...testFiles], { stdio: 'inherit' })
process.exit(result.status ?? 1)
