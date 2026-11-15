import { describe, expect, test } from 'vitest';

import {
  buildNewsletterSystemPrompt,
  buildNewsletterUserPrompt,
  ensureNewsletterLinks,
  isNewsletterQuestion,
  stripNewsletterCitations,
} from '../../src/digests/newsletter.js';

describe('newsletter editorial contract', () => {
  test('community editions follow Chatham House rules without attribution instructions', () => {
    const prompt = buildNewsletterSystemPrompt(true);
    expect(prompt).toContain('Chatham House');
    expect(prompt).toContain('never identify speakers');
    expect(prompt).not.toContain('Attribute consequential claims');
  });
  test('recognizes broad briefing requests without hijacking focused questions', () => {
    expect(isNewsletterQuestion('What are the AGI rooms discussing?')).toBe(true);
    expect(isNewsletterQuestion('Give me a Techmeme-style newsletter')).toBe(true);
    expect(isNewsletterQuestion('Summarize the last week')).toBe(true);
    expect(isNewsletterQuestion('Was QwenPrime mentioned?')).toBe(false);
  });

  test('requires a story-first briefing instead of a transcript or work report', () => {
    const system = buildNewsletterSystemPrompt();

    expect(system).toContain('technology editor');
    expect(system).toContain('one lead story');
    expect(system).toContain('What changed');
    expect(system).toContain('Why it matters');
    expect(system).toContain('preserve disagreement');
    expect(system).toContain('Attribute consequential claims');
    expect(system).toContain('participant display name');
    expect(system).toContain('Never print participant JIDs or phone numbers');
    expect(system).toContain('Do not produce a chronological transcript recap');
    expect(system).toContain('Never mention GRAVEDIGGER setup');
    expect(system).toContain('[message:<id>]');
    expect(system).toContain(
      'State clearly when material is uncited, unsourced, or missing a source',
    );
  });

  test('wraps source evidence in a fixed editorial structure with optional sections', () => {
    const prompt = buildNewsletterUserPrompt(
      'Evidence:\n[message:7] A useful claim',
      ['https://github.com/example/tool'],
    );

    expect(prompt).toContain('THE BIG STORY');
    expect(prompt).toContain('ALSO MOVING');
    expect(prompt).toContain('LINKS WORTH OPENING');
    expect(prompt).toContain('WATCH NEXT');
    expect(prompt).toContain('actual shared URL');
    expect(prompt).toContain('apps, repositories, models, papers, or services');
    expect(prompt).toContain('Evidence:\n[message:7] A useful claim');
    expect(prompt).toContain('https://github.com/example/tool');
    expect(prompt).toContain('Omit weak sections');
  });

  test('removes internal source markers from reader-facing copy', () => {
    expect(stripNewsletterCitations([
      'The stack is unbundling. [message:36] [message:23] [message:21]',
      '',
      'A second paragraph remains readable.[message:99]',
    ].join('\n'))).toBe([
      'The stack is unbundling.',
      '',
      'A second paragraph remains readable.',
    ].join('\n'));
  });

  test('guarantees shared URLs remain available when the editor omits them', () => {
    expect(ensureNewsletterLinks(
      'THE BIG STORY\n\nA coherent story.',
      ['https://example.test/app', 'https://github.com/example/code'],
    )).toContain([
      'LINKS WORTH OPENING',
      '',
      '• https://example.test/app',
      '• https://github.com/example/code',
    ].join('\n'));

    expect(ensureNewsletterLinks(
      'LINKS WORTH OPENING\n\nhttps://example.test/app',
      ['https://example.test/app'],
    )).toBe('LINKS WORTH OPENING\n\nhttps://example.test/app');
  });

  test('repairs named link bullets even when another URL is already present', () => {
    const result = ensureNewsletterLinks(
      'Read https://example.test/already\nLINKS WORTH OPENING\n• How Codex Happened\n• RevEngine\n• Rat Stack\n• dspy-wsp',
      ['https://every.to/p/how-codex-happened', 'https://www.laude.org/updates/lab-notes/revengine', 'https://ratstack.sh/', 'https://github.com/cmpnd-ai/dspy-wsp'],
    );
    expect(result).toContain('• How Codex Happened https://every.to/p/how-codex-happened');
    expect(result).toContain('• Rat Stack https://ratstack.sh/');
    expect(result).toContain('• dspy-wsp https://github.com/cmpnd-ai/dspy-wsp');
    expect(result).toContain('https://www.laude.org/updates/lab-notes/revengine');
  });

  test('does not let one existing URL suppress other source links', () => {
    const result = ensureNewsletterLinks('One link: https://example.test/a',
      ['https://example.test/a', 'https://example.test/b']);
    expect(result).toContain('https://example.test/b');
  });
});
