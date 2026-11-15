import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase, type GravediggerDatabase } from '../../src/db/database.js';
import {
  loadParticipantProfiles,
  upsertParticipantProfile,
} from '../../src/profiles/profile-store.js';
import {
  createTemporaryDatabase,
  type TemporaryDatabase,
} from '../support/temp-database.js';

describe('participant profiles', () => {
  let temporaryDatabase: TemporaryDatabase;
  let database: GravediggerDatabase;

  beforeEach(() => {
    temporaryDatabase = createTemporaryDatabase();
    database = openDatabase(temporaryDatabase.path);
    database.prepare(
      'INSERT INTO people (jid, display_name, created_at) VALUES (?, ?, ?)',
    ).run('alice@s.whatsapp.net', 'Alice Builder', 10);
  });

  afterEach(() => {
    database.close();
    temporaryDatabase.cleanup();
  });

  test('stores source-bound observations and verified public context', () => {
    upsertParticipantProfile(database, {
      personId: 1,
      observedSummary: 'Maintains agent tooling and tests model-routing workflows.',
      publicIdentityName: 'Alice Builder',
      publicSummary: 'Maintainer of Example Tool.',
      publicSourceUrls: ['https://example.test/alice'],
      identityConfidence: 'verified',
      sourceMessageIds: [3, 8],
      updatedAt: 100,
    });

    expect(loadParticipantProfiles(database, [1])).toEqual([{
      personId: 1,
      displayName: 'Alice Builder',
      observedSummary: 'Maintains agent tooling and tests model-routing workflows.',
      publicIdentityName: 'Alice Builder',
      publicSummary: 'Maintainer of Example Tool.',
      publicSourceUrls: ['https://example.test/alice'],
      identityConfidence: 'verified',
      sourceMessageIds: [3, 8],
      updatedAt: 100,
    }]);
  });

  test('keeps unverified public identity context out of loaded editorial profiles', () => {
    upsertParticipantProfile(database, {
      personId: 1,
      observedSummary: 'Frequently discusses local models.',
      publicIdentityName: 'A possible name match',
      publicSummary: 'Could be a famous technologist.',
      publicSourceUrls: [],
      identityConfidence: 'unverified',
      sourceMessageIds: [4],
      updatedAt: 100,
    });

    expect(loadParticipantProfiles(database, [1])[0]).toMatchObject({
      publicIdentityName: null,
      publicSummary: null,
      publicSourceUrls: [],
      identityConfidence: 'unverified',
    });
  });
});
