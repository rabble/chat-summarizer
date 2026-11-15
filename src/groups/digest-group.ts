import { jidNormalizedUser, type GroupMetadata } from '@whiskeysockets/baileys';

export function validateDigestGroup(
  group: Pick<GroupMetadata, 'id' | 'isCommunity' | 'isCommunityAnnounce' | 'announce' | 'participants'>,
  configuredJid: string,
  ownJids: readonly string[],
): void {
  if (group.id !== configuredJid || group.isCommunity || group.isCommunityAnnounce) {
    throw new Error('Digest destination must be the configured ordinary summaries group');
  }
  const normalized = new Set(ownJids.map(jidNormalizedUser));
  const member = group.participants.find((participant) =>
    [participant.id, participant.lid, participant.phoneNumber].some((jid) =>
      typeof jid === 'string' && normalized.has(jidNormalizedUser(jid)),
    ),
  );
  if (member === undefined || (group.announce && !member.admin)) {
    throw new Error('The bot is not permitted to post in the summaries group');
  }
}
