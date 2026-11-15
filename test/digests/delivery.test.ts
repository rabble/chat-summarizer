import { describe, expect, test } from 'vitest';

import {
  buildDigestDeliveries,
  buildDigestDelivery,
} from '../../src/digests/delivery.js';

describe('buildDigestDelivery', () => {
  test('binds digest text to one direct-message recipient', () => {
    expect(
      buildDigestDelivery('15550123456@s.whatsapp.net', '# Daily digest'),
    ).toEqual({
      recipientJid: '15550123456@s.whatsapp.net',
      message: { text: '# Daily digest' },
    });
  });

  test('rejects group destinations', () => {
    expect(() =>
      buildDigestDelivery('120363000000000000@g.us', '# Daily digest'),
    ).toThrow(/direct WhatsApp recipient/);
  });

  test('rejects an empty digest', () => {
    expect(() =>
      buildDigestDelivery('15550123456@s.whatsapp.net', '   '),
    ).toThrow(/empty digest/);
  });

  test('splits a newsletter into paced, numbered WhatsApp messages', () => {
    const deliveries = buildDigestDeliveries(
      '15550123456@s.whatsapp.net',
      `# Lead\n\n${'A'.repeat(70)}\n\n## Second\n\n${'B'.repeat(70)}`,
      100,
    );

    expect(deliveries.length).toBeGreaterThan(1);
    expect(deliveries.map((delivery) => delivery.recipientJid)).toEqual(
      deliveries.map(() => '15550123456@s.whatsapp.net'),
    );
    expect(deliveries[0]?.message.text).toMatch(/^Community Brief 1\/\d+\n\n# Lead/);
    expect(deliveries.at(-1)?.message.text).toMatch(/^Community Brief \d+\/\d+/);
    expect(deliveries.every((delivery) => delivery.message.text.length <= 100)).toBe(true);
  });

  test('allows only the explicitly configured summaries group across all chunks', () => {
    const deliveries = buildDigestDeliveries('121@g.us', 'Summary. '.repeat(40), 100, '121@g.us');
    expect(deliveries.length).toBeGreaterThan(1);
    expect(deliveries.every((delivery) => delivery.recipientJid === '121@g.us')).toBe(true);
    expect(deliveries.every((delivery) => delivery.message.text.length <= 100)).toBe(true);
    expect(() => buildDigestDelivery('122@g.us', 'Summary', '121@g.us')).toThrow();
  });
});
