# Privacy and data flow

## Permission is deployment-specific

The software does not establish that a community has consented. Before running it,
agree with members on collection, model providers, attribution, recipients, retention,
and deletion. A destination group being in the same community does not establish
permission to forward every source room. Keep restricted rooms out of the allowlist.

## What is stored locally

SQLite stores allowlisted message text, raw message envelopes, sender identifiers
and display names, room names, extracted links and fetched page metadata, thread
assignments, source-bound participant profiles, newsletter copy, jobs, and coverage
gaps. Unsupported allowlisted envelopes may be retained for diagnostics. Non-allowlisted
group messages and unauthorized direct messages are ignored by the application.

The WhatsApp library receives protocol events before the application applies its
allowlist, and its auth directory may contain cryptographic state or identifier
mappings for other chats. An allowlist is not an account-level isolation boundary.

## What leaves the machine

- WhatsApp carries the companion connection, history requests, private answers, and
  newsletters to explicitly configured recipients.
- Model calls send selected evidence, relevant fetched-link context, the question,
  and applicable profile context to Lunaroute or OpenRouter and downstream providers.
  Local storage does not mean local inference. The OpenRouter request asks for
  zero-retention routing; this is a requested policy, not a verified guarantee about
  every provider or proxy. Lunaroute has its own terms and routing policies.
- Link enrichment contacts websites referenced in collected messages. Those websites
  can observe network requests from the machine. Links and page text remain untrusted.

Authorized private questions are not stored as chat messages. A pasted transcript
is temporary evidence, but answering it still sends it to the configured model provider.

## Attribution and source limits

Current community-group editions may attribute contributions using captured display
names. They omit the separate participant-profile section, but message bodies can
still identify people. Additional private subscriptions use anonymous prompts.
Anonymous prompts reduce identifying context; they are not a reliable anonymization
system and do not replace reviewing the destination and the community's rules.
Do not enable attributed editions where a community requires non-attribution.

The app stores text and captions it supports; it does not promise to capture every
message or all pre-pairing history. Summaries can contain mistakes. Coverage notes,
citation-status labels, and uncertainty wording are part of the product contract.

## Deletion and retention

`purge-person` removes the sender's stored source data and derived caches whose
provenance references that sender. It cannot retract already sent WhatsApp messages,
erase providers' copies, or remove copies from backups. No automatic age-based
retention policy is implemented. Operators must manage backup retention and disposal.

Use `.env` file permissions of `0600`, an auth directory of `0700`, and encrypted
storage (for example, FileVault on macOS or equivalent disk encryption). Keep logs and
backups private. Never publish the running checkout as a static website.
