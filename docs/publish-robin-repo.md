# Publishing Robin as a fresh GitHub repository

Use this when you want the **Robin** codebase on GitHub **without** carrying over commit history from this private repository.

**Do not run this automatically from CI or an agent.** Run these steps manually when you are ready to publish.

## What this does

- Exports the **current committed tree** only (`git archive`). No `.git` directory, so the new repo has no MyTwitter history.
- Creates a **new** git history with a single initial commit.
- Pushes to an **empty** remote at `https://github.com/billylo1/Robin.git`.

Untracked files stay behind. That includes `.env`, `serviceAccount.json`, `android/local.properties`, `android/keystore.properties`, `ios/Config.xcconfig`, `fastlane/.env`, and `ios/build/`.

The original repository and its full git history remain here. This process does not delete or rewrite that history.

## Prerequisites

1. Commit the open-source cleanup on this private repo first. `git archive` reads `HEAD`, not uncommitted edits.
2. Create an **empty** GitHub repository named `Robin` under `billylo1` (no README, no `.gitignore`, no license — empty repo).
3. Confirm `git status` shows no secrets staged. `git check-ignore` should match `.env`, `serviceAccount.json`, `android/local.properties`, `android/keystore.properties`, `ios/Config.xcconfig`, and `fastlane/.env`.

## Steps

From this repo, after the cleanup commit is on `HEAD`:

```bash
rm -rf /tmp/Robin-publish
mkdir -p /tmp/Robin-publish
git archive --format=tar HEAD | tar -x -C /tmp/Robin-publish

cd /tmp/Robin-publish
git init
git add -A
git commit -m "Initial commit: Robin (open-source X following WebView client)"

git branch -M main
git remote add origin https://github.com/billylo1/Robin.git
git push -u origin main
```

Before `git add -A`, run `git status` in `/tmp/Robin-publish` and confirm the list is only source, docs, and store metadata.

After push, set the GitHub repo description, topics, and visibility (public) in the GitHub UI.

## Verify

- `git log` on the new repo is a single commit.
- `git rev-list --count HEAD` is `1`.
- Clone `https://github.com/billylo1/Robin.git` in a fresh directory and follow [docs/mobile.md](mobile.md).
- Confirm bundle IDs / package names are `org.evergreenlabs.robin` and the product name is **Robin**.
