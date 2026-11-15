import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts/check-public-source.mjs')], { cwd: root, stdio: 'inherit' });
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) {
  throw new Error('Commit the prepared source before exporting; local changes are not included by git archive');
}
const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const output = resolve(root, process.argv[2] ?? `artifacts/community-brief-${revision}.tar.gz`);
const archive = execFileSync('git', ['archive', '--format=tar.gz', '--prefix=community-brief/', 'HEAD'],
  { cwd: root, maxBuffer: 16 * 1024 * 1024 });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, archive, { flag: 'wx', mode: 0o600 });
console.log(`Clean-history source archive: ${output}\nSource revision: ${revision}\nThe archive contains no Git history. Review it before creating a public repository.`);
