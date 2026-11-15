# Architecture

One Node.js process runs a Baileys companion connection, a SQLite-backed job worker,
and per-recipient daily schedulers. No external queue or application server is needed.

1. The connector accepts offered history and live messages. The source allowlist is
   applied before storing supported text or diagnostic envelopes.
2. SQLite stores raw and normalized evidence with an FTS index. Inserting a message
   queues downstream thread segmentation and shared-link work transactionally.
3. The worker yields between jobs so a backlog cannot starve socket events or
   shutdown. Segmentation skips already assigned groups and uses an indexed message
   lookup. Link fetching has bounded responses, redirect limits, and address checks.
4. Schedulers use IANA time zones and independent `(schedule_id, local_date)` records.
   Editions are generated and cached before delivery. Stored delivery status avoids
   redelivering completed dates; a crash partway through a multi-part send can still
   duplicate earlier parts on retry.
5. The model receives source-labeled evidence and produces an editorial briefing.
   It must preserve uncertainty and flag missing sources. The link formatter restores
   shared URLs. Private questions are limited to one configured account; newsletter
   subscriptions do not authorize questions.
6. Heartbeats and connection events record possible ingestion gaps. Recovered history
   and planned reconnects can reconcile operational gaps. A healthy connection does
   not prove complete capture.

`src/privacy/purge-person.ts` deletes source rows and affected derived caches. Read
[privacy.md](privacy.md) for the boundaries of that deletion and the model data flow.

There is currently no web dashboard, public HTTP API, automated community consent
workflow, media understanding, automatic retention, or guarantee of exactly-once
delivery across a crash. The WhatsApp client is unofficial and can require re-pairing.
