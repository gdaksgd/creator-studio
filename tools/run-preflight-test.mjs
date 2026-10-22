// 预检纯函数 fixtures：不依赖浏览器，直接跑 buildRunChecks。
// 运行：node ../server/node_modules/tsx/dist/cli.mjs tools/run-preflight-test.mjs
import { buildRunChecks } from '../creator-app/src/services/runPreflight.ts';
import { getRunPipeline, inferPipeline } from '../creator-app/src/config/productionPipeline.ts';
import {
  buildEstimatedSubtitles,
  buildSubtitlesFromBoundaries,
} from '../creator-app/src/services/subtitleService.ts';

const now = Date.now();
const storyboards = [1, 2, 3].map((sceneNumber) => ({
  id: `b${sceneNumber}`,
  sceneNumber,
  description: `画面 ${sceneNumber}`,
  dialogue: `台词 ${sceneNumber}`,
  duration: 60,
  notes: '',
  visualDirection: '中景',
}));

const topic = {
  id: 't1',
  title: '测试选题',
  category: 'rpg',
  status: 'approved',
  evaluation: {
    score: 80,
    heatLevel: 7,
    competitionLevel: 5,
    difficulty: '中',
    estimatedViews: '5w-10w',
    bestPlatform: 'B站',
    bestTime: '周五 20:00',
    suggestions: '测试建议',
    titleSuggestions: [],
    risks: '测试风险',
    evaluatedAt: now,
    basis: { source: 'benchmark', label: 'RPG', sampleSize: 42, windowDays: 30 },
  },
};

const platformCheck = {
  platform: 'bilibili',
  platformLabel: 'B站',
  engine: 'pure-rules-v1',
  durationAdvice: {
    target: '3–10 分钟',
    targetSec: [180, 600],
    status: 'pass',
    detail: '当前 3 分钟，落在建议区间。',
    evidence: { source: 'fixture', level: 'A' },
  },
  rules: [],
  summary: { total: 0, pass: 0, warn: 0, fail: 0, info: 0, sourced: 0 },
  checkedAt: now,
  disclaimer: 'fixture',
};

function makeRun(overrides = {}) {
  const script = {
    id: 's1',
    topicId: 't1',
    platform: 'bilibili',
    version: 'long',
    title: '测试标题',
    hook: '测试钩子',
    storyboards,
    notes: '',
    createdAt: now,
    updatedAt: now,
    platformCheck: { coverText: '封面文案', updatedAt: now },
    ...(overrides.script ?? {}),
  };
  return {
    id: 'r1',
    title: '测试任务',
    topicId: 't1',
    scriptId: 's1',
    platform: 'bilibili',
    version: 'long',
    status: 'draft',
    stage: 'preflight',
    createdAt: now,
    updatedAt: now,
    snapshot: {
      capturedAt: now,
      scriptUpdatedAt: now,
      script,
      topic: overrides.topic === null ? undefined : overrides.topic ?? topic,
      ...(overrides.platformCheck === null ? {} : { platformCheck: overrides.platformCheck ?? platformCheck }),
      ...(overrides.platformCheckError ? { platformCheckError: overrides.platformCheckError } : {}),
    },
    checks: [],
    assetSlots: overrides.assetSlots ?? storyboards.map((board) => ({
      id: `slot-${board.sceneNumber}`,
      storyboardId: board.id,
      sceneNumber: board.sceneNumber,
      description: board.description,
      visualDirection: board.visualDirection,
      duration: board.duration,
      kind: 'video',
      status: 'ready',
      note: '',
    })),
    rightsConfirmed: overrides.rightsConfirmed ?? true,
    review: { approved: false, reviewer: '', note: '' },
    notes: '',
    ...overrides.run,
  };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const has = (checks, id, level) => checks.some((c) => c.id === id && c.level === level);
const levels = (checks) => checks.filter((c) => c.level === 'block').map((c) => c.id);

let checks = buildRunChecks(makeRun());
check('完整任务没有阻塞', levels(checks).length === 0, levels(checks).join(', '));
check('素材与版权通过', has(checks, 'assets-slots', 'pass') && has(checks, 'rights-confirmed', 'pass'));
check('选题样本通过', has(checks, 'topic-sample', 'pass'));
check('平台时长通过', has(checks, 'platform-duration', 'pass'));

checks = buildRunChecks(makeRun({ script: { title: '' } }));
check('标题为空 → 阻塞', has(checks, 'script-title', 'block'));

checks = buildRunChecks(makeRun({ script: { storyboards: [] }, assetSlots: [] }));
check('没有分镜 → 阻塞', has(checks, 'script-storyboards', 'block'));

checks = buildRunChecks(makeRun({
  script: { storyboards: [{ ...storyboards[0], description: '', duration: 0 }] },
  assetSlots: [],
}));
check('分镜字段缺失 → 阻塞', has(checks, 'storyboard-fields', 'block'));

checks = buildRunChecks(makeRun({ platformCheck: null, platformCheckError: '接口不可用' }));
check('平台检查失败 → 阻塞', has(checks, 'platform-check-unavailable', 'block'));

checks = buildRunChecks(makeRun({
  assetSlots: storyboards.map((board) => ({
    id: `slot-${board.sceneNumber}`,
    storyboardId: board.id,
    sceneNumber: board.sceneNumber,
    description: board.description,
    visualDirection: board.visualDirection,
    duration: board.duration,
    kind: 'video',
    status: 'missing',
    note: '',
  })),
}));
check('素材待准备 → 阻塞', has(checks, 'assets-slots', 'block'));

checks = buildRunChecks(makeRun({ rightsConfirmed: false }));
check('版权未确认 → 阻塞', has(checks, 'rights-confirmed', 'block'));

checks = buildRunChecks(makeRun({ topic: null }));
check('没有选题评估 → 提醒', has(checks, 'topic-evaluation', 'warn'));

checks = buildRunChecks(makeRun({
  topic: {
    ...topic,
    evaluation: { ...topic.evaluation, basis: { source: 'ai' } },
  },
}));
check('仅有 AI 依据 → 提醒', has(checks, 'topic-ai-only', 'warn'));

checks = buildRunChecks(makeRun({
  topic: {
    ...topic,
    evaluation: { ...topic.evaluation, basis: { ...topic.evaluation.basis, sampleSize: 5 } },
  },
}));
check('样本不足 → 提醒', has(checks, 'topic-sample', 'warn'));

checks = buildRunChecks(makeRun({
  platformCheck: {
    ...platformCheck,
    rules: [{
      id: 'clickbait',
      label: '标题党检查',
      status: 'fail',
      detail: '命中了标题党词',
      evidence: { source: 'fixture', level: 'C' },
    }],
  },
}));
check('平台规则失败 → 阻塞', has(checks, 'platform-rule-clickbait', 'block'));

checks = buildRunChecks(makeRun({
  script: { version: 'short' },
  run: { version: 'short' },
}));
check('平台版本不匹配 → 提醒', has(checks, 'platform-version', 'warn'));

// ── R3 流水线 ──
const inferredLong = inferPipeline({ platform: 'bilibili', version: 'long' });
const inferredShort = inferPipeline({ platform: 'douyin', version: 'short' });
check('流水线推断：B站长版', inferredLong.id === 'game-longform', inferredLong.id);
check('流水线推断：抖音短版', inferredShort.id === 'game-shortform', inferredShort.id);
check('旧 run 默认回退长解说', getRunPipeline({ pipelineId: undefined }).id === 'game-longform');

checks = buildRunChecks(makeRun());
check('长版章节检查：3 镜提醒', has(checks, 'pipeline-long-chapters', 'warn'));

const shortStoryboards = [{ ...storyboards[0], duration: 4 }, ...storyboards.slice(1)];
checks = buildRunChecks(makeRun({
  script: { platform: 'douyin', version: 'short', storyboards: shortStoryboards },
  run: { platform: 'douyin', version: 'short', pipelineId: 'game-shortform' },
}));
check('短版开场钩子通过', has(checks, 'pipeline-short-hook', 'pass'));
check('短版节奏通过', has(checks, 'pipeline-short-rhythm', 'pass'));
check('短版竖屏提示', has(checks, 'pipeline-short-vertical', 'info'));

checks = buildRunChecks(makeRun({ run: { pipelineId: 'version-marketing-pack' } }));
check(
  '营销包不跑平台规则',
  !checks.some((check) => check.category === 'platform'),
  checks.filter((check) => check.category === 'platform').map((check) => check.id).join(','),
);
check('营销包目标受众提醒', has(checks, 'marketing-context', 'warn'));
check('营销包卖点通过', has(checks, 'marketing-selling-points', 'pass'));
check('营销包评估指标通过', has(checks, 'marketing-metrics', 'pass'));
check('营销包无阻塞', levels(checks).length === 0, levels(checks).join(', '));

// ── R4 素材库与版权 ──
const baseSlots = storyboards.map((board) => ({
  id: `slot-${board.sceneNumber}`,
  storyboardId: board.id,
  sceneNumber: board.sceneNumber,
  description: board.description,
  visualDirection: board.visualDirection,
  duration: board.duration,
  kind: 'image',
  status: 'ready',
  note: '',
  matchStatus: 'unmatched',
  rightsStatus: 'unknown',
}));
const slotsWithAsset = (snapshot) => baseSlots.map((slot, index) => index === 0
  ? {
      ...slot,
      assetId: snapshot.id,
      assetSnapshot: snapshot,
      matchStatus: 'matched',
      rightsStatus: 'unknown',
    }
  : slot);

checks = buildRunChecks(makeRun());
check('已准备但未关联素材库 → 提醒', has(checks, 'asset-unmatched', 'warn'));

checks = buildRunChecks(makeRun({
  assetSlots: baseSlots.map((slot) => ({ ...slot, status: 'not_needed' })),
}));
check('未关联素材标记不需要 → 不提醒', !checks.some((check) => check.id === 'asset-unmatched'));

checks = buildRunChecks(makeRun({
  assetSlots: slotsWithAsset({ id: 'a-unknown', title: '来源不明素材', url: 'https://example.com/a.png' }),
}));
check('素材授权未记录 → 阻塞', has(checks, 'asset-rights-missing', 'block'));

checks = buildRunChecks(makeRun({
  assetSlots: slotsWithAsset({
    id: 'a-expired',
    title: '过期授权素材',
    url: 'https://example.com/b.png',
    license: 'licensed',
    expiresAt: now - 86400000,
    allowedPlatforms: ['bilibili'],
  }),
}));
check('素材授权过期 → 阻塞', has(checks, 'asset-rights-expired', 'block'));

checks = buildRunChecks(makeRun({
  assetSlots: slotsWithAsset({
    id: 'a-blocked',
    title: '仅抖音授权素材',
    url: 'https://example.com/c.png',
    license: 'licensed',
    allowedPlatforms: ['douyin'],
  }),
}));
check('素材平台不允许 → 阻塞', has(checks, 'asset-platform-blocked', 'block'));

checks = buildRunChecks(makeRun({
  assetSlots: slotsWithAsset({
    id: 'a-ok',
    title: '自有版权素材',
    url: 'https://example.com/d.png',
    sourceType: 'original',
    license: 'own',
    allowedPlatforms: ['bilibili'],
  }),
}));
check('素材授权可核验 → 通过', has(checks, 'asset-rights', 'pass') && !has(checks, 'asset-rights-missing', 'block'));

checks = buildRunChecks(makeRun({
  assetSlots: slotsWithAsset({
    id: 'a-deleted',
    title: '素材库记录已删除',
    url: 'https://example.com/deleted.png',
    license: 'own',
  }).map((slot, index) => index === 0 ? { ...slot, matchStatus: 'missing' } : slot),
}));
check('素材库记录删除 → 授权阻塞', has(checks, 'asset-rights-missing', 'block'));

// ── R5 配音与字幕（流水线 v2） ──
const v2Run = { pipelineId: 'game-longform', pipelineVersion: '2' };
checks = buildRunChecks(makeRun({ run: v2Run }));
check('v2 未生成配音 → 阻塞', has(checks, 'voice-missing', 'block'));

checks = buildRunChecks(makeRun());
check('v1 不要求配音', !checks.some((check) => check.category === 'voice'));

const voiceover = {
  status: 'ready',
  provider: 'edge-tts',
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  pitch: '+0Hz',
  mediaId: 'media-1',
  fileName: 'voiceover.mp3',
  mime: 'audio/mpeg',
  size: 120000,
  durationSec: 180,
  generatedAt: now,
  boundaries: [
    { startMs: 0, endMs: 60000, text: '台词 1' },
    { startMs: 60000, endMs: 120000, text: '台词 2' },
    { startMs: 120000, endMs: 180000, text: '台词 3' },
  ],
};
checks = buildRunChecks(makeRun({ run: { ...v2Run, voiceover } }));
check('v2 配音已生成但缺字幕 → 阻塞', has(checks, 'subtitle-missing', 'block'));

const subtitles = buildSubtitlesFromBoundaries(voiceover.boundaries, 'bilibili', 180);
checks = buildRunChecks(makeRun({ run: { ...v2Run, voiceover, subtitles } }));
check('v2 配音与字幕通过', has(checks, 'voice-ready', 'pass') && has(checks, 'subtitle-ready', 'pass'));
check('v2 配音时长通过', has(checks, 'voice-duration', 'pass'));
check('v2 字幕行宽与速度通过', has(checks, 'subtitle-line-width', 'pass') && has(checks, 'subtitle-reading-speed', 'pass'));
check('v2 字幕抽检通过', has(checks, 'subtitle-coverage', 'pass'));

const fastSubtitles = buildSubtitlesFromBoundaries([
  { startMs: 0, endMs: 500, text: '这是一句很长很长的台词需要快速读完' },
], 'bilibili', 0.5);
checks = buildRunChecks(makeRun({ run: { ...v2Run, voiceover, subtitles: fastSubtitles } }));
check('v2 字幕语速过快 → 提醒', has(checks, 'subtitle-reading-speed', 'warn'));

const estimated = buildEstimatedSubtitles('台词 1 台词 2 台词 3', 'douyin', 6);
checks = buildRunChecks(makeRun({ run: { ...v2Run, voiceover, subtitles: estimated } }));
check('v2 估算字幕 → 提醒', has(checks, 'subtitle-timing', 'warn'));

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exitCode = 1;
