# Contributing

Community Brief is a personal project at
[rabble/chat-summarizer](https://github.com/rabble/chat-summarizer), licensed under
GPL-3.0-only. Start with a focused issue or pull request explaining the problem,
the resulting behavior, and how to verify it. An issue is useful for a large design
change; it is not a prerequisite for a small fix.

## Set up without an account

Use Node.js 24 LTS, npm, and Git. The commands below clone the canonical repository.
For an external contribution, fork it first and substitute your fork's clone URL.

```sh
git clone https://github.com/rabble/chat-summarizer.git
cd chat-summarizer
nvm use
npm ci
```

If using another Node manager, select Node 24 instead of `nvm use`. There is no
separate database server or queue to install. Native SQLite builds may need platform
compiler tools. No WhatsApp account, provider key, or `.env` is needed for development.

Validate the checkout:

```sh
npm run check
npm run build
npm run release:check
node dist/cli.js --help
```

Read [docs/development.md](docs/development.md) for the module/test map, migration
workflow, live-test boundaries, and troubleshooting. Coding agents should read
[AGENTS.md](AGENTS.md) first. [docs/architecture.md](docs/architecture.md) describes
the runtime; [docs/privacy.md](docs/privacy.md) explains where data goes.

## Change and verify

Fetch the latest default branch before starting a focused branch. Keep package and
lockfile changes together. TypeScript uses strict ESM with `.js` relative import
suffixes. Match the existing style and `.editorconfig`; no separate lint command is
configured. Edit source files rather than generated `dist/` output.

Run the full checks above for code and dependency changes. A focused test can be run
with `npm test -- test/digests/digest-scheduler.test.ts`. For documentation-only
changes, verify commands, links, examples, source checks, and `git diff --check`.

Tests must pass in a fresh checkout without `.env`, WhatsApp credentials, or a model
key. Test fixtures contain invented messages and identifiers. Add a focused regression
test for behavior changes; use real temporary SQLite databases and local HTTP servers.
Keep live tests opt-in and use a dedicated throwaway group. Never send test markers to
an existing community or use members' messages as fixtures.

Do not include phone numbers, real group IDs, invitation links, message transcripts,
pairing QR codes, `.env`, auth files, databases, or logs in issues or pull requests.
For a bug report, describe expected and actual behavior, Node/OS versions, and a small
synthetic reproduction. Follow [SECURITY.md](SECURITY.md) for security-sensitive reports.

Keep changes to data collection and outbound recipients explicit. A new newsletter
recipient must not gain access to private questions. Preserve source-bound claims,
coverage notices, deletion behavior, and untrusted-content boundaries.

## Submit a pull request

Use a concise title such as `fix: preserve links in long summaries`. Fill in the PR
template with the behavior change, checks actually run, remaining validation gaps,
and any effect on collection, provider calls, attribution, recipients, or deletion.
Include only invented examples. A screenshot or log is not needed for most changes.

CI checks Node 24 on Linux and macOS. Fix relevant failures before requesting a merge.
Keep review conclusions on the PR, tied to the reviewed commit, so contributors can
see findings and verification. Report vulnerabilities through [SECURITY.md](SECURITY.md).

By contributing, you agree that your contribution may be distributed under the
project's [GPL-3.0 license](LICENSE). Preserve third-party attribution and notices.
