# Operations

Use Node.js 24 LTS. One process must own a given WhatsApp auth directory at a time.
Do not run a terminal connector alongside the service, or run live tests against
the service's auth directory.

## macOS startup

Pair in the terminal first, verify the desired source allowlist, and stop with
Ctrl-C. Put required model credentials in the private `.env`, not just the terminal
environment. The LaunchAgent deliberately clears inherited environment variables.

```sh
npm run build
npm run service:print
npm run service:install
```

The installer writes a user LaunchAgent named `org.communitybrief.agent` with
absolute paths for the current checkout and Node binary. It starts at user login,
restarts after abnormal exits, and writes `data/service.stdout.log` and
`data/service.stderr.log`. The machine must remain powered on, awake, and logged in;
this is not an unattended system daemon that runs before FileVault unlock.

Inspect status with Activity Monitor or a filtered launchctl report:

```sh
launchctl print "gui/$(id -u)/org.communitybrief.agent" | awk '/state =|pid =|runs =|last exit code/'
```

Avoid sharing an unfiltered launchctl dump: the user launchd domain can contain
unrelated inherited credentials. The app process itself starts with a clean environment.

Graceful stop and start:

```sh
launchctl kill SIGTERM "gui/$(id -u)/org.communitybrief.agent"
launchctl kickstart "gui/$(id -u)/org.communitybrief.agent"
```

Before moving the checkout, changing Node paths, or reinstalling, unload the agent:

```sh
launchctl bootout "gui/$(id -u)/org.communitybrief.agent"
```

Move the old `org.communitybrief.agent.plist` out of `Library/LaunchAgents` using
Finder, then run the installer from the new checkout under Node 24. Stop any older
service label before migrating; the installer does not discover or remove other agents.
It refuses to overwrite an existing plist.

Installation restricts the existing `data` directory to owner access (`0700`) and
`.env` to `0600`. The service uses umask `0077` for newly created files. Apply
equivalent permissions to any database or auth directories configured outside
`data`; the installer does not change those locations.

## Health and recovery

`node dist/cli.js health --json` reports the latest captured timestamp, open coverage
gap, pending/running/dead jobs, and unsupported-envelope count. Check actual message
capture as well as process liveness. A zero backlog does not prove complete history.

Network interruptions trigger bounded reconnect delays. A logged-out or invalid
session needs operator action; repeated restarts are not a pairing strategy. Check
Linked Devices on the phone and preserve a private backup before replacing auth.
Never publish a QR or session file for troubleshooting.

## Backups and storage

Use encrypted storage. The app does not encrypt its database at rest. Restrict
access to `.env`, auth, databases, and logs. There is no automatic log rotation or
age-based retention: arrange these locally and stop the service before rotating
open log files.

Stop the connector before copying auth state. For SQLite WAL mode, use a consistent
backup rather than copying only the main database:

```sh
sqlite3 data/gravedigger.sqlite ".backup 'data/community-brief-backup.sqlite'"
```

Restore only while stopped. Deletion requests must also be considered when keeping
or restoring old backups. Never put backups or the data directory in a release archive.
