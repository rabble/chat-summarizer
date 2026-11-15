import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { scanPublicFiles } from '../../scripts/check-public-source.mjs';

describe('public source boundaries', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'community-brief-release-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('permits synthetic example configuration', () => {
    writeFileSync(join(root, '.env.example'), 'GRAVEDIGGER_GROUP_JIDS=120363000000000000@g.us');
    expect(scanPublicFiles(root, ['.env.example'])).toEqual([]);
  });

  test('rejects private files without printing their contents', () => {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data/creds.json'), 'private-session-sentinel');
    writeFileSync(join(root, '.env'), 'credential-sentinel');
    writeFileSync(join(root, 'deployment.env'), 'configuration-sentinel');
    const findings = scanPublicFiles(root, ['data/creds.json', '.env', 'deployment.env']);
    expect(findings).toHaveLength(3);
    expect(JSON.stringify(findings)).not.toContain('sentinel');
  });

  test('rejects a credential-like value and a non-placeholder group identifier', () => {
    const token = 'sk-or-v1-' + 'x'.repeat(48);
    const id = '120363' + '123456789012';
    writeFileSync(join(root, 'example.txt'), `${token}\n${id}@g.us`);
    const findings = scanPublicFiles(root, ['example.txt']);
    expect(findings.map((item) => item.reason)).toContain('credential-like value');
    expect(findings.map((item) => item.reason)).toContain('non-placeholder community group identifier');
    expect(JSON.stringify(findings)).not.toContain(token);
    expect(JSON.stringify(findings)).not.toContain(id);
  });

  test('refuses to export committed private environment configuration', () => {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'docs'));
    for (const script of ['check-public-source.mjs', 'export-public-source.mjs']) {
      copyFileSync(new URL(`../../scripts/${script}`, import.meta.url), join(root, 'scripts', script));
    }
    for (const file of ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md',
      'THIRD_PARTY_NOTICES.md', 'docs/privacy.md']) {
      writeFileSync(join(root, file), 'Synthetic release fixture');
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify({ license: 'GPL-3.0-only' }));
    writeFileSync(join(root, 'deployment.env'), 'private-configuration-sentinel');
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git(['init', '--initial-branch=main']);
    git(['add', '.']);
    git(['-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-m', 'Synthetic release fixture']);
    const result = spawnSync(process.execPath, ['scripts/export-public-source.mjs'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('deployment.env: private runtime/configuration file');
    expect(result.stderr).not.toContain('private-configuration-sentinel');
    expect(existsSync(join(root, 'artifacts'))).toBe(false);
  });
});
