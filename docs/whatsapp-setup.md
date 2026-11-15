# Connect your own WhatsApp account

This walkthrough takes a fresh installation from cloning the code to receiving a
private summary, then optionally enables daily delivery and a summaries group.
You run your own instance, linked account, database, and provider credentials.

Community Brief connects as an **unofficial WhatsApp linked device** using Baileys.
You pair by scanning a QR; this setup does not require a Meta developer app, WhatsApp
Business Cloud API credentials, or a public webhook server. Connectivity can break
or require re-pairing. Agree with community members on collection, attribution,
model processing, and recipients before including their rooms. Read
[privacy.md](privacy.md) for the data flow and deletion limits.

## 1. Choose the linked account and reader

You need a machine that can stay awake and online, Git, Node.js **24 LTS**, npm,
and access to WhatsApp on the linked account's primary phone. These shell commands
use a macOS/Linux-style terminal. macOS has a bundled automatic-start installer;
Linux is covered by offline CI and needs your own process supervision for deployment.

There are two separate roles:

| Role | What to use |
| --- | --- |
| **Linked account** | The WhatsApp account whose phone scans the QR. It must belong to every source group you select, and it sends the summaries. A dedicated account makes its purpose clear. |
| **Reader account** | The number in `GRAVEDIGGER_DIGEST_RECIPIENT`. It receives the default private newsletter and is the only account allowed to DM questions to the linked account. |

For private questions, use a reader account **different from the linked account**.
The application ignores messages sent by the linked account itself, including
self-messages. Additional newsletter recipients do not gain question access.

Ask an admin to add the linked account to the intended source groups. Joining a
community alone may not make it a member of every room. You will select the actual
rooms after pairing.

## 2. Install a fresh copy

```sh
git clone https://github.com/rabble/chat-summarizer.git
cd chat-summarizer
nvm use
npm ci
npm run build
umask 077
mkdir -p data
chmod 700 data
cp .env.example .env
chmod 600 .env
```

If using another Node manager, select Node 24 instead of `nvm use`. SQLite includes
a native addon; if no suitable prebuilt binary is available, install the platform's
compiler tools. This `cp` step is for a fresh checkout; preserve an existing `.env`
when updating an installation. Never copy someone else's auth directory or database.

## 3. Configure discovery without automatic summaries

Open `.env` locally in an editor. The `GRAVEDIGGER_*` names remain for compatibility.
For now, keep the example paths and source placeholder, and use these settings:

```dotenv
GRAVEDIGGER_DATABASE_PATH=data/gravedigger.sqlite
GRAVEDIGGER_AUTH_DIR=data/auth
GRAVEDIGGER_GROUP_JIDS=120363000000000000@g.us
GRAVEDIGGER_DIGEST_RECIPIENT=+15550123456
GRAVEDIGGER_DIGEST_GROUP_JID=
GRAVEDIGGER_LOG_LEVEL=info
GRAVEDIGGER_AUTO_DIGEST_ENABLED=false
GRAVEDIGGER_ADDITIONAL_DIGESTS=[]
LUNAROUTE_API_KEY=
OPENROUTER_API_KEY=
```

**Replace `+15550123456` with the reader account's real number**, including country
code, a leading `+`, and no spaces or parentheses. The number above and all group
IDs in this guide are invented examples. The source placeholder lets you discover
group IDs before selecting a real source room; replace it in step 5.

Use a clean terminal environment for a separate instance. Previously exported
`GRAVEDIGGER_*` variables take precedence over `.env`; clear stale settings from
another installation rather than accidentally reusing its database or auth path.

Leave both provider keys empty during discovery. Connection can refresh participant
profiles when a model key is present, even with automatic summaries disabled.
The first-start command below also clears inherited provider keys for that process.
The account's session state and metadata are still handled locally during pairing;
this is not an account-wide isolation boundary.

## 4. Pair the linked account

From the project directory, run:

```sh
LUNAROUTE_API_KEY= OPENROUTER_API_KEY= npm start
```

Keep this terminal open. It will display **Scan this QR in WhatsApp Linked Devices**.
On the linked account's primary phone:

1. Open WhatsApp.
2. On **Android**, open the three-dot menu and choose **Linked devices**. On
   **iPhone**, open **Settings** (or the profile/settings entry) and choose
   **Linked Devices**.
3. Choose **Link a device**, authenticate if prompted, and scan the terminal QR.

Menu wording may vary by app version. See WhatsApp's official
[device-linking help](https://faq.whatsapp.com/1317564962315842/) for its current phone flow.

The same QR is saved as `data/pairing-qr.png` with the example auth path. If the
terminal QR is hard to scan, open that file on your own machine. With a custom auth
path, the image is written beside the auth directory; the log reports its path.
Scan the latest QR if it refreshes. Do not upload the image or terminal screenshot.

Successful connection logs **WhatsApp connection opened**, followed by
**available WhatsApp groups**. That entry lists group names as `subject` and their
internal IDs as `jid`. For example, an invented entry looks like:

```json
{"groups":[{"jid":"120363000000000000@g.us","subject":"Example source room"}],"msg":"available WhatsApp groups"}
```

The actual list is private. Keep it local. Credentials persist under `data/auth`,
so a normal restart should reuse the linked device without another scan.

## 5. Select the source groups

Press **Ctrl-C** and wait for the process to stop. Copy only the approved source
rooms' exact `jid` values from the local group listing into `.env`:

```dotenv
GRAVEDIGGER_GROUP_JIDS=120363000000000000@g.us
```

Replace that invented ID with the real value. For multiple rooms, use a
comma-separated list. A group name, phone number, or invitation link will not work.
Use the individual discussion rooms you intend to summarize.

If a room is missing, verify on the phone that the linked account is actually a
member. Add it through the normal group/admin flow, then restart to get a fresh
group listing. The bot does not automatically join rooms.

For now, keep `GRAVEDIGGER_AUTO_DIGEST_ENABLED=false` and both model keys empty.
Restart with the discovery command from step 4. Allowlisted text and supported
captions now become local evidence. Link enrichment can contact shared websites;
it does not require a model key.

In a **second terminal**, from this same project directory under Node 24, inspect:

```sh
node dist/cli.js health --json
```

This examines the database; it does not start a second WhatsApp connector. After a
new permitted source message arrives, `lastMessageAt` should contain a recent
Unix timestamp in milliseconds. Watch the first terminal for processed batches and
errors. The health timestamp is global across sources, so it does not prove every
room or every historical message was captured.

History is best effort. WhatsApp may offer recent history, and the connector can
request bounded older pages after live activity. Do not expect a complete archive
or guaranteed access to weeks of pre-pairing discussion. Wait for ordinary group
activity rather than posting bot test markers into a real community.

## 6. Receive your first private summary

Stop the process with Ctrl-C. Configure **one** model provider in `.env` using your
own key and an available model from that provider. For example:

```dotenv
OPENROUTER_API_KEY=REPLACE_WITH_YOUR_KEY
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731
LUNAROUTE_API_KEY=
GRAVEDIGGER_AUTO_DIGEST_ENABLED=false
```

The model ID is an example, not a guarantee of availability. Alternatively, set
`LUNAROUTE_API_KEY` and `LUNAROUTE_MODEL`; Lunaroute takes precedence if its key is
set. Keep the unused provider key empty and check for conflicting inherited shell
variables. Selected evidence goes to the provider and may incur charges; review
[privacy.md](privacy.md) before this step.

Restart normally so the configured provider is available:

```sh
npm start
```

From the **reader account**, open a private chat with the **linked account** and send:

> Summarize what the community has been discussing. Include the original shared links and explain any missing coverage.

The answer should return in that private chat. It summarizes only captured evidence.
If there is little history, expect a limited answer. A question in a source group,
a DM from another number, or a self-message from the linked account is ignored.
There is no separate CLI command for sending an immediate summary; this authorized
DM is the supported on-demand path.

## 7. Enable daily summaries

After verifying the sources, reader, provider, and first answer, stop the process
and configure the schedule in `.env`. For example, 08:00 Chicago local time:

```dotenv
GRAVEDIGGER_AUTO_DIGEST_ENABLED=true
GRAVEDIGGER_DIGEST_HOUR=8
GRAVEDIGGER_DIGEST_MINUTE=0
GRAVEDIGGER_DIGEST_TIME_ZONE=America/Chicago
GRAVEDIGGER_DIGEST_LOOKBACK_HOURS=24
```

Choose your own IANA time zone. Restart with `npm start` and check for **daily digest
schedule active**. The primary edition goes to the reader number when no summaries
group is configured. Starting after the scheduled time can send today's edition
immediately if it has not already been recorded; the first edition may cover only
the partial history captured so far.

For independent readers and schedules, see [daily delivery in the README](../README.md#daily-delivery).
To stop sending immediately, stop the process. Turning off automatic scheduling
alone does not cancel previously queued delivery jobs.

### Optional: publish into a summaries group

Create an ordinary WhatsApp group with a clear purpose, such as **Bot summaries**,
and add the linked account. If it belongs to a community, an admin may need to
approve the group. Discover its exact ID using the startup listing, then stop and set:

```dotenv
GRAVEDIGGER_DIGEST_GROUP_JID=120363999999999999@g.us
```

Replace that invented ID. **Keep the destination out of `GRAVEDIGGER_GROUP_JIDS`.**
The linked account must be allowed to post. If the group permits only admin posts,
make that account an admin or change the posting setting. Community parent and
community-announcement rooms are rejected as delivery destinations.

After restart, the primary scheduled edition goes to this group instead of the
reader DM; the reader number still controls private-question access. Current group
editions can name participants, so confirm that attribution and forwarding match
the source community's rules. See [privacy.md](privacy.md).

## 8. Keep it running and recover safely

First confirm terminal operation. On macOS, stop the terminal connector before
installing the automatic-start service:

```sh
npm run service:print
npm run service:install
```

The machine must remain awake and online. The user LaunchAgent runs after login;
store credentials in the private `.env`, since it starts with a clean environment.
Follow [operations.md](operations.md) for restarts, status, private logs, and backups.
Run only one connector per auth directory.

| Symptom | Check |
| --- | --- |
| No QR on restart | A saved session may already be linked. Look for the connection-open log and check Linked Devices on the phone. |
| QR will not scan | Use the linked account's primary phone, the current QR, and its Linked Devices scanner. Reopen the PNG if it refreshed. |
| Expected room missing | Confirm the linked account is a member, then restart and inspect the local group listing. |
| Connected, but no messages captured | Replace the source placeholder with exact room IDs; wait for new permitted activity and inspect processed batches plus `health --json`. |
| Private question gets no answer | Send from the exact reader number to the linked account, check the provider configuration/errors, and avoid self-messages. |
| Daily summary not received | Check process uptime, provider errors, local time zone, delivery permissions, queued/dead jobs, and whether today's edition was already sent. |
| Logged out or session invalid | Stop every process using that auth directory and inspect Linked Devices on the primary phone. Revoke the old entry before deliberately re-pairing. |
| WebSocket upgrade repeatedly rejected | Stop repeated restarts; check the account in the official app, connectivity, and recorded status code before retrying. Preserve the database and auth state while diagnosing. |

For deliberate re-pairing, stop the connector, revoke the old linked device on the
phone, and choose a new private auth directory in `.env` (for example,
`GRAVEDIGGER_AUTH_DIR=data/auth-new`). Restart and scan the fresh QR. Keep the
existing database path to retain captured history. Do not delete the database as
a pairing fix, and never share old credentials or an unfiltered terminal log.
