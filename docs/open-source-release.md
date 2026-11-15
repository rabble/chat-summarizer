# First public release preparation

This document is a release checklist, not authorization to change repository
visibility. The prepared source is licensed under GPL-3.0; publication is a separate step.

## Publication route

Publish a clean-history source snapshot. Do not simply change the development
repository's visibility: its historical planning documents contain personal
operating context and consent statements that are not public deployment policy.
Removing a file from the current tree does not remove it from older commits.

The export command creates a source archive from the committed tree, with no `.git`
history, local configuration, auth state, or databases. Extract it, review it, and
initialize a new repository for publication. Keep the private development history
private. The maintainer-selected destination is `rabble/chat-summarizer`, a personal
project. Stage the clean snapshot there privately until publication is approved.
The package repository URL targets that destination; Community Brief remains the
public-facing project name.

## Licensing

The project did not previously include a license. Baileys is MIT-licensed, but its
`libsignal` dependency declares GPL-3.0. `qrcode-terminal` also includes Apache-2.0
and third-party notices. Do not describe the entire distribution as MIT-only.
The maintainer chose GPL-3.0 for Community Brief. `LICENSE` contains the GPL version 3
text and `package.json` declares `GPL-3.0-only`. Preserve dependency license files
and copyright notices when distributing a combined installation.

See [libsignal's license](https://github.com/WhiskeySockets/libsignal-node/blob/master/LICENSE)
and [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html). Dependency metadata is not
a substitute for checking actual license files. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Before publication

- [x] Choose Community Brief as the public-facing name and GPL-3.0 as the license.
- [x] Add `LICENSE` and the package license declaration.
- [x] Confirm the public GitHub repository owner/name: `rabble/chat-summarizer`.
- [ ] Commit the prepared tree and run `npm run check`, `npm run build`, and `npm run release:check`.
- [ ] Run Gitleaks against reachable development history and the clean export.
- [ ] Verify no personal data, chat excerpts, auth material, invitation links, or local paths are included.
- [ ] Create the clean-history export; inspect the archive and test a fresh installation from it.
- [x] Inspect production dependency advisories and apply compatible patched releases.
- [ ] Obtain maintainer approval for the actual source snapshot and public destination.
- [ ] Initialize the new public repository from the approved export, not the private Git history.
- [ ] Enable private vulnerability reporting, secret scanning/push protection, and branch protection.
- [ ] Verify GitHub CI finishes successfully on the public repository.
- [ ] Publish the initial release/tag only after those checks; no npm publishing is configured.

Gitleaks is a credential-pattern scan, not proof that all sensitive material is absent.
The operator's real data and deployment configuration are never release artifacts.
