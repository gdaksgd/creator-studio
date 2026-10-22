import type { RunVoiceBoundary, RunVoiceSettings } from '../types';

export const TTS_WORKER_KEY = 'creator-studio-tts-worker';
export const DEFAULT_TTS_WORKER = 'http://127.0.0.1:3101';

export const TTS_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 女声' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 女声' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 男声' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 男声' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 男声' },
] as const;

export const TTS_RATES = ['-10%', '+0%', '+10%', '+20%'] as const;
export const TTS_PITCHES = ['-2Hz', '+0Hz', '+2Hz'] as const;

export const DEFAULT_VOICE_SETTINGS: RunVoiceSettings = {
  voice: TTS_VOICES[0].id,
  rate: '+0%',
  pitch: '+0Hz',
};

export function getTtsWorkerUrl(): string {
  try {
    return localStorage.getItem(TTS_WORKER_KEY)?.trim() || DEFAULT_TTS_WORKER;
  } catch {
    return DEFAULT_TTS_WORKER;
  }
}

export interface TtsHealth {
  ok: boolean;
  provider?: string;
  voices?: string[];
  error?: string;
  workerUrl: string;
}

export interface SynthesizeResult {
  blob: Blob;
  mime: string;
  durationSec: number;
  boundaries: RunVoiceBoundary[];
  provider: string;
  voice: string;
  rate: string;
  pitch: string;
  timingSource: 'tts-sentence' | 'estimated';
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function checkTtsWorker(): Promise<TtsHealth> {
  const workerUrl = getTtsWorkerUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${workerUrl}/health`, { signal: controller.signal });
    const data = (await response.json()) as {
      ok?: boolean;
      provider?: string;
      voices?: string[];
      error?: string;
    };
    if (!response.ok || !data.ok) {
      return { ok: false, error: data.error || `Worker HTTP ${response.status}`, workerUrl };
    }
    return {
      ok: true,
      provider: data.provider ?? 'edge-tts',
      voices: Array.isArray(data.voices) ? data.voices : [],
      workerUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        (error as Error).name === 'AbortError'
          ? 'TTS worker 连接超时'
          : `TTS worker 未运行：${(error as Error).message}`,
      workerUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeVoice(
  text: string,
  settings: { voice: string; rate: string; pitch: string },
): Promise<SynthesizeResult> {
  if (!text.trim()) throw new Error('脚本没有可配音的台词');
  const workerUrl = getTtsWorkerUrl();
  const response = await fetch(`${workerUrl}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice: settings.voice,
      rate: settings.rate,
      pitch: settings.pitch,
    }),
  });
  let data: {
    ok?: boolean;
    error?: string;
    audioBase64?: string;
    mime?: string;
    durationSec?: number;
    provider?: string;
    timingSource?: string;
    boundaries?: Array<{ startMs?: number; endMs?: number; text?: string }>;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new Error(`TTS worker 返回了非 JSON 响应（HTTP ${response.status}）`);
  }
  if (!response.ok || !data.ok || !data.audioBase64) {
    throw new Error(data.error || `TTS worker 合成失败（HTTP ${response.status}）`);
  }
  const bytes = base64ToBytes(data.audioBase64);
  if (!bytes.length) throw new Error('TTS worker 返回了空音频');
  const boundaries: RunVoiceBoundary[] = Array.isArray(data.boundaries)
    ? data.boundaries
        .map((boundary) => ({
          startMs: Number(boundary.startMs ?? 0),
          endMs: Number(boundary.endMs ?? 0),
          text: String(boundary.text ?? '').trim(),
        }))
        .filter((boundary) => boundary.text && boundary.endMs > boundary.startMs)
    : [];
  return {
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: data.mime || 'audio/mpeg' }),
    mime: data.mime || 'audio/mpeg',
    durationSec: Number(data.durationSec ?? 0),
    boundaries,
    provider: data.provider || 'edge-tts',
    voice: settings.voice,
    rate: settings.rate,
    pitch: settings.pitch,
    timingSource: data.timingSource === 'tts-sentence' ? 'tts-sentence' : 'estimated',
  };
}
