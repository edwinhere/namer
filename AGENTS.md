# Agent Publishing Guide

This document explains how to publish changes to both GitHub and HuggingFace repositories.

## Repository Structure

This project is mirrored on two platforms:

| Platform | Remote Name | URL | Purpose |
|----------|-------------|-----|---------|
| **GitHub** | `origin` | `git@github.com:edwinhere/namer.git` | Source code, issues, development |
| **HuggingFace** | `hf` | `https://huggingface.co/edwinhere/namer` | Model distribution, inference API |

## Initial Setup

```bash
# Clone from GitHub (primary development repo)
git clone git@github.com:edwinhere/namer.git
cd namer

# Add HuggingFace as a second remote
git remote add hf https://huggingface.co/edwinhere/namer

# Verify remotes
git remote -v
```

## File Storage Configuration

Different files use different storage backends:

| File | GitHub | HuggingFace |
|------|--------|-------------|
| `*.py`, `*.md`, `*.json` | Git | Git |
| `namer_model.pt` | Git LFS | Git LFS |
| `model.safetensors` | Git LFS | Xet (via LFS pointer) |

### Git Attributes (`.gitattributes`)

```gitattributes
# For GitHub: namer_model.pt uses git-lfs
*.pt filter=lfs diff=lfs merge=lfs -text

# For HuggingFace: model.safetensors uses Xet for faster downloads
model.safetensors filter=lfs diff=lfs merge=lfs -text
```

## Publishing Workflow

### 1. Make Changes

Edit files normally, then commit:

```bash
git add <files>
git commit -m "Description of changes"
```

### 2. Push to GitHub (Origin)

```bash
git push origin main
```

This uploads:
- All code files to GitHub
- LFS objects (`namer_model.pt`, `model.safetensors`)

### 3. Push to HuggingFace

```bash
GIT_LFS_SKIP_SMUDGE=1 git push hf main
```

**Why `GIT_LFS_SKIP_SMUDGE=1`?**

- HuggingFace uses **Xet** storage for `model.safetensors` (faster than LFS)
- Without this flag, git tries to download LFS objects from HF that may not exist
- The flag skips the smudge filter, pushing only the LFS pointer file
- HF's Xet backend then serves the actual file content

### 4. Upload Safetensors to HuggingFace (if updated)

If `model.safetensors` changed, use the HF CLI for Xet upload:

```bash
# Upload via HF CLI (uses Xet for fast transfers)
hf upload edwinhere/namer model.safetensors model.safetensors \
    --commit-message "Update model weights vX.Y"
```

## Complete Publishing Example

```bash
# 1. Make changes to code
cd /big/home/edwin/dev/namer
vim namer/data.py

# 2. Commit
git add namer/data.py
git commit -m "Fix edge case handling for numbers with many zeros"

# 3. Push code to both platforms
git push origin main
GIT_LFS_SKIP_SMUDGE=1 git push hf main

# 4. If model weights changed, upload safetensors
hf upload edwinhere/namer model.safetensors model.safetensors \
    --commit-message "Update model weights with improved training"
```

## One-Line Push to Both

For convenience, push to both in one command:

```bash
git push origin main && GIT_LFS_SKIP_SMUDGE=1 git push hf main
```

Or with explicit checks:

```bash
# Push to GitHub
git push origin main

# Push to HuggingFace (skip LFS smudge to avoid download issues)
GIT_LFS_SKIP_SMUDGE=1 git push hf main
```

## Troubleshooting

### Diverged Branches

If `hf` and `origin` have diverged:

```bash
# Pull from HuggingFace first (skipping LFS downloads)
GIT_LFS_SKIP_SMUDGE=1 git pull hf main --rebase

# Then push back
git push origin main
GIT_LFS_SKIP_SMUDGE=1 git push hf main
```

### LFS Object Not Found

If you see "Object does not exist on the server":

```bash
# Skip smudge filter to avoid downloading missing objects
GIT_LFS_SKIP_SMUDGE=1 git pull hf main
```

### Force Push (Use with Caution)

If history was rewritten and you need to force sync:

```bash
# Force push to GitHub
git push origin main --force-with-lease

# Force push to HuggingFace
GIT_LFS_SKIP_SMUDGE=1 git push hf main --force-with-lease
```

## Verification

After publishing, verify on both platforms:

```bash
# Check GitHub latest commit
git log origin/main --oneline -3

# Check HuggingFace latest commit
git log hf/main --oneline -3

# Both should show the same commits
```

## Model Files Reference

| File | Size | Purpose | Platform |
|------|------|---------|----------|
| `namer_model.pt` | 3.6 MB | PyTorch checkpoint (training/inference) | GitHub (LFS) |
| `model.safetensors` | 3.5 MB | Safetensors format (HF compatible) | HuggingFace (Xet) |

## Commands Cheat Sheet

```bash
# View remotes
git remote -v

# View LFS tracked files
git lfs ls-files

# View LFS files with sizes
git lfs ls-files --size

# Check status on both platforms
git fetch origin && git fetch hf
git log --oneline --graph --decorate --all -5

# Push to both
git push origin main && GIT_LFS_SKIP_SMUDGE=1 git push hf main
```

## Badges (Cross-Platform Links)

The README maintains badges linking both platforms:

```markdown
[![HuggingFace](https://img.shields.io/badge/🤗_HuggingFace-Model_Card-yellow)](https://huggingface.co/edwinhere/namer)
[![GitHub](https://img.shields.io/badge/🐙_GitHub-Source_Code-blue)](https://github.com/edwinhere/namer)
```

These should always point to each other regardless of which platform the user is viewing from.
