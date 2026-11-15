import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import QRCode from 'qrcode';

export async function writePairingQr(
  encodedPairingData: string,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await QRCode.toFile(outputPath, encodedPairingData, {
    errorCorrectionLevel: 'M',
    margin: 2,
    type: 'png',
    width: 640,
  });
  await chmod(outputPath, 0o600);
}
