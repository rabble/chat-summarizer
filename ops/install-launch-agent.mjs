import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const serviceLabel = 'org.communitybrief.agent';

export function prepareServiceFiles(projectRoot) {
  const data = join(projectRoot, 'data');
  mkdirSync(data, { recursive: true, mode: 0o700 });
  // mkdir's mode does not tighten a directory created during terminal pairing.
  chmodSync(data, 0o700);
  chmodSync(join(projectRoot, '.env'), 0o600);
}

export function renderLaunchAgent({ projectRoot, nodePath, userHome }) {
  for (const value of [projectRoot, nodePath, userHome]) {
    if (!isAbsolute(value)) throw new Error('Service paths must be absolute');
  }
  const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  const args = ['/usr/bin/env', '-i', `HOME=${userHome}`,
    'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', 'NODE_ENV=production',
    nodePath, '--enable-source-maps', join(projectRoot, 'dist/cli.js'), 'start'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${serviceLabel}</string>
  <key>ProgramArguments</key><array>
${args.map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${xml(projectRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Standard</string>
  <key>Umask</key><integer>63</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(projectRoot, 'data/service.stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(projectRoot, 'data/service.stderr.log'))}</string>
</dict></plist>
`;
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const plist = renderLaunchAgent({ projectRoot, nodePath: process.execPath, userHome: homedir() });
  if (process.argv[2] === '--print') {
    process.stdout.write(plist);
    return;
  }
  if (process.argv[2] !== '--install') throw new Error('Use --print or --install');
  if (process.platform !== 'darwin') throw new Error('LaunchAgents require macOS');
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Use Node.js 24 LTS');
  if (!existsSync(join(projectRoot, 'dist/cli.js'))) throw new Error('Run npm run build first');
  if (!existsSync(join(projectRoot, '.env'))) throw new Error('Configure .env first');
  const directory = join(homedir(), 'Library/LaunchAgents');
  const path = join(directory, `${serviceLabel}.plist`);
  if (existsSync(path)) throw new Error('Agent already exists; follow docs/operations.md to update it');
  mkdirSync(directory, { recursive: true });
  prepareServiceFiles(projectRoot);
  writeFileSync(path, plist, { flag: 'wx', mode: 0o600 });
  execFileSync('plutil', ['-lint', path], { stdio: 'inherit' });
  execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, path], { stdio: 'inherit' });
  console.log(`Installed ${serviceLabel}; see docs/operations.md for status and logs.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
