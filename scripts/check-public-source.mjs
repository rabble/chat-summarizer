import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function collectSourceFiles(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (resolve(top) === resolve(root)) {
      return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
    }
  } catch { /* A source archive has no Git metadata. */ }
  const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', 'artifacts', '.claude']);
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return [relative(root, path).split('\\').join('/')];
  });
  return walk(root);
}

export function scanPublicFiles(root, files) {
  const findings = [];
  for (const file of files) {
    if (!existsSync(join(root, file))) continue;
    if (/^(?:data|auth|artifacts)\//.test(file) ||
        /(?:^|\/)(?:creds\.json|\.env(?:\..*)?)$/.test(file) && file !== '.env.example' ||
        /\.env$/.test(file) ||
        /\.(?:sqlite(?:-(?:wal|shm))?|db|log|pem|key)$/.test(file)) {
      findings.push({ path: file, reason: 'private runtime/configuration file' });
      continue;
    }
    const text = readFileSync(join(root, file), 'utf8');
    if (/\/Users\/(?!example\/|YOUR_USERNAME\/)[a-zA-Z0-9_-]+\//.test(text)) {
      findings.push({ path: file, reason: 'personal absolute home path' });
    }
    if (/https:\/\/chat\.whatsapp\.com\/[a-zA-Z0-9]{12,}/.test(text)) {
      findings.push({ path: file, reason: 'WhatsApp invitation URL' });
    }
    if ([...text.matchAll(/\b(\d{14,20})@g\.us/g)].some((match) =>
      !/^120363(?:0+|9+)$/.test(match[1]))) {
      findings.push({ path: file, reason: 'non-placeholder community group identifier' });
    }
    if (/(?:sk-or-v1-[a-zA-Z0-9]{24,}|gh[opusr]_[a-zA-Z0-9]{24,}|lr_[a-zA-Z0-9]{32,})/.test(text)) {
      findings.push({ path: file, reason: 'credential-like value' });
    }
  }
  return findings;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = collectSourceFiles(root);
  const findings = scanPublicFiles(root, files);
  for (const required of ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md',
    'THIRD_PARTY_NOTICES.md', 'docs/privacy.md']) {
    if (!existsSync(join(root, required))) findings.push({ path: required, reason: 'required release file missing' });
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.license !== 'GPL-3.0-only') findings.push({ path: 'package.json', reason: 'unexpected license declaration' });
  if (findings.length > 0) {
    // Print paths and reasons, never matched credentials or message content.
    for (const item of findings) console.error(`${item.path}: ${item.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Public-source checks passed for ${files.filter((file) => existsSync(join(root, file))).length} files. Run a full-history credential scan separately.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
