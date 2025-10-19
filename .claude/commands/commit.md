---
description: Create a git commit with clear, terse commit message
---

Use the commit agent to create a git commit.

The commit agent will:
1. Check git status and diff to analyze changes
2. Ask about any new files to ensure test/temp files aren't added accidentally
3. Add all changes (or only staged files if you specify "staged only")
4. Generate a clear commit message with terse bullet points
5. Create the commit and verify success

**Usage:**
- `/commit` - Commit all changes
- `/commit staged only` - Commit only staged files
