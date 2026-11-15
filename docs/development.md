# Developer guide

This guide is for changing Community Brief using invented data. For operating a
real account, use [README.md](../README.md), [privacy.md](privacy.md), and
[operations.md](operations.md). Coding agents should also read [AGENTS.md](../AGENTS.md).

## First working checkout

You need Git, Node.js 24 LTS, and npm. `.nvmrc` selects Node 24 when using nvm.
The Node requirement in `package.json` applies even when development type packages
have a newer major version. CI runs the offline suite on Linux and macOS under Node 24.

```sh
git clone https://github.com/rabble/chat-summarizer.git
cd chat-summarizer
nvm use
npm ci
npm run check
npm run build
npm run release:check
node dist/cli.js --help
```

If you use another Node manager, select Node 24 instead of running `nvm use`.
Check `node --version` before installing dependencies. The SQLite driver includes
a native addon; a platform without a suitable prebuilt binary may need a C/C++
compiler, make, and Python. On macOS these usually include Xcode Command Line Tools.

Do not create `.env` for this workflow. Do not run `npm start` to verify a build:
it connects a real WhatsApp account. Passing `--help` only prints CLI usage.

The checks have separate purposes:

| Command | What it verifies |
| --- | --- |
| `npm ci` | Installs the committed dependency graph without updating the lockfile. |
| `npm run check` | Strict TypeScript checking and the complete default test suite. |
| `npm run build` | Compiles `src/` into runnable ESM in `dist/`. |
| `npm run release:check` | Checks source files for prohibited private artifacts and required release files. |
| `git diff --check` | Detects whitespace errors in the proposed change. |

The source check is a limited pattern and file-boundary check, not a full secret or
privacy audit. Release preparation separately scans the export and reachable history.

## Find the right code

| Responsibility | Implementation | Starting tests |
| --- | --- | --- |
| CLI and validated settings | `src/cli.ts`, `src/config.ts` | `test/cli/`, `test/config.test.ts` |
| WhatsApp lifecycle, auth, normalization, history | `src/whatsapp/` | `test/whatsapp/` |
| Source groups and summaries-group validation | `src/groups/` | `test/groups/` |
| SQLite schema, transactions, migrations | `src/db/`, `src/messages/` | `test/db/`, `test/messages/` |
| Persistent work and retries | `src/jobs/` | `test/jobs/` |
| Discussion threads and shared URLs | `src/threads/`, `src/links/` | `test/threads/`, `test/links/` |
| Questions, evidence, citations, provider transport | `src/agent/`, `src/models/` | `test/agent/` |
| Edition prompts, schedules, and message chunks | `src/digests/` | `test/digests/` |
| Participant profiles and provenance | `src/profiles/`, `src/people/` | `test/profiles/`, `test/privacy/` |
| Coverage gaps and health reports | `src/gaps/`, `src/health/` | `test/gaps/`, `test/cli/` |
| Sender deletion and dependency log redaction | `src/privacy/` | `test/privacy/` |
| Portable LaunchAgent configuration | `ops/` | `test/ops/` |
| Public source boundaries and exports | `scripts/` | `test/privacy/public-source.test.ts` |

Read [architecture.md](architecture.md) for the end-to-end flow. The job worker
currently dispatches `segment_window`, `fetch_link`, and `build_digest`. New job
types need payload validation, a dispatcher path, retry behavior, and tests.

The shared model client in `src/models/openrouter.ts` handles both OpenRouter and
Lunaroute. Existing internal field names are retained for compatibility; the key
prefix selects transport. Do not assume all providers accept the same request
options, authentication headers, or retention controls.

## Make and test a focused change

Fetch the latest default branch and start a branch for your change. Keep a behavior
fix separate from unrelated refactoring. Follow the existing two-space TypeScript
style and `.editorconfig`; there is no separate lint or formatter command configured.

Run a focused test while iterating:

```sh
npm test -- test/digests/digest-scheduler.test.ts
npm test -- test/agent/question.test.ts
```

Use `test/support/temp-database.ts` for disposable databases and cleanup helpers.
Use messages you invented under `test/fixtures/whatsapp/` when testing normalization.
Local HTTP fixtures let tests exercise provider responses and fetched links without
making paid model requests or accessing community websites.

For a schema change, append a migration with a new version number, then test a
fresh database, an existing database upgrading, and reopening after migration.
Consider FTS triggers, foreign keys, provenance, and `purge-person` together with
any new table or cache. A source deletion must not leave newly introduced derived
state referencing that source.

Before submitting code or dependency changes, run the full setup checks above and
inspect the diff. `npm audit` is an additional dependency check; do not use a forced
fix as a substitute for reviewing a major update. Dependency PRs should be tested
together when their lockfile changes overlap.

## Live tests are a separate workflow

The default run includes three skipped live tests under `test/e2e/`. Each requires
its corresponding flag to be exactly `1`:

| Flag | External effect |
| --- | --- |
| `GRAVEDIGGER_E2E` | Connects WhatsApp and exercises live ingestion. |
| `GRAVEDIGGER_MODEL_E2E` | Makes a real provider request with a fixed harmless prompt; may incur costs. |
| `GRAVEDIGGER_DELIVERY_E2E` | Can send a real WhatsApp message. |

Read the relevant test before any explicitly authorized live run. For WhatsApp
tests, use a separate account, auth directory, database, and permitted test group.
Never reuse an operator's session or a community's messages to get a routine PR green.

## Troubleshooting a fresh setup

- **Wrong Node version or native SQLite load error:** select Node 24, then rerun
  `npm ci`. Native dependencies installed with a different Node major may be
  incompatible. If compilation is required, install the platform build tools.
- **`npm ci` reports a lockfile mismatch:** make sure package and lockfile changes
  were both committed. CI uses normal peer resolution. Check
  `npm config get legacy-peer-deps` if your local result differs; verify with
  `npm ci --legacy-peer-deps=false` rather than hiding the mismatch.
- **`listen EPERM` in local HTTP tests:** the test environment must allow binding
  to localhost. These tests need local sockets, not production API credentials.
- **A routine check asks for pairing or provider keys:** stop and inspect the command
  and live-test flags. The offline workflow does not need either.
- **You only changed docs:** check relative links, command names, synthetic examples,
  `npm run release:check`, and whitespace. Explain which checks were appropriate
  instead of claiming unrun tests passed.

For review, use the [PR template](../.github/pull_request_template.md) and the
[contribution guide](../CONTRIBUTING.md). Security reports follow
[SECURITY.md](../SECURITY.md), using a private reporting channel for details.
