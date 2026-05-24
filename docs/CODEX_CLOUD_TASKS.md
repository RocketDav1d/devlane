# Codex Cloud Task Queue

This document is a handoff for running follow-up Devlane work in Codex web/cloud while the local Mac is offline.

Repository:

```text
RocketDav1d/devlane
```

Current base branch:

```text
main
```

Current active branch:

```text
codex/package-fresh-clone
```

Before starting new cloud tasks, merge or base work on the packaging branch if it is still open.

## Task 1: Package Install From GitHub

Goal:

Verify a user can install Devlane from the GitHub repo into a separate disposable consumer repo and run `devlane install-codex` without source-checkout paths leaking into generated Codex config.

Suggested prompt:

```text
In RocketDav1d/devlane, verify and harden installation from the GitHub repo as a package. Create a disposable temp consumer repo, install Devlane from the current branch using npm, run `devlane --help`, run `devlane install-codex --project <consumer>`, and assert generated Codex config calls `devlane` rather than a source checkout path. Add automated coverage if missing. Run npm run verify.
```

Expected output:

- A test or documented smoke path proving GitHub/package install behavior.
- No real Docker or Smolmachines VMs.
- `npm run verify` passes.

## Task 2: CI Verification

Goal:

Make GitHub Actions run the same verification cloud agents rely on.

Suggested prompt:

```text
In RocketDav1d/devlane, add GitHub Actions CI for Node 22. It should run npm ci and npm run verify. Ensure Postgres binaries are available on the runner or make the workflow clearly document skipped Postgres tests. Keep the workflow minimal and deterministic. Run the same commands locally if possible.
```

Expected output:

- `.github/workflows/ci.yml`
- CI installs dependencies from `package-lock.json`.
- CI runs `npm run verify`.

## Task 3: Smolmachines Cleanup Design

Goal:

Move from report-only orphan Smolmachines detection toward explicit safe cleanup, without deleting real VMs in tests.

Suggested prompt:

```text
In RocketDav1d/devlane, design and implement the next safe step for Smolmachines orphan cleanup. Keep dry-run/report-only as the default. Add an explicit flag or command for deletion, require positive Devlane machine identification, and test using fake machine lists or fake runtime drivers only. Do not start, stop, or delete real VMs. Run npm run verify.
```

Expected output:

- Clear CLI semantics for report vs destructive cleanup.
- Tests that prove no destructive behavior happens by default.
- `npm run verify` passes.

## Task 4: Host-Independent Postgres Direction

Goal:

Reduce dependency on host-installed Postgres binaries for the realistic Codex demo.

Suggested prompt:

```text
In RocketDav1d/devlane, propose and implement the smallest host-independent Postgres path for Devlane's Codex demo. Compare using the Smolmachines runtime image versus process runtime host binaries. Keep the existing host-binary tests unless replacing them is clearly safer. Do not introduce Docker. Add docs and tests for the chosen direction. Run npm run verify.
```

Expected output:

- A concrete implementation or a focused design doc if implementation is too broad.
- No Docker dependency.
- Clear next step for Codex worktree demos.

## Task 5: Codex Web User Guide

Goal:

Write the short user-facing path for testing Devlane from Codex web/cloud and Codex desktop.

Suggested prompt:

```text
In RocketDav1d/devlane, add concise docs for how a user tests Devlane in Codex desktop and Codex web/cloud. Explain what runs locally, what runs in Codex cloud, how to configure environments, what files Codex should see, and what limitations remain. Keep it practical and avoid product marketing. Run npm run verify.
```

Expected output:

- A doc under `docs/` or an updated README section.
- Clear split between local Desktop worktrees and cloud Codex tasks.
- `npm run verify` passes.
