# Contributing

Start with a small issue or pull request explaining the change and how to verify it.
Use Node.js 24 LTS and install the committed lockfile with `npm ci`.

```sh
npm run check
npm run build
npm run release:check
```

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

By contributing, you agree that your contribution may be distributed under the
project's [GPL-3.0 license](LICENSE). Preserve third-party attribution and notices.
