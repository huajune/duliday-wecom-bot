#!/bin/bash

# Check number of modified files and remind user to commit

# Get count of all modified files (both staged and unstaged)
modified_count=$(git status --short | wc -l | tr -d ' ')

if [ "$modified_count" -gt 10 ]; then
  echo ""
  echo "⚠️  WARNING: ${modified_count} file(s) have been modified"
  echo "Consider committing your changes to avoid losing work!"
  echo ""
  echo "To commit, run:"
  echo "  git add -A"
  echo "  git commit -m \"<commit message>\""
  echo ""
fi
