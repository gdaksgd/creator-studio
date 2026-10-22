import { strToU8, zipSync } from 'fflate';
import {
  ASSET_KIND_LABELS,
  ASSET_STATUS_LABELS,
  PLATFORM_LABELS,
  RUN_STATUS_META,
  VERSION_LABELS,
  VERSION_MARKETING_PIPELINE,
  getPipelinePackFileNames,
  getRunPipeline,
} from '../config/productionPipeline';
import {
  formatAssetExpiry,
  formatAssetLicense,
  formatAssetPlatforms,
  formatAssetSource,
} from './assetRights';
import type { ProductionRun, RunCheck } from '../types';

export type RunPackMode = 'publish' | 'draft';

export interface RunPackFile {
  name: string;
  content: string;
  /** 二进制媒体（voiceover.mp3）；文本文件不设置。 */
  data?: Uint8Array;
}

export interface RunPackResult {
  fileName: string;
  fileCount: number;
  blob: Blob;
  files: RunPackFile[];
}

/** 单个阶段工件。内容直接来自 run 快照，不额外持久化。 */
export interface StageArtifact {
  id: string;
  label: string;
  fileName: string;
  mime: string;
  content: string;
}

const STAGE_ARTIFACTS: Array<Pick<StageArtifact, 'id' | 'label' | 'fileName' | 'mime'>> = [
  { id: 'script', label: '脚本', fileName: 'script.md', mime: 'text/markdown;charset=utf-8' },
  { id: 'shotlist', label: '分镜表', fileName: 'shotlist.csv', mime: 'text/csv;charset=utf-8' },
  { id: 'assets', label: '素材清单', fileName: 'assets.csv', mime: 'text/csv;charset=utf-8' },
  { id: 'checks', label: '检查结果', fileName: 'checks.json', mime: 'application/json;charset=utf-8' },
  { id: 'publish', label: '发布说明', fileName: 'publish.md', mime: 'text/markdown;charset=utf-8' },
];

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatDay(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function csvCell(value: string | number): string {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csv(rows: Array<Array<string | number>>): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function checkSummary(checks: RunCheck[]): { block: number; warn: number; pass: number; info: number } {
  return {
    block: checks.filter((check) => check.level === 'block').length,
    warn: checks.filter((check) => check.level === 'warn').length,
    pass: checks.filter((check) => check.level === 'pass').length,
    info: checks.filter((check) => check.level === 'info').length,
  };
}

function checkLine(check: RunCheck): string {
  const evidence = check.evidence
    ? `（${check.evidence.level} 级依据：${check.evidence.source}${check.evidence.note ? `；${check.evidence.note}` : ''}）`
    : '';
  return `- **${check.label}**：${check.detail}${evidence}`;
}

function pipelineHasMedia(run: ProductionRun): boolean {
  return getRunPipeline(run).packSections.some((section) => section.key === 'media');
}

function hasReadyMedia(run: ProductionRun): boolean {
  return (
    pipelineHasMedia(run) &&
    run.voiceover?.status === 'ready' &&
    run.subtitles?.status === 'ready'
  );
}

function buildVoiceJson(run: ProductionRun): string {
  const { boundaries, ...voice } = run.voiceover ?? {};
  return JSON.stringify({ ...voice, mediaFile: 'voiceover.mp3', boundaries: boundaries ?? [] }, null, 2);
}

function buildSubtitleJson(run: ProductionRun): string {
  const { cues, content: _content, ...subtitles } = run.subtitles ?? {};
  return JSON.stringify({ ...subtitles, srtFile: 'subtitles.srt', cues: cues ?? [] }, null, 2);
}

async function buildMediaFiles(run: ProductionRun, voiceBlob: Blob): Promise<RunPackFile[]> {
  const bytes = new Uint8Array(await voiceBlob.arrayBuffer());
  return [
    { name: 'voiceover.mp3', content: '', data: bytes },
    { name: 'subtitles.srt', content: run.subtitles?.content ?? '' },
    { name: 'voice.json', content: buildVoiceJson(run) },
    { name: 'subtitle.json', content: buildSubtitleJson(run) },
  ];
}

function buildReadme(run: ProductionRun, mode: RunPackMode): string {
  const summary = checkSummary(run.checks);
  const assetReady = run.assetSlots.filter((slot) => slot.status !== 'missing').length;
  const blocked = run.checks.filter((check) => check.level === 'block');
  const warned = run.checks.filter((check) => check.level === 'warn');
  const pipeline = getRunPipeline(run);
  const isMarketing = pipeline.id === VERSION_MARKETING_PIPELINE.id;
  const hasReview = pipeline.stageKeys.includes('review');
  const publishBinding = run.publishRef
    ? `| 发布绑定 | ${PLATFORM_LABELS[run.publishRef.platform]}${run.publishRef.bvid ? ` · BVID ${run.publishRef.bvid}` : ''} · 绑定于 ${formatDate(run.publishRef.boundAt)} |\n`
    : '';
  const shotRow = isMarketing
    ? `| 素材槽位 | ${run.assetSlots.length} 个（营销包不含完整分镜） |`
    : `| 分镜 | ${run.snapshot.script.storyboards.length} 镜 · ${run.snapshot.script.storyboards.reduce((sum, board) => sum + board.duration, 0)} 秒 |`;
  const reviewRow = hasReview
    ? `| 复核 | ${run.review.approved ? `${run.review.reviewer} · ${formatDate(run.review.approvedAt ?? run.updatedAt)}` : '未通过'} |`
    : '| 复核 | 不适用（本流水线无人工复核阶段） |';
  const mediaReady = hasReadyMedia(run);
  const mediaSection = mediaReady
    ? `## 媒体文件

- \`voiceover.mp3\`：${run.voiceover?.durationSec?.toFixed(1) ?? '—'} 秒 · ${run.voiceover?.provider ?? 'edge-tts'} · ${run.voiceover?.voice ?? ''}
- \`subtitles.srt\`：${run.subtitles?.cueCount ?? 0} 条 · ${run.subtitles?.preset === 'douyin' ? '抖音预设' : 'B站预设'} · ${run.subtitles?.timingSource === 'estimated' ? '估算时间' : 'TTS 句级时间戳'}
- \`voice.json\` / \`subtitle.json\`：provider、音色、时长、时间戳与字幕元数据
`
    : pipelineHasMedia(run)
      ? `## 媒体文件

- 尚未生成配音与字幕；本包不包含媒体文件。
`
      : '';
  return `# ${run.title}

> ${mode === 'publish' ? 'READY · 发布交接包' : 'DRAFT · 草稿交接包'}  
> 生成时间：${formatDate(Date.now())}

## 任务信息

| 项 | 内容 |
|---|---|
| 状态 | ${RUN_STATUS_META[run.status].label} |
| 流水线 | ${pipeline.name} · ${pipeline.id}@${pipeline.version} |
| 平台 / 版本 | ${PLATFORM_LABELS[run.platform]} · ${VERSION_LABELS[run.version]} |
| 源脚本 | ${run.scriptId}（快照于 ${formatDate(run.snapshot.scriptUpdatedAt)}） |
| 源选题 | ${run.topicId || '未关联'} |
| 创建时间 | ${formatDate(run.createdAt)} |
| 数据性质 | ${run.demo ? '演示任务 · 非实绩' : '生产任务'} |
${shotRow}
| 素材 | ${assetReady} / ${run.assetSlots.length} 已准备或不需要 |
| 版权确认 | ${run.rightsConfirmed ? '已确认' : '未确认'} |
${reviewRow}
${publishBinding}
## 检查汇总

- 阻塞：${summary.block}
- 提醒：${summary.warn}
- 通过：${summary.pass}
- 说明：${summary.info}

${blocked.length ? `### 阻塞项\n\n${blocked.map(checkLine).join('\n')}\n` : ''}
${warned.length ? `### 提醒项\n\n${warned.map(checkLine).join('\n')}\n` : ''}

## 复核备注

${run.review.note || '（未填写）'}

${mediaSection}
## 说明

- 本包是**制作交接包**，不包含成片。${mediaReady ? '包含任务生成的 `voiceover.mp3` 与 `subtitles.srt`。' : '不包含配音和字幕。'}${isMarketing ? '营销素材包不包含完整分镜，manifest 中的 storyboards 已省略。' : ''}
- ${hasReview ? '发布包只有在复核通过、版权确认且没有阻塞项时才能生成。' : '发布包只有在版权确认且没有阻塞项时才能生成（本流水线没有人工复核阶段）。'}
- ${run.demo ? '演示任务仅用于展示流程，不构成项目实绩。' : '本包由 Creator Studio 生成，发布前请按 publish.md 的人工清单复核。'}
- 平台规则、样本依据与出处见 \`checks.json\` 和 \`publish.md\`。
`;
}

function buildScriptMarkdown(run: ProductionRun): string {
  const script = run.snapshot.script;
  return `# ${script.title || run.title}

- 平台：${PLATFORM_LABELS[run.platform]}
- 版本：${VERSION_LABELS[run.version]}
- 总时长：${script.storyboards.reduce((sum, board) => sum + board.duration, 0)} 秒

## 开场钩子

${script.hook || '（未填写）'}

## 分镜脚本

| 镜号 | 时长(秒) | 画面描述 | 台词 | 画面方向 |
|---:|---:|---|---|---|
${script.storyboards
  .map(
    (board) =>
      `| ${board.sceneNumber} | ${board.duration} | ${mdCell(board.description)} | ${mdCell(board.dialogue)} | ${mdCell(board.visualDirection)} |`,
  )
  .join('\n')}

## 备注

${script.notes || '（无）'}
`;
}

function buildPublishMarkdown(run: ProductionRun): string {
  const script = run.snapshot.script;
  const platformCheck = run.snapshot.platformCheck;
  const rules = platformCheck?.rules ?? [];
  const pipeline = getRunPipeline(run);
  const isMarketing = pipeline.id === VERSION_MARKETING_PIPELINE.id;
  return `# 发布交接

- 流水线：${pipeline.name} · ${pipeline.id}@${pipeline.version}
- 平台：${PLATFORM_LABELS[run.platform]}
- 版本：${VERSION_LABELS[run.version]}
- 标题：${script.title || '（未填写）'}
- 封面文案：${script.platformCheck?.coverText || '（未填写）'}
- 总时长：${script.storyboards.reduce((sum, board) => sum + board.duration, 0)} 秒

## 平台规则结论

${
  isMarketing
    ? '本流水线不运行平台规则检查；发布前由人工确认平台要求。'
    : platformCheck
    ? `检查引擎：${platformCheck.engine} · 检查时间：${formatDate(platformCheck.checkedAt)}

- 时长建议：${platformCheck.durationAdvice.detail}
${platformCheck.durationAdvice.hint ? `- 建议动作：${platformCheck.durationAdvice.hint}` : ''}
- 时长依据：${platformCheck.durationAdvice.evidence.level} 级 · ${platformCheck.durationAdvice.evidence.source}

${rules.length ? `| 规则 | 结论 | 依据等级 | 出处 |\n|---|---|---|---|\n${rules.map((rule) => `| ${mdCell(rule.label)} | ${mdCell(rule.detail)} | ${rule.evidence.level} | ${mdCell(rule.evidence.source)} |`).join('\n')}` : '没有可展示的规则条目。'}`
    : `平台规则检查未完成：${run.snapshot.platformCheckError || '未运行'}`
}

## 发布前人工清单

- [ ] 标题与封面文案已在平台后台确认
- [ ] 视频文件、封面、字幕已由制作同学交付
- [ ] 素材版权/授权已确认
- [ ] 发布时间、账号、可见范围已确认
- [ ] 发布后回填播放数据，进入复盘
`;
}

function buildManifest(run: ProductionRun, mode: RunPackMode): string {
  const pipeline = getRunPipeline(run);
  const isMarketing = pipeline.id === VERSION_MARKETING_PIPELINE.id;
  const mediaReady = hasReadyMedia(run);
  const manifestRun = isMarketing
    ? {
        ...run,
        snapshot: {
          ...run.snapshot,
          script: { ...run.snapshot.script, storyboards: [] },
        },
      }
    : run;
  return JSON.stringify(
    {
      format: 'creator-studio-run-pack',
      version: '1.0',
      formatVersion: mediaReady ? '2' : '1',
      pipeline: {
        id: pipeline.id,
        version: pipeline.version,
        name: pipeline.name,
      },
      exportedAt: Date.now(),
      mode,
      status: run.status,
      storyboardsOmitted: isMarketing,
      ...(mediaReady
        ? {
            media: {
              voiceover: 'voiceover.mp3',
              subtitles: 'subtitles.srt',
              voiceJson: 'voice.json',
              subtitleJson: 'subtitle.json',
              durationSec: run.voiceover?.durationSec ?? null,
              cueCount: run.subtitles?.cueCount ?? 0,
            },
          }
        : {}),
      run: manifestRun,
    },
    null,
    2,
  );
}

export function buildRunPackFiles(run: ProductionRun, mode: RunPackMode): RunPackFile[] {
  const shotlist = csv([
    ['镜号', '时长(秒)', '画面描述', '台词', '画面方向', '素材类型', '素材状态', '备注'],
    ...run.assetSlots.map((slot) => [
      slot.sceneNumber,
      slot.duration,
      slot.description,
      run.snapshot.script.storyboards.find((board) => board.id === slot.storyboardId)?.dialogue ?? '',
      slot.visualDirection,
      ASSET_KIND_LABELS[slot.kind],
      ASSET_STATUS_LABELS[slot.status],
      slot.note,
    ]),
  ]);

  const assets = csv([
    ['镜号', '素材类型', '状态', '描述', '备注', '来源', '授权', '到期', '允许平台', '素材ID', '素材名称'],
    ...run.assetSlots.map((slot) => {
      const snapshot = slot.assetSnapshot;
      return [
        slot.sceneNumber,
        ASSET_KIND_LABELS[slot.kind],
        ASSET_STATUS_LABELS[slot.status],
        slot.description,
        slot.note,
        snapshot ? formatAssetSource(snapshot.sourceType) : '未关联',
        snapshot ? formatAssetLicense(snapshot.license) : '未关联',
        snapshot ? formatAssetExpiry(snapshot.expiresAt) : '未关联',
        snapshot ? formatAssetPlatforms(snapshot.allowedPlatforms) : '未关联',
        snapshot?.id ?? '—',
        snapshot?.title ?? '—',
      ];
    }),
  ]);

  const files: RunPackFile[] = [
    { name: 'README.md', content: buildReadme(run, mode) },
    { name: 'manifest.json', content: buildManifest(run, mode) },
    { name: 'script.md', content: buildScriptMarkdown(run) },
    { name: 'shotlist.csv', content: shotlist },
    { name: 'assets.csv', content: assets },
    { name: 'publish.md', content: buildPublishMarkdown(run) },
    { name: 'checks.json', content: JSON.stringify(run.checks, null, 2) },
    { name: 'source-topic.json', content: JSON.stringify(run.snapshot.topic ?? null, null, 2) },
  ];
  const allowed = new Set(getPipelinePackFileNames(run));
  return files.filter((file) => allowed.has(file.name));
}

export function buildRunPack(run: ProductionRun, mode: RunPackMode): RunPackResult {
  if (
    mode === 'publish' &&
    run.status !== 'ready' &&
    !(run.status === 'exported' && !run.pack?.stale)
  ) {
    throw new Error('当前任务还不能导出发布包');
  }
  if (hasReadyMedia(run)) {
    throw new Error('该任务包含配音/字幕，请使用带媒体的导出');
  }
  const files = buildRunPackFiles(run, mode);
  const zipped = zipSync(
    Object.fromEntries(files.map((file) => [file.name, file.data ?? strToU8(file.content)])),
    { level: 6 },
  );
  const fileName = `creator-studio_${formatDay(Date.now())}_${run.platform}_${run.version}_${mode}.zip`;
  const blob = new Blob([zipped], { type: 'application/zip' });
  return { fileName, fileCount: files.length, blob, files };
}

/** 带配音/字幕的 v2 包；音频 Blob 由调用方从本机 runMedia 读出。 */
export async function buildRunPackWithMedia(
  run: ProductionRun,
  mode: RunPackMode,
  voiceBlob?: Blob,
): Promise<RunPackResult> {
  if (
    mode === 'publish' &&
    run.status !== 'ready' &&
    !(run.status === 'exported' && !run.pack?.stale)
  ) {
    throw new Error('当前任务还不能导出发布包');
  }
  const files = buildRunPackFiles(run, mode);
  const mediaReady = hasReadyMedia(run);
  if (mediaReady) {
    if (!voiceBlob) throw new Error('配音文件不在本机，无法导出媒体包');
    files.push(...(await buildMediaFiles(run, voiceBlob)));
  } else if (pipelineHasMedia(run) && mode === 'publish') {
    throw new Error('配音/字幕尚未生成，不能导出发布包');
  }
  const zipped = zipSync(
    Object.fromEntries(files.map((file) => [file.name, file.data ?? strToU8(file.content)])),
    { level: 6 },
  );
  const fileName = `creator-studio_${formatDay(Date.now())}_${run.platform}_${run.version}_${mode}.zip`;
  const blob = new Blob([zipped], { type: 'application/zip' });
  return { fileName, fileCount: files.length, blob, files };
}

export function downloadRunPack(result: RunPackResult): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 可单独下载的阶段工件（按流水线过滤；长版 5 个，营销包 3 个）。
 * 内容直接复用 buildRunPackFiles，不复制生成逻辑；README/manifest 只属于完整包。
 */
export function buildStageArtifacts(run: ProductionRun): StageArtifact[] {
  const files = new Map(buildRunPackFiles(run, 'draft').map((file) => [file.name, file.content]));
  return STAGE_ARTIFACTS.filter((artifact) => files.has(artifact.fileName)).map((artifact) => ({
    ...artifact,
    content: files.get(artifact.fileName) ?? '',
  }));
}

export function downloadStageArtifact(artifact: StageArtifact): void {
  const blob = new Blob([artifact.content], { type: artifact.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface CampaignPackResult {
  campaignId: string;
  fileName: string;
  fileCount: number;
  blob: Blob;
  files: RunPackFile[];
}

/**
 * 组合包：每条 run 的交接包放进 runs/<platform>-<version>/，
 * 顶层 campaign.json 记录同组关系与各自状态。未就绪任务用 DRAFT 包，不伪造 READY。
 */
export function buildCampaignPack(runs: ProductionRun[], campaignId: string): CampaignPackResult {
  if (runs.length < 2) throw new Error('至少需要两条同组任务才能导出组合包');
  if (runs.some(hasReadyMedia)) {
    throw new Error('组合包包含配音/字幕，请使用带媒体的导出');
  }
  const usedSlugs = new Set<string>();
  const files: RunPackFile[] = [];
  const runEntries = runs.map((run) => {
    const mode: RunPackMode =
      run.status === 'ready' || (run.status === 'exported' && !run.pack?.stale)
        ? 'publish'
        : 'draft';
    let slug = `${run.platform}-${run.version}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${run.platform}-${run.version}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    const runFiles = buildRunPackFiles(run, mode);
    for (const file of runFiles) {
      files.push({
        name: `runs/${slug}/${file.name}`,
        content: file.content,
        ...(file.data ? { data: file.data } : {}),
      });
    }
    const pipeline = getRunPipeline(run);
    return {
      id: run.id,
      title: run.title,
      platform: run.platform,
      version: run.version,
      pipeline: { id: pipeline.id, version: pipeline.version, name: pipeline.name },
      status: run.status,
      packMode: mode,
      packStale: run.pack?.stale ?? false,
      publishRef: run.publishRef ?? null,
      files: runFiles.map((file) => file.name),
      mediaIncluded: false,
      demo: !!run.demo,
    };
  });
  const topic = runs[0]?.snapshot.topic;
  files.push({
    name: 'campaign.json',
    content: JSON.stringify(
      {
        format: 'creator-studio-campaign-pack',
        version: '1.0',
        campaignId,
        exportedAt: Date.now(),
        topicId: runs[0]?.topicId ?? '',
        topicTitle: topic?.title ?? '',
        note: '未就绪任务以 DRAFT 包进入组合包；发布数据与绑定只在本机，不在包内。',
        runs: runEntries,
      },
      null,
      2,
    ),
  });
  const zipped = zipSync(
    Object.fromEntries(files.map((file) => [file.name, file.data ?? strToU8(file.content)])),
    { level: 6 },
  );
  const fileName = `creator-studio_campaign_${formatDay(Date.now())}.zip`;
  const blob = new Blob([zipped], { type: 'application/zip' });
  return { campaignId, fileName, fileCount: files.length, blob, files };
}

/** 组合包 v2：把每条任务的配音/字幕也放进各自 runs/<slug>/ 目录。 */
export async function buildCampaignPackWithMedia(
  runs: ProductionRun[],
  campaignId: string,
  voiceBlobs: Map<string, Blob>,
): Promise<CampaignPackResult> {
  if (runs.length < 2) throw new Error('至少需要两条同组任务才能导出组合包');
  const usedSlugs = new Set<string>();
  const files: RunPackFile[] = [];
  const runEntries: Array<Record<string, unknown>> = [];
  for (const run of runs) {
    const mode: RunPackMode =
      run.status === 'ready' || (run.status === 'exported' && !run.pack?.stale)
        ? 'publish'
        : 'draft';
    let slug = `${run.platform}-${run.version}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${run.platform}-${run.version}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    const runFiles = buildRunPackFiles(run, mode);
    const mediaReady = hasReadyMedia(run);
    if (mediaReady) {
      const voiceBlob = voiceBlobs.get(run.id);
      if (!voiceBlob) throw new Error(`「${run.title}」的配音文件不在本机`);
      runFiles.push(...(await buildMediaFiles(run, voiceBlob)));
    }
    for (const file of runFiles) {
      files.push({
        name: `runs/${slug}/${file.name}`,
        content: file.content,
        ...(file.data ? { data: file.data } : {}),
      });
    }
    const pipeline = getRunPipeline(run);
    runEntries.push({
      id: run.id,
      title: run.title,
      platform: run.platform,
      version: run.version,
      pipeline: { id: pipeline.id, version: pipeline.version, name: pipeline.name },
      status: run.status,
      packMode: mode,
      packStale: run.pack?.stale ?? false,
      publishRef: run.publishRef ?? null,
      files: runFiles.map((file) => file.name),
      mediaIncluded: mediaReady,
      demo: !!run.demo,
    });
  }
  const topic = runs[0]?.snapshot.topic;
  files.push({
    name: 'campaign.json',
    content: JSON.stringify(
      {
        format: 'creator-studio-campaign-pack',
        version: '1.0',
        campaignId,
        exportedAt: Date.now(),
        topicId: runs[0]?.topicId ?? '',
        topicTitle: topic?.title ?? '',
        note: '未就绪任务以 DRAFT 包进入组合包；发布数据与绑定只在本机，不在包内。',
        runs: runEntries,
      },
      null,
      2,
    ),
  });
  const zipped = zipSync(
    Object.fromEntries(files.map((file) => [file.name, file.data ?? strToU8(file.content)])),
    { level: 6 },
  );
  const fileName = `creator-studio_campaign_${formatDay(Date.now())}.zip`;
  const blob = new Blob([zipped], { type: 'application/zip' });
  return { campaignId, fileName, fileCount: files.length, blob, files };
}
