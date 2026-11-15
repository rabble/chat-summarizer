# Security

This is experimental, self-hosted software. There is no hosted service, uptime
guarantee, security certification, or promise that an unofficial WhatsApp client
will remain compatible. See [the privacy guide](docs/privacy.md) before linking an account.

## Reporting

Use the repository's **Security → Report a vulnerability** feature when private
vulnerability reporting is enabled. If it is unavailable, open an issue containing
only a request for a private reporting channel, with no technical details or data.
Do not post credentials, session keys, QR codes, chat excerpts, or identifying
operational logs in a public issue, PR, or discussion.

Include affected versions, a synthetic reproduction, expected and actual results,
and suggested mitigations through the private channel. Never test against someone
else's WhatsApp account or group. The latest published source is the maintained
baseline; older snapshots do not have a separate backport policy.

## Operator responsibilities

- Get informed permission before collecting or forwarding community content.
- Protect `.env`, the database, backups, and the entire auth directory. Auth files
  are reusable login credentials. Use encrypted storage and a dedicated OS account.
- Keep the process and data directory private; do not expose either over a web server.
- Stop the process before pairing a replacement or copying auth state. Run only one
  connector per session directory.
- Treat model output and fetched page content as untrusted. Check important claims.
- Keep dependencies updated, inspect `npm audit`, and preserve WhatsApp account
  recovery access. Revoke a linked device through the phone if its session is exposed.

Open-source publication covers the software, never an operator's community data.
