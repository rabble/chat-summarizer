export type Migration = {
  version: number;
  sql: string;
};

export const migrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE groups (
        id INTEGER PRIMARY KEY,
        jid TEXT NOT NULL UNIQUE,
        subject TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        jid TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        external_id TEXT NOT NULL,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
        message_type TEXT NOT NULL,
        text TEXT,
        quoted_external_id TEXT,
        raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
        ingested_at INTEGER NOT NULL,
        UNIQUE (group_id, external_id)
      );

      CREATE INDEX messages_sender_id_idx ON messages(sender_id);
      CREATE INDEX messages_group_timestamp_idx ON messages(group_id, timestamp_ms);

      CREATE VIRTUAL TABLE message_fts USING fts5(
        text,
        content = 'messages',
        content_rowid = 'id'
      );

      CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO message_fts(rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO message_fts(message_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;

      CREATE TRIGGER messages_fts_update AFTER UPDATE OF text ON messages BEGIN
        INSERT INTO message_fts(message_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
        INSERT INTO message_fts(rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TABLE unsupported_messages (
        id INTEGER PRIMARY KEY,
        external_id TEXT,
        group_jid TEXT,
        sender_jid TEXT,
        reason TEXT NOT NULL,
        raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
        observed_at INTEGER NOT NULL
      );

      CREATE INDEX unsupported_messages_sender_idx
        ON unsupported_messages(sender_jid);

      CREATE TABLE media (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        mime_type TEXT,
        path TEXT,
        caption TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE links (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        url TEXT NOT NULL,
        normalized_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        title TEXT,
        summary TEXT,
        fetched_at INTEGER,
        UNIQUE (message_id, url)
      );

      CREATE TABLE threads (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        title TEXT,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        opened_at INTEGER NOT NULL,
        closed_at INTEGER
      );

      CREATE TABLE thread_messages (
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        PRIMARY KEY (thread_id, message_id)
      );

      CREATE TABLE entities (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
        first_seen_at INTEGER NOT NULL,
        UNIQUE (kind, canonical_name)
      );

      CREATE TABLE entity_mentions (
        id INTEGER PRIMARY KEY,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        claim_text TEXT
      );

      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'completed', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
        available_at INTEGER NOT NULL,
        locked_at INTEGER,
        completed_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX jobs_claim_idx ON jobs(status, available_at, id);

      CREATE TABLE digests (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        window_started_at INTEGER NOT NULL,
        window_ended_at INTEGER NOT NULL,
        markdown TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE digest_threads (
        digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        PRIMARY KEY (digest_id, thread_id)
      );

      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        rule TEXT NOT NULL,
        body TEXT NOT NULL,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE feedback (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        rating TEXT NOT NULL CHECK (rating IN ('star', 'skip')),
        created_at INTEGER NOT NULL,
        UNIQUE (thread_id)
      );

      CREATE TABLE gaps (
        id INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        cause TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      );

      CREATE INDEX gaps_window_idx ON gaps(started_at, ended_at);

      CREATE TABLE connector_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'logged_out')),
        observed_at INTEGER NOT NULL,
        last_heartbeat_at INTEGER
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE participant_profiles (
        person_id INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
        observed_summary TEXT NOT NULL DEFAULT '',
        public_identity_name TEXT,
        public_summary TEXT,
        public_source_urls_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(public_source_urls_json)),
        identity_confidence TEXT NOT NULL DEFAULT 'unverified'
          CHECK (identity_confidence IN ('unverified', 'probable', 'verified')),
        source_message_ids_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(source_message_ids_json)),
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE scheduled_digests (
        local_date TEXT PRIMARY KEY,
        window_started_at INTEGER NOT NULL,
        window_ended_at INTEGER NOT NULL,
        job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'delivered')),
        markdown TEXT,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (window_ended_at >= window_started_at)
      );
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE gaps ADD COLUMN reconciled_at INTEGER;
      ALTER TABLE gaps ADD COLUMN reconciliation_reason TEXT;

      UPDATE gaps
         SET reconciled_at = ended_at,
             reconciliation_reason = CASE
               WHEN cause = 'operator_stop' THEN 'planned_restart'
               WHEN ended_at - started_at < 300000 THEN 'brief_reconnect'
               ELSE 'history_recovered'
             END
       WHERE ended_at IS NOT NULL
         AND (
           cause = 'operator_stop'
           OR ended_at - started_at < 300000
           OR EXISTS (
             SELECT 1
               FROM messages m
              WHERE m.timestamp_ms >= gaps.started_at
                AND m.timestamp_ms < gaps.ended_at
                AND m.ingested_at >= gaps.ended_at
           )
         );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE INDEX thread_messages_message_idx ON thread_messages(message_id);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE scheduled_digests_by_schedule (
        schedule_id TEXT NOT NULL DEFAULT 'primary',
        local_date TEXT NOT NULL,
        window_started_at INTEGER NOT NULL,
        window_ended_at INTEGER NOT NULL,
        job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'delivered')),
        markdown TEXT,
        delivered_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (schedule_id, local_date),
        CHECK (window_ended_at >= window_started_at)
      );
      INSERT INTO scheduled_digests_by_schedule (
        local_date, window_started_at, window_ended_at, job_id, status,
        markdown, delivered_at, created_at, updated_at
      ) SELECT local_date, window_started_at, window_ended_at, job_id, status,
        markdown, delivered_at, created_at, updated_at FROM scheduled_digests;
      DROP TABLE scheduled_digests;
      ALTER TABLE scheduled_digests_by_schedule RENAME TO scheduled_digests;
    `,
  },
];
