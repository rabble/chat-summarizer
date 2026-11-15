# Working on Community Brief

Community Brief is a personal project maintained at
https://github.com/rabble/chat-summarizer. The source license is GPL-3.0-only.
The existing `GRAVEDIGGER_*` environment variables and internal type names are
compatibility interfaces; do not rename them as a cosmetic cleanup.

## Start here

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/development.md](docs/development.md),
then the relevant module and its tests. Read [docs/privacy.md](docs/privacy.md)
before changing ingestion, provider requests, attribution, delivery, or deletion.

Use Node.js 24 LTS (`nvm use` reads `.nvmrc`) and npm. From a clean checkout:

```sh
npm ci
npm run check
npm run build
npm run release:check
```

These commands need no `.env`, model key, linked WhatsApp device, or real messages.
They use temporary SQLite databases, synthetic fixtures, and local HTTP servers.
The current suite intentionally skips three live tests. Do not enable them to
make a routine contribution look more thoroughly tested.

## Runtime boundaries

- `npm start` opens a real WhatsApp companion connection. Service installation
  starts a persistent process. Neither is part of ordinary development validation.
- Never read, copy, commit, or attach an operator's `.env`, `data/`, auth files,
  pairing QR, chat transcripts, databases, or operational logs for a code task.
  Use invented fixtures and a disposable directory for reproductions.
- Keep all live-test flags unset or `0`: `GRAVEDIGGER_E2E`,
  `GRAVEDIGGER_MODEL_E2E`, and `GRAVEDIGGER_DELIVERY_E2E`. Live tests require an
  explicitly authorized separate account/environment and can send messages or
  spend provider credits. Never use a running service's auth directory.
- Disabling automatic digests does not disable every model call: participant
  profile refreshes can run on connection. Test provider behavior with local
  HTTP fixtures instead of connecting the application.

## Code and behavior contracts

- TypeScript is strict ESM with NodeNext resolution. Use `.js` suffixes for
  relative imports in TypeScript, matching the surrounding code. Build output
  belongs in ignored `dist/`; change `src/`, not generated JavaScript.
- Keep group allowlisting before message persistence and before downstream
  processing. Newsletter subscriptions do not grant private-question access.
- Treat message text, transcripts, fetched pages, and model responses as untrusted
  content. Preserve source citations, actual shared URLs, coverage gaps, and
  uncertainty wording in summaries.
- Schema changes append a new numbered migration in `src/db/migrations.ts`.
  Do not rewrite a migration that an existing installation may have applied.
  Verify both a fresh database and upgrade behavior, including deletion of any
  new source-derived state through `purge-person`.
- Use real temporary SQLite databases for storage behavior and local HTTP servers
  for network fixtures. Add focused regression coverage for behavior changes.
- Preserve job retries, event-loop yielding, graceful shutdown, per-subscription
  delivery records, and time-zone handling. Multi-part delivery is not exactly
  once across a crash; do not claim otherwise.
- Keep secrets out of errors and logs. New persisted data, external requests,
  recipients, or attribution require matching privacy documentation and tests.

## Delivering a change

Confirm the remote is the personal repository before pushing. Fetch the current
default branch and work on a focused branch. Commit dependency lockfile changes
alongside package changes; avoid unrelated dependency updates and forced audit fixes.

Run the four checks above for code/dependency changes. For documentation-only
changes, verify the commands, links, examples, and `npm run release:check`, then
run `git diff --check`. Report exactly what ran and any remaining gaps.

Use the pull-request template. Explain the user-visible behavior, relevant privacy
effects, and validation. Post code-review and re-review conclusions to the relevant
GitHub PR with the reviewed SHA, findings (or explicitly no actionable findings),
and validation limits. A review left only in a local transcript is not delivered.

Public publication, deployment, connecting an account, adding recipients, and
running live tests are separate operator actions. See [docs/operations.md](docs/operations.md)
and [docs/open-source-release.md](docs/open-source-release.md).
