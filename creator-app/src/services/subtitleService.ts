import type {
  Platform,
  RunSubtitleCue,
  RunSubtitles,
  RunVoiceBoundary,
  Script,
  SubtitlePresetId,
} from '../types';

export interface SubtitlePreset {
  id: SubtitlePresetId;
  label: string;
  maxLineChars: number;
  maxLines: number;
  maxCharsPerSecond: number;
}

export const SUBTITLE_PRESETS: Record<SubtitlePresetId, SubtitlePreset> = {
  bilibili: {
    id: 'bilibili',
    label: 'B站 · 18 字/行 · 最多 2 行',
    maxLineChars: 18,
    maxLines: 2,
    maxCharsPerSecond: 12,
  },
  douyin: {
    id: 'douyin',
    label: '抖音 · 12 字/行 · 最多 2 行',
    maxLineChars: 12,
    maxLines: 2,
    maxCharsPerSecond: 14,
  },
};

export function subtitlePresetForPlatform(platform: Platform): SubtitlePresetId {
  return platform === 'douyin' ? 'douyin' : 'bilibili';
}

export function buildVoiceScript(script: Pick<Script, 'storyboards'>): string {
  return [...script.storyboards]
    .sort((a, b) => a.sceneNumber - b.sceneNumber)
    .map((board) => board.dialogue.trim())
    .filter(Boolean)
    .join('\n');
}

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

function splitCueText(text: string, maxChars: number): string[] {
  const chars = [...stripWhitespace(text)];
  if (!chars.length) return [];
  const chunks: string[] = [];
  while (chars.length) {
    let take = Math.min(maxChars, chars.length);
    if (take < chars.length) {
      const window = chars.slice(0, take);
      let cut = -1;
      for (let index = window.length - 1; index >= Math.floor(maxChars * 0.5); index -= 1) {
        if (/[，。！？；：、,.!?;:]/u.test(window[index] ?? '')) {
          cut = index + 1;
          break;
        }
      }
      if (cut > 0) take = cut;
    }
    const chunk = chars.splice(0, take).join('').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function wrapCueText(text: string, preset: SubtitlePreset): string {
  let remaining = [...text];
  if (remaining.length <= preset.maxLineChars) return text;
  const lines: string[] = [];
  while (remaining.length && lines.length < preset.maxLines) {
    if (remaining.length <= preset.maxLineChars) {
      lines.push(remaining.join('').trim());
      remaining = [];
      break;
    }
    const remainingLines = preset.maxLines - lines.length;
    const minCut = Math.max(1, remaining.length - preset.maxLineChars * (remainingLines - 1));
    const maxCut = Math.min(preset.maxLineChars, remaining.length);
    let cut = maxCut;
    // 优先在标点处换行，但必须保证剩余字符能放进剩下的行。
    for (let index = maxCut - 1; index >= minCut; index -= 1) {
      if (/[，。！？；：、,.!?;:—]/u.test(remaining[index] ?? '')) {
        cut = index + 1;
        break;
      }
    }
    const line = remaining.slice(0, cut).join('').trim();
    if (line) lines.push(line);
    remaining = remaining.slice(cut);
  }
  // 超出 maxLines 的部分不允许被静默丢弃；整段保留，交给质量检查报超长。
  if (remaining.length) return text;
  return lines.join('\n');
}

export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

export function srtFromCues(cues: RunSubtitleCue[]): string {
  return `${cues
    .map(
      (cue) =>
        `${cue.index}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}`,
    )
    .join('\n\n')}\n`;
}

export interface SubtitleStats {
  cueCount: number;
  charCount: number;
  maxLineChars: number;
  maxCharsPerSecond: number;
  overlongCues: number;
  fastCues: number;
}

export function computeSubtitleStats(cues: RunSubtitleCue[], preset: SubtitlePreset): SubtitleStats {
  let maxLineChars = 0;
  let maxCharsPerSecond = 0;
  let overlongCues = 0;
  let fastCues = 0;
  let charCount = 0;
  for (const cue of cues) {
    const chars = stripWhitespace(cue.text).length;
    charCount += chars;
    const lines = cue.text.split('\n');
    const longest = Math.max(...lines.map((line) => [...line].length));
    maxLineChars = Math.max(maxLineChars, longest);
    if (lines.some((line) => [...line].length > preset.maxLineChars)) overlongCues += 1;
    const seconds = Math.max(0.1, (cue.endMs - cue.startMs) / 1000);
    const speed = chars / seconds;
    maxCharsPerSecond = Math.max(maxCharsPerSecond, speed);
    if (speed > preset.maxCharsPerSecond) fastCues += 1;
  }
  return { cueCount: cues.length, charCount, maxLineChars, maxCharsPerSecond, overlongCues, fastCues };
}

function finalizeSubtitles(
  cues: RunSubtitleCue[],
  presetId: SubtitlePresetId,
  timingSource: RunSubtitles['timingSource'],
  generatedAt = Date.now(),
): RunSubtitles {
  const preset = SUBTITLE_PRESETS[presetId];
  const stats = computeSubtitleStats(cues, preset);
  return {
    status: 'ready',
    preset: presetId,
    format: 'srt',
    fileName: 'subtitles.srt',
    cueCount: stats.cueCount,
    charCount: stats.charCount,
    maxLineChars: stats.maxLineChars,
    maxCharsPerSecond: Number(stats.maxCharsPerSecond.toFixed(1)),
    timingSource,
    generatedAt,
    cues,
    content: srtFromCues(cues),
  };
}

/** 用 TTS 句级时间戳生成字幕；长句按标点/字数拆分并按时长比例分配。 */
export function buildSubtitlesFromBoundaries(
  boundaries: RunVoiceBoundary[],
  presetId: SubtitlePresetId,
  durationSec: number,
): RunSubtitles {
  const preset = SUBTITLE_PRESETS[presetId];
  const cues: RunSubtitleCue[] = [];
  const maxCueChars = preset.maxLineChars * preset.maxLines;
  let lastEndMs = 0;

  for (const boundary of boundaries) {
    const chunks = splitCueText(boundary.text, maxCueChars);
    if (!chunks.length) continue;
    const totalChars = chunks.reduce((sum, chunk) => sum + stripWhitespace(chunk).length, 0);
    const durationMs = Math.max(300, boundary.endMs - boundary.startMs);
    let cursor = Math.max(boundary.startMs, lastEndMs);
    for (const chunk of chunks) {
      const ratio = totalChars ? stripWhitespace(chunk).length / totalChars : 1 / chunks.length;
      const endMs = Math.max(cursor + 300, Math.min(boundary.endMs, cursor + Math.max(300, durationMs * ratio)));
      const cue = {
        index: cues.length + 1,
        startMs: cursor,
        endMs,
        text: wrapCueText(chunk, preset),
      };
      cues.push(cue);
      lastEndMs = cue.endMs;
      cursor = cue.endMs;
    }
  }

  if (!cues.length) {
    return {
      status: 'failed',
      preset: presetId,
      format: 'srt',
      error: `TTS 未返回可用的句级时间戳（音频 ${durationSec.toFixed(1)} 秒）`,
    };
  }
  return finalizeSubtitles(cues, presetId, 'tts-sentence');
}

/** TTS 没返回时间戳时的兜底：按字数比例估算，界面会标明「估算」。 */
export function buildEstimatedSubtitles(
  text: string,
  presetId: SubtitlePresetId,
  durationSec: number,
): RunSubtitles {
  const preset = SUBTITLE_PRESETS[presetId];
  const chunks = splitCueText(text, preset.maxLineChars * preset.maxLines);
  const totalChars = chunks.reduce((sum, chunk) => sum + stripWhitespace(chunk).length, 0);
  const totalMs = Math.max(1000, durationSec * 1000);
  let cursor = 0;
  const cues: RunSubtitleCue[] = chunks.map((chunk, index) => {
    const ratio = totalChars ? stripWhitespace(chunk).length / totalChars : 1 / chunks.length;
    const endMs = index === chunks.length - 1 ? totalMs : cursor + Math.max(300, totalMs * ratio);
    const cue = {
      index: index + 1,
      startMs: cursor,
      endMs: Math.max(cursor + 300, endMs),
      text: wrapCueText(chunk, preset),
    };
    cursor = cue.endMs;
    return cue;
  });
  return finalizeSubtitles(cues, presetId, 'estimated');
}

/** 字幕文本与台词的字符覆盖率，用于抽检，不宣称完全对齐。 */
export function subtitleCoverageRatio(
  script: Pick<Script, 'storyboards'>,
  subtitles: RunSubtitles,
): number | null {
  const dialogueChars = stripWhitespace(
    script.storyboards.map((board) => board.dialogue).join(''),
  ).length;
  if (!dialogueChars || !subtitles.charCount) return null;
  return subtitles.charCount / dialogueChars;
}
