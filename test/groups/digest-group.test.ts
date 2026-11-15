import { describe, expect, test } from 'vitest';
import { validateDigestGroup } from '../../src/groups/digest-group.js';

describe('summaries destination permissions', () => {
  const group = { id: '121@g.us', announce: true, participants: [{ id: '15550123456@s.whatsapp.net', admin: 'admin' as const }] };
  const ownJids = ['15550123456:2@s.whatsapp.net'];
  test('accepts a normalized bot identity with posting permission', () => {
    expect(() => validateDigestGroup(group, group.id, ownJids)).not.toThrow();
  });
  test('rejects another room, a community parent, and community announcements', () => {
    expect(() => validateDigestGroup(group, '122@g.us', ownJids)).toThrow();
    expect(() => validateDigestGroup({ ...group, isCommunity: true }, group.id, ownJids)).toThrow();
    expect(() => validateDigestGroup({ ...group, isCommunityAnnounce: true }, group.id, ownJids)).toThrow();
  });
  test('rejects missing membership and non-admin bots in admin-only rooms', () => {
    expect(() => validateDigestGroup({ ...group, participants: [] }, group.id, ownJids)).toThrow();
    expect(() => validateDigestGroup({ ...group, participants: [{ id: '15550123456@s.whatsapp.net' }] }, group.id, ownJids)).toThrow();
  });
});
