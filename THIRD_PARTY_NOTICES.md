# Third-party notices

Community Brief's application source is GPL-3.0-only. It installs third-party
packages through npm rather than vendoring their source into this repository.
Their own licenses and copyright notices remain applicable. Preserve the license
files supplied in installed packages when redistributing them; this summary does
not replace those files.

| Package | Declared license / notes |
| --- | --- |
| `@whiskeysockets/baileys` | MIT |
| `libsignal` (via Baileys) | GPL-3.0; Signal protocol implementation |
| `better-sqlite3` | MIT; includes its own SQLite third-party information |
| `commander` | MIT |
| `dotenv` | BSD-2-Clause |
| `pino` | MIT |
| `qrcode` | MIT |
| `qrcode-terminal` | Apache-2.0 package notice and MIT notice for included QR code code |
| `sharp` (Baileys peer) | Apache-2.0; platform `@img/sharp-libvips-*` packages declare LGPL-3.0-or-later |
| `zod` | MIT |

The `libsignal` upstream license identifies Open Whisper Systems (2015–2016) and
Forsta Inc (2017–2018). See its [source and license](https://github.com/WhiskeySockets/libsignal-node).
Baileys' MIT declaration does not remove the GPL obligations of its dependency.

The lockfile records the installed dependency versions. Inspect the full production
tree with `npm ls --omit=dev --all` and the corresponding license files under
`node_modules`; tooling and transitive dependencies carry their own notices too.

The GNU GPL license document is copyright the Free Software Foundation and is
included verbatim as permitted by that document. WhatsApp and Meta are trademarks
of their respective owners; no affiliation or endorsement is implied.
