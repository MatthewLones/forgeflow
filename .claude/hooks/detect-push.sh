#!/bin/bash
# Intent Layer auto-update hook
# Triggers after any git push to identify CLAUDE.md nodes that may need updating.
# Returns a systemMessage instructing Claude to review and update affected nodes.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE '^git push'; then
  CHANGED=$(git diff --name-only HEAD~1 2>/dev/null | head -20)

  if [ -z "$CHANGED" ]; then
    exit 0
  fi

  AFFECTED=$(echo "$CHANGED" | while read f; do
    dir=$(dirname "$f")
    while [ "$dir" != "." ]; do
      if [ -f "$dir/CLAUDE.md" ]; then echo "$dir/CLAUDE.md"; break; fi
      dir=$(dirname "$dir")
    done
  done | sort -u)

  if [ -n "$AFFECTED" ]; then
    FILE_LIST=$(echo "$CHANGED" | head -10 | tr '\n' ', ')
    NODE_LIST=$(echo "$AFFECTED" | tr '\n' ', ')

    cat <<HOOK_EOF
{
  "continue": true,
  "systemMessage": "INTENT LAYER AUTO-UPDATE: A git push just completed. The following source files changed: ${FILE_LIST%, }. These CLAUDE.md intent nodes may need updating: ${NODE_LIST%, }. Please read the changed source files, determine if the corresponding CLAUDE.md nodes are still accurate, and update any that have become stale. Focus on: new exports, changed contracts, new anti-patterns, or shifted boundaries. Keep each node under 2K tokens."
}
HOOK_EOF
  fi
fi
exit 0
