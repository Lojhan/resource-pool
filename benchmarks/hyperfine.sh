#!/bin/bash
# Automatically finds all competitors and runs them with hyperfine

# Ensure we are in the project root
cd "$(dirname "$0")/.."

COMPETITORS_DIR="benchmarks/competitors"
COMMANDS=()

# Build the list of commands for hyperfine
for file in "$COMPETITORS_DIR"/*.js; do
  filename=$(basename -- "$file")
  name="${filename%.*}"
  COMMANDS+=("node benchmarks/run-single.js $name")
done

# Check if hyperfine is installed
if ! command -v hyperfine &> /dev/null; then
    echo "Error: hyperfine is not installed."
    echo "Install it via: brew install hyperfine (on macOS)"
    exit 1
fi

echo "Running benchmarks with hyperfine..."
echo "Iterations: 1,000,000"
echo "Pool Size:  10"
echo "-------------------------------------"

hyperfine --warmup 3 --export-markdown benchmarks/results.md "${COMMANDS[@]}"
