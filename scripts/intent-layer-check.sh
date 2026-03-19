#!/bin/bash
# Intent Layer maintenance script
# Maps changed files to their covering CLAUDE.md nodes.
# Usage: bash scripts/intent-layer-check.sh [commit-range]
# Default: HEAD~1..HEAD

RANGE=${1:-"HEAD~1..HEAD"}
echo "Changed files in $RANGE:"
echo ""
git diff --name-only "$RANGE" 2>/dev/null | while read f; do
  dir=$(dirname "$f")
  while [ "$dir" != "." ]; do
    if [ -f "$dir/CLAUDE.md" ]; then
      printf "  %-50s -> %s\n" "$f" "$dir/CLAUDE.md"
      break
    fi
    dir=$(dirname "$dir")
  done
done | sort -t'>' -k2 | uniq
