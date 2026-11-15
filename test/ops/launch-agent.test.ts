import { describe, expect, test } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareServiceFiles, renderLaunchAgent, serviceLabel } from '../../ops/install-launch-agent.mjs';

describe('portable LaunchAgent configuration', () => {
  test('uses supplied runtime paths with a clean environment and normal priority', () => {
    const xml = renderLaunchAgent({ projectRoot: '/srv/community brief', nodePath: '/opt/node/bin/node', userHome: '/srv/operator' });
    expect(xml).toContain(serviceLabel);
    expect(xml).toContain('/opt/node/bin/node');
    expect(xml).toContain('/srv/community brief/dist/cli.js');
    expect(xml).toContain('HOME=/srv/operator');
    expect(xml).toContain('<string>-i</string>');
    expect(xml).toContain('<string>Standard</string>');
    expect(xml).toContain('SuccessfulExit');
    expect(xml).toContain('<key>Umask</key><integer>63</integer>');
    expect(xml).toContain('/srv/community brief/data/service.stdout.log');
  });

  test('escapes XML metacharacters in paths and rejects relative paths', () => {
    const xml = renderLaunchAgent({ projectRoot: '/srv/team & friends/<brief>', nodePath: '/opt/node/bin/node', userHome: '/srv/operator' });
    expect(xml).toContain('/srv/team &amp; friends/&lt;brief&gt;');
    expect(() => renderLaunchAgent({ projectRoot: 'relative', nodePath: '/opt/node/bin/node', userHome: '/srv/operator' })).toThrow(/absolute/);
  });

  test('restricts an existing data directory and configuration before service startup', () => {
    const root = mkdtempSync(join(tmpdir(), 'community-brief-permissions-'));
    try {
      const data = join(root, 'data');
      const env = join(root, '.env');
      mkdirSync(data);
      writeFileSync(env, 'synthetic-configuration');
      chmodSync(data, 0o755);
      chmodSync(env, 0o644);
      prepareServiceFiles(root);
      expect(statSync(data).mode & 0o777).toBe(0o700);
      expect(statSync(env).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
