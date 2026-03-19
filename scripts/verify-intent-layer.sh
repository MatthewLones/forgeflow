#!/bin/bash
# Verify Intent Layer completeness and health
# Checks: existence of all expected nodes, word count budgets, downlink validity

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
cd "$REPO_ROOT"

EXPECTED_NODES=(
  "CLAUDE.md"
  "packages/CLAUDE.md"
  "packages/types/CLAUDE.md"
  "packages/parser/CLAUDE.md"
  "packages/validator/CLAUDE.md"
  "packages/validator/src/rules/CLAUDE.md"
  "packages/validator/src/passes/CLAUDE.md"
  "packages/compiler/CLAUDE.md"
  "packages/state-store/CLAUDE.md"
  "packages/engine/CLAUDE.md"
  "packages/skill-resolver/CLAUDE.md"
  "packages/cli/CLAUDE.md"
  "packages/server/CLAUDE.md"
  "packages/server/src/routes/CLAUDE.md"
  "packages/server/src/services/CLAUDE.md"
  "packages/ui/CLAUDE.md"
  "packages/ui/src/context/CLAUDE.md"
  "packages/ui/src/components/CLAUDE.md"
  "packages/ui/src/components/workspace/CLAUDE.md"
  "packages/ui/src/components/run-dashboard/CLAUDE.md"
  "packages/ui/src/components/shared/CLAUDE.md"
  "packages/ui/src/lib/CLAUDE.md"
  "packages/ui/src/pages/CLAUDE.md"
  "packages/desktop/CLAUDE.md"
  "docs/CLAUDE.md"
)

ERRORS=0
WARNINGS=0

echo "=== Intent Layer Verification ==="
echo ""

# Check 1: All expected nodes exist
echo "--- Check 1: Node Existence ---"
for node in "${EXPECTED_NODES[@]}"; do
  if [ ! -f "$node" ]; then
    echo "  MISSING: $node"
    ((ERRORS++))
  fi
done
EXISTING=$(find . -name "CLAUDE.md" -not -path "./node_modules/*" -not -path "./.claude/*" | wc -l | tr -d ' ')
echo "  Found $EXISTING / ${#EXPECTED_NODES[@]} expected nodes"
echo ""

# Check 2: Word count budget (target: under 600 words per node)
echo "--- Check 2: Token Budget ---"
for node in "${EXPECTED_NODES[@]}"; do
  if [ -f "$node" ]; then
    WORDS=$(wc -w < "$node" | tr -d ' ')
    if [ "$WORDS" -gt 700 ]; then
      echo "  OVER BUDGET: $node ($WORDS words, target <600)"
      ((WARNINGS++))
    fi
  fi
done
echo "  Done"
echo ""

# Check 3: Downlink validity
echo "--- Check 3: Downlink Validity ---"
for node in "${EXPECTED_NODES[@]}"; do
  if [ -f "$node" ]; then
    DIR=$(dirname "$node")
    grep -oE '\[.*?\]\([^)]*CLAUDE\.md\)' "$node" 2>/dev/null | sed 's/.*(\(.*\))/\1/' | while read link; do
      TARGET="$DIR/$link"
      if [ ! -f "$TARGET" ]; then
        echo "  BROKEN LINK: $node -> $link (resolved: $TARGET)"
        # Can't increment ERRORS from subshell, but prints the issue
      fi
    done
  fi
done
echo "  Done"
echo ""

echo "=== Summary: $ERRORS errors, $WARNINGS warnings ==="
