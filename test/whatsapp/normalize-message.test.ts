import { readFileSync } from 'node:fs';

import type { WAMessage } from '@whiskeysockets/baileys';
import { describe, expect, test } from 'vitest';

import { normalizeMessage } from '../../src/whatsapp/normalize-message.js';

const groupJid = '120363000000000000@g.us';
const groupAllowlist = new Set([groupJid]);

function readFixture(name: string): WAMessage {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/whatsapp/${name}`, import.meta.url), 'utf8'),
  ) as WAMessage;
}

describe('normalizeMessage', () => {
  test('normalizes a group text message', () => {
    const result = normalizeMessage(readFixture('text-message.json'), groupAllowlist);

    expect(result).toEqual({
      status: 'normalized',
      message: {
        externalId: '3EB0TEXTMESSAGE0001',
        groupJid,
        senderJid: '64210000000@s.whatsapp.net',
        senderName: 'Redacted Person',
        timestampMs: 1_786_921_200_000,
        messageType: 'conversation',
        text: 'The link extraction path is the buried treasure.',
        quotedExternalId: null,
        rawJson: JSON.stringify(readFixture('text-message.json')),
      },
    });
  });

  test('preserves a reply edge from context info', () => {
    const result = normalizeMessage(readFixture('reply-message.json'), groupAllowlist);

    expect(result.status).toBe('normalized');
    if (result.status === 'normalized') {
      expect(result.message.quotedExternalId).toBe('3EB0TEXTMESSAGE0001');
      expect(result.message.text).toBe('Agreed; preserve the reply edge.');
    }
  });

  test('unwraps ephemeral content before extracting its type and text', () => {
    const fixture = readFixture('reply-message.json');
    const innerMessage = fixture.message;
    if (innerMessage === null || innerMessage === undefined) {
      throw new Error('reply fixture must contain message content');
    }
    fixture.message = {
      ephemeralMessage: {
        message: innerMessage,
      },
    };

    const result = normalizeMessage(fixture, groupAllowlist);

    expect(result.status).toBe('normalized');
    if (result.status === 'normalized') {
      expect(result.message.messageType).toBe('extendedTextMessage');
      expect(result.message.text).toBe('Agreed; preserve the reply edge.');
    }
  });

  test('keeps an image caption searchable while preserving the media type', () => {
    const result = normalizeMessage(
      readFixture('image-caption-message.json'),
      groupAllowlist,
    );

    expect(result.status).toBe('normalized');
    if (result.status === 'normalized') {
      expect(result.message.messageType).toBe('imageMessage');
      expect(result.message.text).toBe('A caption remains searchable.');
    }
  });

  test.each([
    ['external ID', (message: WAMessage) => delete message.key.id, 'missing_external_id'],
    ['group JID', (message: WAMessage) => delete message.key.remoteJid, 'missing_group_jid'],
    ['participant', (message: WAMessage) => delete message.key.participant, 'missing_participant'],
    ['timestamp', (message: WAMessage) => delete message.messageTimestamp, 'missing_timestamp'],
    ['content', (message: WAMessage) => delete message.message, 'missing_content'],
  ])('returns unsupported when the %s is missing', (_label, remove, reason) => {
    const fixture = readFixture('text-message.json');
    remove(fixture);

    expect(normalizeMessage(fixture, groupAllowlist)).toEqual({
      status: 'unsupported',
      reason,
    });
  });

  test('ignores a direct message', () => {
    const fixture = readFixture('text-message.json');
    fixture.key.remoteJid = '64210000000@s.whatsapp.net';

    expect(normalizeMessage(fixture, groupAllowlist)).toEqual({
      status: 'ignored',
      reason: 'not_group_message',
    });
  });

  test('ignores a group outside the configured allowlist', () => {
    expect(normalizeMessage(readFixture('text-message.json'), new Set())).toEqual({
      status: 'ignored',
      reason: 'not_allowlisted',
    });
  });

  test('raw JSON round-trips the complete original envelope', () => {
    const fixture = readFixture('reply-message.json');
    const result = normalizeMessage(fixture, groupAllowlist);

    expect(result.status).toBe('normalized');
    if (result.status === 'normalized') {
      expect(JSON.parse(result.message.rawJson)).toEqual(fixture);
    }
  });
});
