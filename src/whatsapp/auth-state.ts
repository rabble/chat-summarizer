import { chmod, mkdir } from 'node:fs/promises';

import {
  useMultiFileAuthState,
  type AuthenticationCreds,
  type AuthenticationState,
} from '@whiskeysockets/baileys';

export type PersistedAuthState = {
  state: AuthenticationState;
  updateAndSave: (update: Partial<AuthenticationCreds>) => Promise<void>;
};

export async function loadAuthState(directory: string): Promise<PersistedAuthState> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const { state, saveCreds } = await useMultiFileAuthState(directory);

  return {
    state,
    updateAndSave: async (update) => {
      Object.assign(state.creds, update);
      await saveCreds();
    },
  };
}

