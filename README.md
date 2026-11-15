# Community Brief

Self-hosted WhatsApp community briefings, with clickable source links and private
questions. Turn a busy set of rooms into a daily catch-up without adding a bot that
talks back in every source group.

Community Brief runs on your machine. It collects only allowlisted group messages
into SQLite, organizes conversations, enriches shared links, and sends scheduled
newsletters to configured private accounts or a dedicated summaries group. Each
recipient can have their own local-time schedule, including daylight-saving changes.
Private questions are limited to one explicitly authorized account.

**Experimental:** WhatsApp connectivity uses the unofficial Baileys library. It may
break, require re-pairing, or result in an account restriction. Use an appropriate
account and obtain community permission before collecting or forwarding messages.
Read [privacy and data flow](docs/privacy.md) before deployment.

## Quick start

Use Node.js **24 LTS**, npm, and an always-on machine. macOS is the currently
operated platform; CI also checks the offline suite on Linux. Native SQLite builds
may need platform build tools when a prebuilt binary is unavailable.

From a clone of this repository:

```sh
nvm use
npm ci
cp .env.example .env
npm run build
```

Edit `.env` before running. The `GRAVEDIGGER_*` names are retained for compatibility
with earlier installations; GRAVEDIGGER was the development name.

| Setting | Purpose |
| --- | --- |
| `GRAVEDIGGER_DATABASE_PATH` | Local SQLite file; default example: `data/gravedigger.sqlite`. |
| `GRAVEDIGGER_AUTH_DIR` | Private linked-device credentials; example: `data/auth`. |
| `GRAVEDIGGER_GROUP_JIDS` | Comma-separated source group IDs ending in `@g.us`. |
| `GRAVEDIGGER_DIGEST_RECIPIENT` | E.164 phone number authorized for private questions and the default newsletter. |
| `GRAVEDIGGER_DIGEST_GROUP_JID` | Optional exact summaries-group ID; must not be a source room. |
| `GRAVEDIGGER_AUTO_DIGEST_ENABLED` | Example configuration starts with `false`. Set `true` after reviewing sources and recipients. |
| `GRAVEDIGGER_DIGEST_HOUR`, `GRAVEDIGGER_DIGEST_MINUTE` | Delivery time; default 08:00. |
| `GRAVEDIGGER_DIGEST_TIME_ZONE` | IANA zone; default `Pacific/Auckland`. |
| `GRAVEDIGGER_DIGEST_LOOKBACK_HOURS` | Evidence window; default 24 hours. |
| `GRAVEDIGGER_ADDITIONAL_DIGESTS` | Optional JSON array of independent private subscriptions. |

The example source group and phone number are **synthetic placeholders**. If you
don't know a group's internal ID, pair with the placeholder first; the local
startup log lists available subjects and IDs. Stop, replace the source allowlist
with only the permitted rooms, and restart. Do not share those logs publicly.

```sh
npm start
```

On the phone, open **WhatsApp → Settings → Linked Devices → Link a Device** and scan
the terminal QR (also saved privately as `data/pairing-qr.png`). Credentials persist.
Stop with Ctrl-C. Only one process may use an auth directory at a time.

## Model providers

Ingestion, SQLite indexing, and thread/link processing do not require a model key.
To generate briefings or answer questions, configure one provider in `.env`:

- **Lunaroute:** `LUNAROUTE_API_KEY` and `LUNAROUTE_MODEL`. Takes precedence when set;
  the example model is `deepseek-4.1-flash`.
- **OpenRouter:** `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. The example model is
  `deepseek/deepseek-v4-flash-0731`.

These are configured catalog IDs, not a promise of model availability or pricing.
Provider calls send selected community evidence off the machine. Participant
profile refreshes can run on connection when a model key is configured, even if
automatic newsletter scheduling is disabled. Review the [privacy guide](docs/privacy.md).

## Daily delivery

Set `GRAVEDIGGER_AUTO_DIGEST_ENABLED=true` when ready. Startup after the scheduled
time catches up the current local date if no edition is already recorded.
Each subscription has a separate delivery record. A multi-part delivery interrupted
after some messages may repeat earlier parts on retry.

For example, this independent private subscription sends at 08:00 Chicago time:

```dotenv
GRAVEDIGGER_ADDITIONAL_DIGESTS=[{"id":"example-reader","recipient":"+15550987654","timeZone":"America/Chicago","hour":8,"minute":0,"lookbackHours":24,"startDate":"2030-01-01"}]
```

Replace the synthetic number and future `startDate`. The start date prevents an
immediate late catch-up when adding a recipient. Subscriptions do not authorize
private questions. Use `America/Chicago` for Houston to follow daylight-saving changes.

For a community feed, create a dedicated bot-summaries group, add the linked account,
and set `GRAVEDIGGER_DIGEST_GROUP_JID`. An admin may need to approve it or permit
posting. The destination must be separate from source rooms. The connector verifies
membership and posting permission and rejects community parent/announcement rooms.
Review attribution rules before enabling it; see [privacy.md](docs/privacy.md).

Briefings preserve uncertainty, identify missing sources, include shared URLs, and
report known coverage gaps. They remain AI-generated and can be wrong.

## Ask privately

From `GRAVEDIGGER_DIGEST_RECIPIENT`, DM the linked account: “What did the rooms
discuss this week?” or a focused question. Replies stay in that DM. Other DMs and
questions in source groups are ignored. A transcript pasted in the authorized DM
can be analyzed as temporary evidence; it is not written to SQLite.

## Operations

```sh
node dist/cli.js health --json
node dist/cli.js purge-person 15550123456@s.whatsapp.net --json
```

The purge command above uses a synthetic example. Use it only for an actual deletion
request and confirm the identifier privately. Deletion does not recall sent messages
or erase providers' copies and backups.

For macOS automatic startup, inspect `npm run service:print`, then use
`npm run service:install`. The installer generates paths for your checkout and Node
binary; it does not contain a maintainer's home directory. Store model keys in the
private `.env`, since the service starts with a clean environment. See [operations](docs/operations.md)
for logs, restarts, and backups.

## Development

For a first contribution, follow [CONTRIBUTING.md](CONTRIBUTING.md) and the
[developer guide](docs/development.md). Coding agents should start with
[AGENTS.md](AGENTS.md). No live account or model credentials are needed.

```sh
npm run check
npm run build
npm run release:check
```

The default suite uses synthetic fixtures, temporary SQLite files, and local HTTP
servers. It needs no WhatsApp session, provider key, or `.env`. Live tests are
explicitly opt-in and can perform external actions; follow [CONTRIBUTING.md](CONTRIBUTING.md).
Architecture is described in [docs/architecture.md](docs/architecture.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
The source license does not grant rights to anyone's messages, accounts, or data.
Community Brief is not affiliated with WhatsApp or Meta.
