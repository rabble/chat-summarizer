import {
  getContentType,
  normalizeMessageContent,
  type WAMessage,
  type WAMessageContent,
} from '@whiskeysockets/baileys';

export type NormalizedMessage = {
  externalId: string;
  groupJid: string;
  senderJid: string;
  senderName: string | null;
  timestampMs: number;
  messageType: string;
  text: string | null;
  quotedExternalId: string | null;
  rawJson: string;
};

export type NormalizeResult =
  | { status: 'normalized'; message: NormalizedMessage }
  | { status: 'ignored'; reason: 'not_group_message' | 'not_allowlisted' }
  | { status: 'unsupported'; reason: string };

type ContextBearingContent = {
  contextInfo?: { stanzaId?: string | null } | null;
};

type LongLike = {
  low?: number;
  high?: number;
  unsigned?: boolean;
  toNumber?: () => number;
};

export function normalizeMessage(
  message: WAMessage,
  groupAllowlist: ReadonlySet<string>,
): NormalizeResult {
  const externalId = nonEmptyString(message.key.id);
  if (externalId === null) {
    return { status: 'unsupported', reason: 'missing_external_id' };
  }

  const groupJid = nonEmptyString(message.key.remoteJid);
  if (groupJid === null) {
    return { status: 'unsupported', reason: 'missing_group_jid' };
  }
  if (!groupJid.endsWith('@g.us')) {
    return { status: 'ignored', reason: 'not_group_message' };
  }
  if (!groupAllowlist.has(groupJid)) {
    return { status: 'ignored', reason: 'not_allowlisted' };
  }

  const senderJid = nonEmptyString(message.key.participant ?? message.participant);
  if (senderJid === null) {
    return { status: 'unsupported', reason: 'missing_participant' };
  }

  if (message.messageTimestamp === null || message.messageTimestamp === undefined) {
    return { status: 'unsupported', reason: 'missing_timestamp' };
  }
  const timestampMs = timestampToMilliseconds(message.messageTimestamp);
  if (timestampMs === null) {
    return { status: 'unsupported', reason: 'invalid_timestamp' };
  }

  const content = normalizeMessageContent(message.message);
  if (content === undefined) {
    return { status: 'unsupported', reason: 'missing_content' };
  }

  const messageType = getContentType(content);
  if (messageType === undefined) {
    return { status: 'unsupported', reason: 'unknown_content_type' };
  }

  const extracted = extractSearchableContent(content, messageType);

  return {
    status: 'normalized',
    message: {
      externalId,
      groupJid,
      senderJid,
      senderName: nonEmptyString(message.pushName),
      timestampMs,
      messageType,
      text: extracted.text,
      quotedExternalId: extracted.quotedExternalId,
      rawJson: serializeEnvelope(message),
    },
  };
}

function extractSearchableContent(
  content: WAMessageContent,
  messageType: keyof WAMessageContent,
): { text: string | null; quotedExternalId: string | null } {
  switch (messageType) {
    case 'conversation':
      return {
        text: nonEmptyString(content.conversation),
        quotedExternalId: null,
      };
    case 'extendedTextMessage':
      return fromContextBearingContent(content.extendedTextMessage, 'text');
    case 'imageMessage':
      return fromContextBearingContent(content.imageMessage, 'caption');
    case 'videoMessage':
      return fromContextBearingContent(content.videoMessage, 'caption');
    case 'documentMessage':
      return fromContextBearingContent(content.documentMessage, 'caption');
    case 'buttonsResponseMessage':
      return fromContextBearingContent(
        content.buttonsResponseMessage,
        'selectedDisplayText',
      );
    default: {
      const candidate = content[messageType] as ContextBearingContent | null | undefined;
      return {
        text: null,
        quotedExternalId: nonEmptyString(candidate?.contextInfo?.stanzaId),
      };
    }
  }
}

function fromContextBearingContent<
  T extends ContextBearingContent,
  K extends keyof T,
>(
  content: T | null | undefined,
  textKey: K,
): { text: string | null; quotedExternalId: string | null } {
  return {
    text: nonEmptyString(content?.[textKey]),
    quotedExternalId: nonEmptyString(content?.contextInfo?.stanzaId),
  };
}

function timestampToMilliseconds(value: number | LongLike): number | null {
  let seconds: number;

  if (typeof value === 'number') {
    seconds = value;
  } else if (typeof value.toNumber === 'function') {
    seconds = value.toNumber();
  } else if (typeof value.low === 'number' && typeof value.high === 'number') {
    const combined =
      (BigInt(value.high >>> 0) << 32n) | BigInt(value.low >>> 0);
    if (combined > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    seconds = Number(combined);
  } else {
    return null;
  }

  const milliseconds = seconds * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function serializeEnvelope(message: WAMessage): string {
  return JSON.stringify(message, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}
