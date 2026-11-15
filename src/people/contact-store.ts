import type { Contact } from '@whiskeysockets/baileys';

import type { GravediggerDatabase } from '../db/database.js';

type ContactWithAlternateIds = Partial<Contact> & {
  username?: string;
  phoneNumber?: string;
};

export function storeContactNames(
  database: GravediggerDatabase,
  contacts: readonly Partial<Contact>[],
): number {
  return database.transaction(() => {
    let updated = 0;
    for (const contact of contacts) {
      const contactWithAlternateIds = contact as ContactWithAlternateIds;
      const displayName = firstName(
        contact.name,
        contact.verifiedName,
        contact.notify,
        contactWithAlternateIds.username,
      );
      if (displayName === null) continue;
      const identifiers = [...new Set([
        contact.id,
        contact.lid,
        contactWithAlternateIds.phoneNumber,
      ].filter((value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
      ))];
      if (identifiers.length === 0) continue;
      const placeholders = identifiers.map(() => '?').join(', ');
      updated += database.prepare(
        `UPDATE people SET display_name = ? WHERE jid IN (${placeholders})`,
      ).run(displayName, ...identifiers).changes;
    }
    return updated;
  })();
}

function firstName(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
