---
name: Font LFS attribute quirk
description: Repository-specific Git LFS mismatch affecting the Space Grotesk font during pull and restore.
---

The Space Grotesk WOFF2 asset is stored in Git as a full binary blob, while the repository-wide `*.woff2` attributes mark it for Git LFS. A normal restore or stash can therefore rewrite the valid font as an LFS pointer and make Git report a false uncommitted change.

**Why:** The mismatch causes `git pull` to complain about local changes even when the working font is byte-identical to `HEAD`; standard LFS restore can also fail with “file should have been a pointer.”

**How to apply:** Before pulling, add `scripts/og-assets/SpaceGrotesk-Variable.woff2 -filter -diff -merge` to `.git/info/attributes` (local-only), verify `git status`, and use `git pull --ff-only origin main`.