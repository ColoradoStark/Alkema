#!/bin/bash
# Pre-commit hook: remind Claude to update public/README.md when key files change
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -q "git commit"; then
  # Check if any feature-relevant files are staged
  STAGED=$(git diff --cached --name-only 2>/dev/null)
  if echo "$STAGED" | grep -qE '(main_v2\.py|sprite_generator\.py|Alkema-Client/)'; then
    # Check if public/README.md is also staged
    if ! echo "$STAGED" | grep -q 'public/README.md'; then
      echo "NOTE: Feature files changed but public/README.md was not updated. If you added, removed, or changed any features, endpoints, races, classes, or item counts, update public/README.md before committing." >&2
    fi
  fi
fi
exit 0
