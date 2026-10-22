import { db } from '../db';
import type { RunMediaRecord } from '../types';

/** 只在本机读取配音 Blob；不存在时返回 undefined，由调用方决定阻塞。 */
export async function getRunVoiceMedia(runId: string): Promise<RunMediaRecord | undefined> {
  return db.runMedia
    .where('runId')
    .equals(runId)
    .and((record) => record.kind === 'voiceover')
    .first();
}

export async function deleteRunMedia(runId: string): Promise<void> {
  await db.runMedia.where('runId').equals(runId).delete();
}
