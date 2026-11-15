import { z } from 'zod';

import type { GravediggerDatabase } from '../db/database.js';

export type IdentityConfidence = 'unverified' | 'probable' | 'verified';

export type ParticipantProfileInput = {
  personId: number;
  observedSummary: string;
  publicIdentityName: string | null;
  publicSummary: string | null;
  publicSourceUrls: readonly string[];
  identityConfidence: IdentityConfidence;
  sourceMessageIds: readonly number[];
  updatedAt: number;
};

export type ParticipantProfile = ParticipantProfileInput & {
  displayName: string;
  publicSourceUrls: string[];
  sourceMessageIds: number[];
};

type ProfileRow = {
  person_id: number;
  display_name: string;
  observed_summary: string;
  public_identity_name: string | null;
  public_summary: string | null;
  public_source_urls_json: string;
  identity_confidence: IdentityConfidence;
  source_message_ids_json: string;
  updated_at: number;
};

const stringArraySchema = z.array(z.string());
const numberArraySchema = z.array(z.number().int().positive());

export function upsertParticipantProfile(
  database: GravediggerDatabase,
  profile: ParticipantProfileInput,
): void {
  database.prepare(
    `INSERT INTO participant_profiles (
       person_id, observed_summary, public_identity_name, public_summary,
       public_source_urls_json, identity_confidence,
       source_message_ids_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (person_id) DO UPDATE SET
       observed_summary = excluded.observed_summary,
       public_identity_name = excluded.public_identity_name,
       public_summary = excluded.public_summary,
       public_source_urls_json = excluded.public_source_urls_json,
       identity_confidence = excluded.identity_confidence,
       source_message_ids_json = excluded.source_message_ids_json,
       updated_at = excluded.updated_at`,
  ).run(
    profile.personId,
    profile.observedSummary,
    profile.publicIdentityName,
    profile.publicSummary,
    JSON.stringify(profile.publicSourceUrls),
    profile.identityConfidence,
    JSON.stringify(profile.sourceMessageIds),
    profile.updatedAt,
  );
}

export function loadParticipantProfiles(
  database: GravediggerDatabase,
  personIds: readonly number[],
): ParticipantProfile[] {
  if (personIds.length === 0) return [];
  const placeholders = personIds.map(() => '?').join(', ');
  const rows = database.prepare(
    `SELECT pp.person_id,
            coalesce(p.display_name, 'Unknown participant') AS display_name,
            pp.observed_summary, pp.public_identity_name, pp.public_summary,
            pp.public_source_urls_json, pp.identity_confidence,
            pp.source_message_ids_json, pp.updated_at
       FROM participant_profiles pp
       JOIN people p ON p.id = pp.person_id
      WHERE pp.person_id IN (${placeholders})
      ORDER BY pp.person_id`,
  ).all(...personIds) as ProfileRow[];

  return rows.map((row) => {
    const verified = row.identity_confidence === 'verified';
    return {
      personId: row.person_id,
      displayName: row.display_name,
      observedSummary: row.observed_summary,
      publicIdentityName: verified ? row.public_identity_name : null,
      publicSummary: verified ? row.public_summary : null,
      publicSourceUrls: verified
        ? stringArraySchema.parse(JSON.parse(row.public_source_urls_json))
        : [],
      identityConfidence: row.identity_confidence,
      sourceMessageIds: numberArraySchema.parse(
        JSON.parse(row.source_message_ids_json),
      ),
      updatedAt: row.updated_at,
    };
  });
}
