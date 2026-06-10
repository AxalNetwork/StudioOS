# Contributing to Axal StudioOS

Welcome. This guide covers the dev-side rules for staying inside our storage
budgets and keeping the repo fast for everyone.

For product/architecture context, read `replit.md` first.

## TL;DR

| If you are adding... | Send it to... |
|---|---|
| A new feature, route, component, migration | regular git (no LFS) |
| Logo masters, Figma sources, design PSDs | **Git LFS** (`*.psd`, `*.fig`, `*.ai`, `*.xd`, `*.sketch`) |
| Office documents (legal templates, decks) | **Git LFS** (`*.docx`, `*.doc`, `*.pptx`, `*.ppt`, `*.xlsx`, `*.xls`) |
| ML weights, model checkpoints, data arrays | **Git LFS** (`*.onnx`, `*.safetensors`, `*.pt`, `*.pth`, `*.gguf`, `*.h5`, `*.hdf5`, `*.pkl`, `*.ckpt`, `*.npy`, `*.npz`, `*.pb`, `*.bin`) |
| Sample/fixture archives, audit snapshots | **Git LFS** (`*.zip`, `*.tar.gz`, `*.parquet`, `*.7z`, `*.rar`, `*.bz2`, `*.xz`) |
| Database snapshots / fixtures | **Git LFS** (`*.duckdb`, `*.sqlite`, `*.sqlite3`) |
| Source video / audio (marketing source, podcast masters) | **Git LFS** (`*.mp4`, `*.webm`, `*.mov`, `*.wav`, `*.flac`) |
| Web fonts | **Git LFS** (`*.woff2`) |
| A PDF or PNG > 500 KB | **Git LFS** (size-gated; `git lfs track "<glob>"` first) |
| User uploads, signed docs, KYC, deck exports, backups | **R2** (not git) |
| A public PDF (quarterly Signals report, sector report) | **GitHub Releases** (not git) |
| Favicons, OG fallback, tiny atomic assets | regular git, ships with the worker |

The full decision matrix lives in [`MIGRATION_LFS_AUDIT.md`](./MIGRATION_LFS_AUDIT.md).

## Setting up Git LFS

One-time, per machine:

```bash
# macOS
brew install git-lfs

# Debian/Ubuntu
sudo apt-get install git-lfs

git lfs install
```

Then clone or `cd` into the repo and you're good. LFS pulls pointers + the
binary content for whatever your working tree references; checkouts are
otherwise unchanged.

### Skip design files locally (recommended for backend devs)

If you only work on the worker / Python / docs and never need design
sources, exclude the heavy paths from LFS fetches:

```bash
git config --global lfs.fetchexclude "design/**,docs/raw/**,*.psd,*.psb,*.fig,*.sketch,*.ai,*.xd"
```

This makes `git clone` and `git pull` materially faster on a fresh
machine while still letting LFS-aware tools download on-demand.

### Re-include later

```bash
git config --global --unset lfs.fetchexclude
git lfs pull
```

## Adding a new binary file

1. **Check the decision matrix above.** If it's not source that engineers
   need on clone, it does not belong in git at all — push it to R2 or
   GitHub Releases.
2. If LFS is right, register the pattern (one-time per extension):
   ```bash
   git lfs track "*.psd"
   git add .gitattributes
   ```
3. Add and commit the file as normal:
   ```bash
   git add design/logo/axal-logo-master.psd
   git commit -m "design: add logo master PSD"
   ```
4. Push via `bash scripts/git-sync.sh` (Replit's blue Sync button also works
   for non-workflow commits — see `replit.md`'s Sync Cheatsheet).

## The size gate

`scripts/lfs-size-gate.mjs` is the gatekeeper.

- Run it ad-hoc: `node scripts/lfs-size-gate.mjs`
- Install it as your pre-commit hook: `node scripts/lfs-size-gate.mjs --install`

What it rejects:

1. Any new file whose extension is listed in `.gitattributes` for LFS
   tracking but which is NOT actually LFS-tracked in the staged state
   (`git check-attr filter <path>` would not return `lfs`).
2. Any **new** PDF or PNG larger than 500 KB that is not LFS-tracked.

What it does **not** do: rewrite history, touch existing in-tree blobs,
or block files that were committed before this hook landed. We don't
rewrite history — see the `replit.md` "Recovering from a Sync divergence"
note for why.

## Publishing public artifacts

Public artifacts (quarterly Investor Signals PDF, sector reports, public
DD summaries) go to **GitHub Releases**, not LFS:

1. Build the artifact locally.
2. Tag the release: `git tag v2026.Q2-signals && git push --tags`
3. Create the release in the GitHub UI or via `gh release create v2026.Q2-signals path/to/artifact.pdf --notes "…"`.
4. Link to the release asset from the marketing site / docs.

GitHub Releases have uncapped public bandwidth and don't consume our LFS
budget. R2 is the wrong tool for these because they're meant to be
linked publicly without `pre-signed-url` round trips; LFS is the wrong
tool because LFS bandwidth is reserved for engineers pulling source.

## LFS budget visibility

`.github/workflows/lfs-budget.yml` runs daily and pings Slack `#ops`
when projected monthly LFS bandwidth exceeds 80% of our 250 GB plan
limit. If you see that alert and you committed something large recently,
look at:

```bash
git lfs ls-files --size | sort -k4 -h | tail -20
```

…to see the heaviest LFS objects. Rotation strategy: move the biggest
non-source-of-truth objects to R2 (if runtime) or GitHub Releases (if
public point-in-time).

## What is NOT allowed

- **`git filter-repo` / BFG / any history rewrite.** Existing in-tree
  blobs stay where they are until normal turnover rotates them out.
  Rewriting history breaks every open PR, every fork, every cached
  clone, and every release tag, and is explicitly forbidden by the
  decision rule.
- **Adding R2 keys, KYC docs, signed contracts, or any user upload** to
  the repo, LFS or otherwise.
- **Committing build outputs** that don't already exist in the repo.
  `docs/assets/`, `dist-deploy/`, and `assets/` are grandfathered (GH
  Pages serves `docs/`); don't add new ones.

## Where to ask

- `#dev` on Slack for code questions.
- `#ops` on Slack for the budget alert.
- Open an issue with the `lfs` label for policy questions.
