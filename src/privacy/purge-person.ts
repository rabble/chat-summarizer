import type { GravediggerDatabase } from '../db/database.js';

export type PurgeReport = {
  found: boolean;
  people: number;
  messages: number;
  media: number;
  links: number;
  unsupportedMessages: number;
  threads: number;
  digests: number;
  alerts: number;
  feedback: number;
  entityMentions: number;
  jobs: number;
  entities: number;
};

export function purgePerson(
  database: GravediggerDatabase,
  senderJid: string,
): PurgeReport {
  return database.transaction(() => {
    const person = database
      .prepare('SELECT id FROM people WHERE jid = ?')
      .get(senderJid) as { id: number } | undefined;
    if (person === undefined) {
      return emptyReport();
    }

    const messageRows = database
      .prepare('SELECT id, external_id FROM messages WHERE sender_id = ?')
      .all(person.id) as { id: number; external_id: string }[];
    const messageIds = messageRows.map((row) => row.id);
    const externalIds = messageRows.map((row) => row.external_id);
    const threadIds = selectNumbers(
      database,
      `SELECT DISTINCT tm.thread_id
         FROM thread_messages tm
         JOIN messages m ON m.id = tm.message_id
        WHERE m.sender_id = ?`,
      [person.id],
    );
    const digestIds = selectIn(
      database,
      'SELECT DISTINCT digest_id FROM digest_threads WHERE thread_id',
      threadIds,
    );
    const affectedEntityIds = unique([
      ...selectIn(
        database,
        'SELECT DISTINCT entity_id FROM entity_mentions WHERE thread_id',
        threadIds,
      ),
      ...selectNumbers(
        database,
        'SELECT DISTINCT entity_id FROM entity_mentions WHERE person_id = ?',
        [person.id],
      ),
    ]);

    const report: PurgeReport = {
      found: true,
      people: 1,
      messages: messageIds.length,
      media: countIn(database, 'media', 'message_id', messageIds),
      links: countIn(database, 'links', 'message_id', messageIds),
      unsupportedMessages: countWhere(
        database,
        'unsupported_messages',
        'sender_jid = ?',
        [senderJid],
      ),
      threads: threadIds.length,
      digests: digestIds.length,
      alerts: countIn(database, 'alerts', 'thread_id', threadIds),
      feedback: countIn(database, 'feedback', 'thread_id', threadIds),
      entityMentions: countEntityMentions(database, person.id, threadIds),
      jobs: 0,
      entities: 0,
    };

    report.jobs = deleteAffectedJobs(
      database,
      person.id,
      senderJid,
      threadIds,
      externalIds,
    );
    deleteIn(database, 'digests', 'id', digestIds);
    deleteIn(database, 'threads', 'id', threadIds);
    database
      .prepare('DELETE FROM unsupported_messages WHERE sender_jid = ?')
      .run(senderJid);
    database.prepare('DELETE FROM people WHERE id = ?').run(person.id);
    report.entities = deleteOrphanEntities(database, affectedEntityIds);

    return report;
  })();
}

function deleteAffectedJobs(
  database: GravediggerDatabase,
  personId: number,
  senderJid: string,
  threadIds: readonly number[],
  externalIds: readonly string[],
): number {
  const conditions = [
    "json_extract(payload_json, '$.personId') = ?",
    "json_extract(payload_json, '$.senderJid') = ?",
  ];
  const values: (number | string)[] = [personId, senderJid];

  if (threadIds.length > 0) {
    conditions.push(
      `json_extract(payload_json, '$.threadId') IN (${placeholders(threadIds)})`,
    );
    values.push(...threadIds);
  }
  if (externalIds.length > 0) {
    conditions.push(
      `json_extract(payload_json, '$.messageExternalId') IN (${placeholders(externalIds)})`,
    );
    values.push(...externalIds);
  }

  return database
    .prepare(`DELETE FROM jobs WHERE ${conditions.join(' OR ')}`)
    .run(...values).changes;
}

function deleteOrphanEntities(
  database: GravediggerDatabase,
  entityIds: readonly number[],
): number {
  if (entityIds.length === 0) {
    return 0;
  }

  return database
    .prepare(
      `DELETE FROM entities
        WHERE id IN (${placeholders(entityIds)})
          AND NOT EXISTS (
            SELECT 1 FROM entity_mentions WHERE entity_id = entities.id
          )`,
    )
    .run(...entityIds).changes;
}

function countEntityMentions(
  database: GravediggerDatabase,
  personId: number,
  threadIds: readonly number[],
): number {
  const conditions = ['person_id = ?'];
  const values: number[] = [personId];
  if (threadIds.length > 0) {
    conditions.push(`thread_id IN (${placeholders(threadIds)})`);
    values.push(...threadIds);
  }
  return countWhere(database, 'entity_mentions', conditions.join(' OR '), values);
}

function countIn(
  database: GravediggerDatabase,
  table: string,
  column: string,
  ids: readonly number[],
): number {
  if (ids.length === 0) {
    return 0;
  }
  return countWhere(
    database,
    table,
    `${column} IN (${placeholders(ids)})`,
    ids,
  );
}

function countWhere(
  database: GravediggerDatabase,
  table: string,
  condition: string,
  values: readonly (number | string)[],
): number {
  return database
    .prepare(`SELECT count(*) FROM ${table} WHERE ${condition}`)
    .pluck()
    .get(...values) as number;
}

function deleteIn(
  database: GravediggerDatabase,
  table: string,
  column: string,
  ids: readonly number[],
): void {
  if (ids.length > 0) {
    database
      .prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(ids)})`)
      .run(...ids);
  }
}

function selectIn(
  database: GravediggerDatabase,
  sqlPrefix: string,
  ids: readonly number[],
): number[] {
  if (ids.length === 0) {
    return [];
  }
  return selectNumbers(
    database,
    `${sqlPrefix} IN (${placeholders(ids)})`,
    ids,
  );
}

function selectNumbers(
  database: GravediggerDatabase,
  sql: string,
  values: readonly number[],
): number[] {
  return database.prepare(sql).pluck().all(...values) as number[];
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function unique(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function emptyReport(): PurgeReport {
  return {
    found: false,
    people: 0,
    messages: 0,
    media: 0,
    links: 0,
    unsupportedMessages: 0,
    threads: 0,
    digests: 0,
    alerts: 0,
    feedback: 0,
    entityMentions: 0,
    jobs: 0,
    entities: 0,
  };
}
