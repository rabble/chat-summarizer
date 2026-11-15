import { z } from 'zod';

const additionalDigestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).refine((id) => id !== 'primary'),
  recipient: z.string().regex(/^\+[1-9]\d{7,14}$/)
    .transform((number) => `${number.slice(1)}@s.whatsapp.net`),
  timeZone: z.string().refine(isTimeZone, 'must be an IANA time zone'),
  hour: z.number().int().min(0).max(23).default(8),
  minute: z.number().int().min(0).max(59).default(0),
  lookbackHours: z.number().int().min(1).max(168).default(24),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const environmentSchema = z.object({
  GRAVEDIGGER_DATABASE_PATH: z.string().trim().min(1),
  GRAVEDIGGER_AUTH_DIR: z.string().trim().min(1),
  GRAVEDIGGER_GROUP_JIDS: z
    .string()
    .transform((value) => value.split(',').map((jid) => jid.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.string().endsWith('@g.us'))
        .min(1, 'GRAVEDIGGER_GROUP_JIDS must contain at least one group JID'),
    ),
  GRAVEDIGGER_DIGEST_RECIPIENT: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number')
    .transform((number) => `${number.slice(1)}@s.whatsapp.net`),
  GRAVEDIGGER_DIGEST_GROUP_JID: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().regex(/^\d+(?:-\d+)?@g\.us$/).optional(),
  ),
  LUNAROUTE_API_KEY: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().startsWith('lr_').optional(),
  ),
  LUNAROUTE_MODEL: z.string().trim().min(1).default('deepseek-4.1-flash'),
  OPENROUTER_API_KEY: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim().length === 0 ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  OPENROUTER_MODEL: z
    .string()
    .trim()
    .min(1)
    .default('deepseek/deepseek-v4-flash-0731'),
  GRAVEDIGGER_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  GRAVEDIGGER_AUTO_DIGEST_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  GRAVEDIGGER_DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  GRAVEDIGGER_DIGEST_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  GRAVEDIGGER_DIGEST_TIME_ZONE: z.string().trim().min(1).default('Pacific/Auckland')
    .refine(isTimeZone, 'must be an IANA time zone'),
  GRAVEDIGGER_DIGEST_LOOKBACK_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  GRAVEDIGGER_ADDITIONAL_DIGESTS: z.preprocess(
    (value) => typeof value === 'string' ? JSON.parse(value.trim() || '[]') : value ?? [],
    z.array(additionalDigestSchema).refine((items) => new Set(items.map((item) => item.id)).size === items.length,
      'additional digest IDs must be unique'),
  ),
});

export type Config = {
  databasePath: string;
  authDir: string;
  groupJids: ReadonlySet<string>;
  digestRecipientJid: string;
  digestGroupJid?: string;
  additionalDigests?: z.infer<typeof additionalDigestSchema>[];
  openRouterApiKey: string | undefined;
  openRouterModel: string;
  logLevel: z.infer<typeof environmentSchema>['GRAVEDIGGER_LOG_LEVEL'];
  automaticDigestEnabled: boolean;
  digestHour: number;
  digestMinute: number;
  digestTimeZone: string;
  digestLookbackHours: number;
};

export function loadConfig(
  environment: Record<string, string | undefined>,
): Config {
  const parsed = environmentSchema.parse(environment);
  if (parsed.GRAVEDIGGER_DIGEST_GROUP_JID !== undefined &&
      parsed.GRAVEDIGGER_GROUP_JIDS.includes(parsed.GRAVEDIGGER_DIGEST_GROUP_JID)) {
    throw new Error('GRAVEDIGGER_DIGEST_GROUP_JID must not be in GRAVEDIGGER_GROUP_JIDS');
  }

  return {
    databasePath: parsed.GRAVEDIGGER_DATABASE_PATH,
    authDir: parsed.GRAVEDIGGER_AUTH_DIR,
    groupJids: new Set(parsed.GRAVEDIGGER_GROUP_JIDS),
    digestRecipientJid: parsed.GRAVEDIGGER_DIGEST_RECIPIENT,
    ...(parsed.GRAVEDIGGER_ADDITIONAL_DIGESTS.length === 0 ? {} : {
      additionalDigests: parsed.GRAVEDIGGER_ADDITIONAL_DIGESTS,
    }),
    ...(parsed.GRAVEDIGGER_DIGEST_GROUP_JID === undefined ? {} : {
      digestGroupJid: parsed.GRAVEDIGGER_DIGEST_GROUP_JID,
    }),
    // Keep the existing internal field names for callers; the credential prefix
    // selects the transport in the shared model client.
    openRouterApiKey: parsed.LUNAROUTE_API_KEY ?? parsed.OPENROUTER_API_KEY,
    openRouterModel: parsed.LUNAROUTE_API_KEY === undefined
      ? parsed.OPENROUTER_MODEL : parsed.LUNAROUTE_MODEL,
    logLevel: parsed.GRAVEDIGGER_LOG_LEVEL,
    automaticDigestEnabled: parsed.GRAVEDIGGER_AUTO_DIGEST_ENABLED,
    digestHour: parsed.GRAVEDIGGER_DIGEST_HOUR,
    digestMinute: parsed.GRAVEDIGGER_DIGEST_MINUTE,
    digestTimeZone: parsed.GRAVEDIGGER_DIGEST_TIME_ZONE,
    digestLookbackHours: parsed.GRAVEDIGGER_DIGEST_LOOKBACK_HOURS,
  };
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
