import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import { backfillStoredLinks } from '../../src/links/backfill-links.js';
import { storeMessage } from '../../src/messages/message-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('link backfill', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: GravediggerDatabase;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = openDatabase(temporaryDatabase.path);
  });

  afterEach(() => {
    database.close();
    temporaryDatabase.cleanup();
  });

  test('queues links found in messages captured before link extraction existed', () => {
    storeMessage(database, {
      externalId: 'm1',
      groupJid: '120@g.us',
      senderJid: 'alice@s.whatsapp.net',
      senderName: 'Alice',
      timestampMs: 1_000,
      messageType: 'conversation',
      text: 'Code: https://github.com/example/tool',
      quotedExternalId: null,
      rawJson: '{}',
    }, 1_000);
    database.exec("DELETE FROM jobs WHERE kind = 'fetch_link'; DELETE FROM links;");

    expect(backfillStoredLinks(database, 2_000)).toEqual({
      messagesScanned: 1,
      linksInserted: 1,
      jobsQueued: 1,
    });
    expect(backfillStoredLinks(database, 3_000)).toEqual({
      messagesScanned: 1,
      linksInserted: 0,
      jobsQueued: 0,
    });
    expect(database.prepare('SELECT url FROM links').pluck().all()).toEqual([
      'https://github.com/example/tool',
    ]);
  });
});
