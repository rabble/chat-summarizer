import type { GravediggerDatabase } from '../db/database.js';

type GroupMetadata = {
  id: string;
  subject?: string;
};

export function storeGroupSubjects(
  database: GravediggerDatabase,
  groups: Readonly<Record<string, GroupMetadata>>,
  groupAllowlist: ReadonlySet<string>,
  observedAt: number = Date.now(),
): number {
  const upsert = database.prepare(
    `INSERT INTO groups (jid, subject, created_at)
     VALUES (?, nullif(trim(?), ''), ?)
     ON CONFLICT (jid) DO UPDATE SET
       subject = coalesce(excluded.subject, groups.subject)`,
  );

  return database.transaction(() => {
    let stored = 0;
    for (const group of Object.values(groups)) {
      if (!groupAllowlist.has(group.id)) continue;
      upsert.run(group.id, group.subject ?? '', observedAt);
      stored += 1;
    }
    return stored;
  })();
}
