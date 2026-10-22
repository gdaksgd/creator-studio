import { api } from '../api/client';
import {
  GAME_SHORTFORM_PIPELINE,
  PLATFORM_LABELS,
  VERSION_LABELS,
  VERSION_MARKETING_PIPELINE,
  getRunPipeline,
} from '../config/productionPipeline';
import {
  formatAssetExpiry,
  formatAssetPlatforms,
  getSlotRightsStatus,
} from './assetRights';
import {
  SUBTITLE_PRESETS,
  computeSubtitleStats,
  subtitleCoverageRatio,
} from './subtitleService';
import type {
  PlatformCheck,
  ProductionRun,
  RunCheck,
  RunCheckLevel,
  RunEvidence,
} from '../types';

export interface PreflightResult {
  checks: RunCheck[];
  platformCheck?: PlatformCheck;
  platformCheckError?: string;
}

function makeCheck(
  input: Omit<RunCheck, 'checkedAt'>,
  at = Date.now(),
): RunCheck {
  return { ...input, checkedAt: at };
}

function evidenceFromPlatform(evidence: {
  source: string;
  level: 'A' | 'B' | 'C';
  note?: string;
}): RunEvidence {
  return {
    source: evidence.source,
    level: evidence.level,
    ...(evidence.note ? { note: evidence.note } : {}),
  };
}

function levelFromRule(status: 'pass' | 'warn' | 'fail' | 'info'): RunCheckLevel {
  if (status === 'fail') return 'block';
  if (status === 'warn') return 'warn';
  if (status === 'info') return 'info';
  return 'pass';
}

function levelFromDuration(status: 'pass' | 'warn' | 'fail' | 'info'): RunCheckLevel {
  if (status === 'fail') return 'block';
  if (status === 'warn' || status === 'info') return 'warn';
  return 'pass';
}

/**
 * 纯函数：给定任务快照、平台检查结果/错误，产出全部检查项。
 * 不访问数据库、不发请求，便于 fixtures 直接验证。
 */
export function buildRunChecks(
  run: ProductionRun,
  platformCheck: PlatformCheck | undefined = run.snapshot.platformCheck,
  platformCheckError: string | undefined = run.snapshot.platformCheckError,
): RunCheck[] {
  const now = Date.now();
  const checks: RunCheck[] = [];
  const script = run.snapshot.script;
  const totalDuration = script.storyboards.reduce((sum, board) => sum + board.duration, 0);
  const platformLabel = PLATFORM_LABELS[run.platform];
  const pipeline = getRunPipeline(run);
  const isMarketing = pipeline.id === VERSION_MARKETING_PIPELINE.id;
  const isShortform = pipeline.id === GAME_SHORTFORM_PIPELINE.id;

  // ── 脚本完整性 ──
  checks.push(makeCheck({
    id: 'script-title',
    category: 'script',
    label: '视频标题',
    level: script.title.trim() ? 'pass' : 'block',
    detail: script.title.trim() ? `标题：${script.title.trim()}` : '脚本没有视频标题，无法发布。',
    source: 'local',
  }, now));

  checks.push(makeCheck({
    id: 'script-hook',
    category: 'script',
    label: '开场钩子',
    level: script.hook.trim() ? 'pass' : 'block',
    detail: script.hook.trim() ? '已填写开场钩子。' : '脚本没有开场钩子，前 3–5 秒没有留人理由。',
    source: 'local',
  }, now));

  const boardCount = script.storyboards.length;
  checks.push(makeCheck({
    id: 'script-storyboards',
    category: 'script',
    label: '分镜数量',
    level: boardCount === 0 ? 'block' : boardCount < 3 ? 'warn' : 'pass',
    detail:
      boardCount === 0
        ? '脚本没有分镜，无法生成素材清单。'
        : `共 ${boardCount} 个分镜。`,
    hint: boardCount > 0 && boardCount < 3 ? '分镜偏少，检查一下节奏是否完整。' : undefined,
    source: 'local',
  }, now));

  checks.push(makeCheck({
    id: 'script-duration',
    category: 'script',
    label: '总时长',
    level: totalDuration > 0 ? 'pass' : 'block',
    detail:
      totalDuration > 0
        ? `分镜时长合计 ${totalDuration} 秒（${(totalDuration / 60).toFixed(1)} 分钟）。`
        : '分镜时长合计为 0，无法判断平台适配。',
    source: 'local',
  }, now));

  const badBoards = script.storyboards.filter(
    (board) => !board.description.trim() || board.duration <= 0,
  );
  checks.push(makeCheck({
    id: 'storyboard-fields',
    category: 'script',
    label: '分镜字段',
    level: badBoards.length ? 'block' : 'pass',
    detail: badBoards.length
      ? `镜 ${badBoards.map((board) => board.sceneNumber).join('、')} 缺少画面描述或时长。`
      : '每个分镜都有画面描述和有效时长。',
    hint: badBoards.length ? '修改源脚本后，基于最新脚本新建任务。' : undefined,
    source: 'local',
  }, now));

  if (!isMarketing) {
    // ── 平台/版本 ──
    const versionMismatch =
      (run.platform === 'bilibili' && run.version === 'short') ||
      (run.platform === 'douyin' && run.version === 'long');
    checks.push(makeCheck({
      id: 'platform-version',
      category: 'platform',
      label: '平台与版本',
      level: versionMismatch ? 'warn' : 'pass',
      detail: versionMismatch
        ? `${platformLabel} 任务使用了${VERSION_LABELS[run.version]}脚本，检查是否符合发布习惯。`
        : `${platformLabel} · ${VERSION_LABELS[run.version]}。`,
      source: 'local',
    }, now));

    if (!(script.platformCheck?.coverText ?? '').trim()) {
      checks.push(makeCheck({
        id: 'platform-cover',
        category: 'platform',
        label: '封面文案',
        level: 'warn',
        detail: '平台适配检查里还没有填写封面文案。',
        hint: '可以先导出草稿包，发布前再补。',
        source: 'local',
      }, now));
    }

    // ── 选题依据 ──
    const evaluation = run.snapshot.topic?.evaluation;
    if (!evaluation) {
      checks.push(makeCheck({
        id: 'topic-evaluation',
        category: 'evidence',
        label: '选题评估',
        level: 'warn',
        detail: run.snapshot.topic ? '这个选题还没有做过 AI 评估。' : '任务没有关联到选题。',
        hint: '没有评估不影响导出，但发布包里会标记为「未评估」。',
        source: 'topic',
      }, now));
    } else {
      const basis = evaluation.basis;
      if (basis?.source === 'ai') {
        checks.push(makeCheck({
          id: 'topic-ai-only',
          category: 'evidence',
          label: '选题依据',
          level: 'warn',
          detail: '选题评估只有 AI 推断，没有真实样本基准。',
          hint: '这是一条提醒，不是阻塞；发布包里会保留来源说明。',
          source: 'topic',
        }, now));
      } else if (basis?.source === 'benchmark') {
        const sampleSize = basis.sampleSize ?? 0;
        const sourceText = [
          basis.label ?? '同品类',
          sampleSize ? `${sampleSize} 条样本` : '',
          basis.windowDays != null ? `近 ${basis.windowDays} 天` : '榜单快照',
        ]
          .filter(Boolean)
          .join(' · ');
        checks.push(makeCheck({
          id: 'topic-sample',
          category: 'evidence',
          label: '选题依据',
          level: sampleSize > 0 && sampleSize < 20 ? 'warn' : 'pass',
          detail:
            sampleSize > 0 && sampleSize < 20
              ? `选题评估只有 ${sampleSize} 条样本，结论不稳定。`
              : `选题评估有真实样本依据（${sampleSize || '已记录'} 条）。`,
          source: 'topic',
          evidence: basis.label || sampleSize
            ? {
                source: sourceText,
                level: 'C',
                note: '样本基准只描述当前品类水位，不是对单条内容的保证。',
              }
            : undefined,
        }, now));
      }
    }

    // ── 平台规则引擎 ──
    if (platformCheckError) {
      checks.push(makeCheck({
        id: 'platform-check-unavailable',
        category: 'platform',
        label: '平台规则检查',
        level: 'block',
        detail: `平台规则检查未完成：${platformCheckError}`,
        hint: '可以导出草稿包；发布包需要等平台规则检查完成。',
        source: 'platform',
      }, now));
    } else if (platformCheck) {
      checks.push(makeCheck({
        id: 'platform-duration',
        category: 'platform',
        label: '平台时长建议',
        level: levelFromDuration(platformCheck.durationAdvice.status),
        detail: platformCheck.durationAdvice.detail,
        hint: [
          platformCheck.durationAdvice.hint,
          platformCheck.durationAdvice.completionReference
            ? `完播参考：${platformCheck.durationAdvice.completionReference.text}（${platformCheck.durationAdvice.completionReference.evidence.level} 级）`
            : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
        source: 'platform',
        evidence: evidenceFromPlatform(platformCheck.durationAdvice.evidence),
      }, now));

      for (const rule of platformCheck.rules) {
        checks.push(makeCheck({
          id: `platform-rule-${rule.id}`,
          category: 'platform',
          label: rule.label,
          level: levelFromRule(rule.status),
          detail: rule.detail,
          hint: rule.hint,
          source: 'platform',
          evidence: evidenceFromPlatform(rule.evidence),
        }, now));
      }
    }
  }

  // ── 流水线额外检查（R3） ──
  if (isMarketing) {
    const topic = run.snapshot.topic;
    const context = [topic?.notes, topic?.gameDescription, topic?.productionIdea]
      .filter((value): value is string => !!value && !!value.trim())
      .join(' ');
    checks.push(makeCheck({
      id: 'marketing-context',
      category: 'pipeline',
      label: '目标与受众',
      level: context ? 'pass' : 'warn',
      detail: context
        ? '选题里有目标/受众/制作背景，可作为简报上下文。'
        : '选题还没有填写目标受众或制作背景，营销包会缺少判断依据。',
      hint: context ? undefined : '补充选题备注或游戏描述后再导出。',
      source: 'topic',
    }, now));

    checks.push(makeCheck({
      id: 'marketing-selling-points',
      category: 'pipeline',
      label: '卖点与简报',
      level: script.hook.trim() || script.notes.trim() ? 'pass' : 'warn',
      detail: script.hook.trim() || script.notes.trim()
        ? '脚本钩子/备注可作为卖点与传播角度。'
        : '脚本没有钩子或备注，营销包缺少卖点描述。',
      hint: script.hook.trim() || script.notes.trim() ? undefined : '补一句核心卖点或传播角度。',
      source: 'local',
    }, now));

    checks.push(makeCheck({
      id: 'marketing-metrics',
      category: 'pipeline',
      label: '评估指标',
      level: topic?.evaluation ? 'pass' : 'warn',
      detail: topic?.evaluation
        ? '选题有评估记录，可作为素材包的目标参考。'
        : '选题没有评估记录，营销包无法引用预测/样本依据。',
      hint: topic?.evaluation ? undefined : '这不是阻塞项；营销包里会标明未评估。',
      source: 'topic',
    }, now));
  } else if (isShortform) {
    const firstBoard = script.storyboards[0];
    const hookSeconds = firstBoard?.duration ?? 0;
    checks.push(makeCheck({
      id: 'pipeline-short-hook',
      category: 'pipeline',
      label: '短版开场钩子',
      level: firstBoard && hookSeconds <= 5 ? 'pass' : 'warn',
      detail: firstBoard
        ? `第一镜 ${hookSeconds} 秒；短版建议前 3–5 秒进入画面或结论。`
        : '没有分镜，无法判断短版开场钩子。',
      hint: firstBoard && hookSeconds <= 5 ? undefined : '把结论/冲突前置到第一镜，减少铺垫。',
      source: 'local',
    }, now));

    checks.push(makeCheck({
      id: 'pipeline-short-rhythm',
      category: 'pipeline',
      label: '短版节奏与时长',
      level: totalDuration >= 60 && totalDuration <= 180 ? 'pass' : 'warn',
      detail: totalDuration
        ? `总时长 ${totalDuration} 秒（${(totalDuration / 60).toFixed(1)} 分钟）；抖音短版建议 1–3 分钟。`
        : '分镜总时长为 0，无法判断短版节奏。',
      hint: totalDuration >= 60 && totalDuration <= 180 ? undefined : '按 1–3 分钟拆条，必要时删减铺垫镜头。',
      source: 'local',
    }, now));

    checks.push(makeCheck({
      id: 'pipeline-short-vertical',
      category: 'pipeline',
      label: '竖屏交付',
      level: 'info',
      detail: '短版默认竖屏 9:16；本任务只记录脚本/素材，成片画幅在剪辑阶段确认。',
      source: 'local',
    }, now));
  } else {
    checks.push(makeCheck({
      id: 'pipeline-long-chapters',
      category: 'pipeline',
      label: '长版章节节奏',
      level: boardCount >= 4 ? 'pass' : 'warn',
      detail: boardCount >= 4
        ? `共 ${boardCount} 个章节，适合长版叙事。`
        : `只有 ${boardCount} 个分镜，长版章节偏少，检查是否需要拆分或补充。`,
      hint: boardCount >= 4 ? undefined : '长版建议至少 4 个章节，保证信息与节奏层次。',
      source: 'local',
    }, now));
  }

  // ── 素材与版权 ──
  if (run.assetSlots.length === 0) {
    checks.push(makeCheck({
      id: 'assets-slots',
      category: 'assets',
      label: '素材清单',
      level: 'block',
      detail: '任务还没有生成素材清单。',
      source: 'local',
    }, now));
  } else {
    const missing = run.assetSlots.filter((slot) => slot.status === 'missing');
    checks.push(makeCheck({
      id: 'assets-slots',
      category: 'assets',
      label: '素材清单',
      level: missing.length ? 'block' : 'pass',
      detail: missing.length
        ? `还有 ${missing.length} 个素材槽位待准备（镜 ${missing
            .map((slot) => slot.sceneNumber)
            .join('、')}）。`
        : '所有素材槽位都已准备或标记为不需要。',
      hint: missing.length ? '逐个确认素材类型与状态后，重新检查。' : undefined,
      source: 'local',
    }, now));
  }

  // ── 素材库授权（R4） ──
  const linkedSlots = run.assetSlots.filter(
    (slot) => slot.assetId && slot.status !== 'not_needed',
  );
  const unmatchedReady = run.assetSlots.filter(
    (slot) => !slot.assetId && slot.status === 'ready',
  );
  const rightsUnknown = linkedSlots.filter(
    (slot) => getSlotRightsStatus(slot, run.platform, now) === 'unknown',
  );
  const rightsExpired = linkedSlots.filter(
    (slot) => getSlotRightsStatus(slot, run.platform, now) === 'expired',
  );
  const rightsPlatformBlocked = linkedSlots.filter(
    (slot) => getSlotRightsStatus(slot, run.platform, now) === 'platform_blocked',
  );
  const sceneList = (slots: typeof linkedSlots): string => {
    const numbers = slots.map((slot) => slot.sceneNumber);
    const head = numbers.slice(0, 5).join('、');
    return numbers.length > 5 ? `镜 ${head} 等 ${numbers.length} 镜` : `镜 ${head}`;
  };

  if (rightsUnknown.length) {
    checks.push(makeCheck({
      id: 'asset-rights-missing',
      category: 'rights',
      label: '素材授权记录',
      level: 'block',
      detail: `${sceneList(rightsUnknown)} 关联的素材缺少授权类型或允许平台，不能当作已授权。`,
      hint: '到素材库补齐授权类型与允许平台，或取消关联后人工说明来源。',
      source: 'local',
    }, now));
  }

  if (rightsExpired.length) {
    checks.push(makeCheck({
      id: 'asset-rights-expired',
      category: 'rights',
      label: '素材授权到期',
      level: 'block',
      detail: `${sceneList(rightsExpired)}：${rightsExpired
        .map((slot) => `「${slot.assetSnapshot?.title ?? '素材'}」到期 ${formatAssetExpiry(slot.assetSnapshot?.expiresAt)}`)
        .join('；')}。`,
      hint: '更新授权或换用未过期素材后再导出发布包。',
      source: 'local',
    }, now));
  }

  if (rightsPlatformBlocked.length) {
    checks.push(makeCheck({
      id: 'asset-platform-blocked',
      category: 'rights',
      label: '素材平台范围',
      level: 'block',
      detail: `${sceneList(rightsPlatformBlocked)}：${rightsPlatformBlocked
        .map((slot) => `「${slot.assetSnapshot?.title ?? '素材'}」允许平台为 ${formatAssetPlatforms(slot.assetSnapshot?.allowedPlatforms)}`)
        .join('；')}，当前任务是 ${platformLabel}。`,
      hint: '换用允许当前平台的素材，或补充授权平台范围。',
      source: 'local',
    }, now));
  }

  if (unmatchedReady.length) {
    checks.push(makeCheck({
      id: 'asset-unmatched',
      category: 'assets',
      label: '素材库匹配',
      level: 'warn',
      detail: `${sceneList(unmatchedReady)} 已标记已准备，但没有关联素材库，无法核对来源与授权。`,
      hint: '关联素材库可追溯来源；未关联不阻塞导出，但发布包会显示「未记录」。',
      source: 'local',
    }, now));
  }

  if (
    linkedSlots.length &&
    !rightsUnknown.length &&
    !rightsExpired.length &&
    !rightsPlatformBlocked.length
  ) {
    checks.push(makeCheck({
      id: 'asset-rights',
      category: 'rights',
      label: '素材授权',
      level: 'pass',
      detail: `已关联 ${linkedSlots.length} 个素材，授权类型/到期/平台范围可核验。`,
      source: 'local',
    }, now));
  }

  checks.push(makeCheck({
    id: 'rights-confirmed',
    category: 'rights',
    label: '版权/授权确认',
    level: run.rightsConfirmed ? 'pass' : 'block',
    detail: run.rightsConfirmed
      ? '已人工确认本任务素材的版权/授权。'
      : '还没有确认素材版权/授权。',
    hint: run.rightsConfirmed ? undefined : '请在素材清单底部勾选确认后再导出发布包。',
    source: 'local',
  }, now));

  // ── 配音与字幕（R5） ──
  if (pipeline.stageKeys.includes('voice')) {
    const voice = run.voiceover;
    if (!voice) {
      checks.push(makeCheck({
        id: 'voice-missing',
        category: 'voice',
        label: '配音',
        level: 'block',
        detail: '还没有生成配音。没有 TTS worker 时不会伪造音频。',
        hint: '启动 tools/tts-worker 后，在「配音与字幕」卡生成。',
        source: 'local',
      }, now));
    } else if (voice.status === 'failed') {
      checks.push(makeCheck({
        id: 'voice-failed',
        category: 'voice',
        label: '配音',
        level: 'block',
        detail: `配音生成失败：${voice.error || '未知错误'}`,
        hint: '检查本地 TTS worker 日志后重试；失败不会保留假音频。',
        source: 'local',
      }, now));
    } else {
      const voiceDuration = voice.durationSec ?? 0;
      checks.push(makeCheck({
        id: 'voice-ready',
        category: 'voice',
        label: '配音',
        level: 'pass',
        detail: `已生成配音：${voiceDuration.toFixed(1)} 秒 · ${voice.voice} · ${voice.provider}`,
        source: 'local',
      }, now));
      let level: RunCheckLevel = 'pass';
      let detail = `配音 ${voiceDuration.toFixed(1)} 秒，分镜总时长 ${totalDuration} 秒。`;
      if (!voiceDuration) {
        level = 'warn';
        detail = '配音时长未记录，无法核对与分镜时长的偏差。';
      } else if (voiceDuration > totalDuration + 5) {
        level = 'warn';
        detail = `配音 ${voiceDuration.toFixed(1)} 秒，比赛道总时长 ${totalDuration} 秒更长；剪辑时需要压缩画面或拆条。`;
      } else if (voiceDuration < totalDuration * 0.3) {
        level = 'warn';
        detail = `配音 ${voiceDuration.toFixed(1)} 秒，明显短于分镜总时长 ${totalDuration} 秒；检查台词是否覆盖完整。`;
      }
      checks.push(makeCheck({
        id: 'voice-duration',
        category: 'voice',
        label: '配音时长',
        level,
        detail,
        source: 'local',
      }, now));
    }
  }

  if (pipeline.stageKeys.includes('subtitles')) {
    const subtitles = run.subtitles;
    if (run.voiceover?.status !== 'ready') {
      // 配音缺失/失败已经阻塞；字幕阶段保持待处理，不重复加阻塞。
    } else if (!subtitles) {
      checks.push(makeCheck({
        id: 'subtitle-missing',
        category: 'subtitles',
        label: '字幕',
        level: 'block',
        detail: '配音已生成，但还没有字幕。',
        hint: '在「配音与字幕」卡点击生成字幕。',
        source: 'local',
      }, now));
    } else if (subtitles.status === 'failed') {
      checks.push(makeCheck({
        id: 'subtitle-failed',
        category: 'subtitles',
        label: '字幕',
        level: 'block',
        detail: `字幕生成失败：${subtitles.error || '未知错误'}`,
        hint: '检查 TTS 时间戳后重试；失败不会保留假字幕。',
        source: 'local',
      }, now));
    } else {
      const preset = SUBTITLE_PRESETS[subtitles.preset] ?? SUBTITLE_PRESETS.bilibili;
      const cues = subtitles.cues ?? [];
      const stats = computeSubtitleStats(cues, preset);
      checks.push(makeCheck({
        id: 'subtitle-ready',
        category: 'subtitles',
        label: '字幕',
        level: 'pass',
        detail: `已生成 ${stats.cueCount} 条字幕 · ${preset.label}。`,
        source: 'local',
      }, now));
      checks.push(makeCheck({
        id: 'subtitle-line-width',
        category: 'subtitles',
        label: '字幕行宽',
        level: stats.overlongCues ? 'warn' : 'pass',
        detail: stats.overlongCues
          ? `有 ${stats.overlongCues} 条字幕超过 ${preset.maxLineChars} 字/行（最长 ${stats.maxLineChars} 字）。`
          : `最长行 ${stats.maxLineChars} 字，未超过 ${preset.maxLineChars} 字/行。`,
        hint: stats.overlongCues ? '缩短单条字幕或拆分句子后再导出。' : undefined,
        source: 'local',
      }, now));
      checks.push(makeCheck({
        id: 'subtitle-reading-speed',
        category: 'subtitles',
        label: '字幕阅读速度',
        level: stats.fastCues ? 'warn' : 'pass',
        detail: stats.fastCues
          ? `有 ${stats.fastCues} 条字幕超过 ${preset.maxCharsPerSecond} 字/秒（最高 ${stats.maxCharsPerSecond.toFixed(1)}）。`
          : `最高 ${stats.maxCharsPerSecond.toFixed(1)} 字/秒，未超过 ${preset.maxCharsPerSecond} 字/秒。`,
        hint: stats.fastCues ? '延长镜头或拆分字幕，避免观众读不完。' : undefined,
        source: 'local',
      }, now));
      checks.push(makeCheck({
        id: 'subtitle-timing',
        category: 'subtitles',
        label: '字幕时间戳',
        level: subtitles.timingSource === 'estimated' ? 'warn' : 'pass',
        detail:
          subtitles.timingSource === 'estimated'
            ? '字幕时间按字数估算，不是 TTS 时间戳；发布前需要人工复核。'
            : '使用 TTS 句级时间戳；不是逐字强制对齐。',
        source: 'local',
      }, now));
      const coverage = subtitleCoverageRatio(script, subtitles);
      if (coverage !== null) {
        const ratio = Math.round(coverage * 100);
        checks.push(makeCheck({
          id: 'subtitle-coverage',
          category: 'subtitles',
          label: '字幕与台词抽检',
          level: ratio < 80 || ratio > 120 ? 'warn' : 'pass',
          detail: `字幕字符数 / 台词字符数 = ${ratio}%（抽检覆盖率，不宣称完全对齐）。`,
          hint: ratio < 80 || ratio > 120 ? '检查字幕是否漏句或重复。' : undefined,
          source: 'local',
        }, now));
      }
    }
  }

  return checks;
}

/** 调平台规则引擎，再组装检查项。平台接口失败不抛出，交给检查项表达。 */
export async function runPreflight(run: ProductionRun): Promise<PreflightResult> {
  const pipeline = getRunPipeline(run);
  if (!pipeline.stageKeys.includes('preflight')) {
    // 营销素材包不跑平台规则接口，只做本地简报/素材检查。
    return { checks: buildRunChecks(run) };
  }
  const script = run.snapshot.script;
  const durationSec = script.storyboards.reduce((sum, board) => sum + board.duration, 0);
  let platformCheck: PlatformCheck | undefined;
  let platformCheckError: string | undefined;

  try {
    const response = await api.evaluateCover({
      platform: run.platform,
      title: script.title.trim(),
      coverText: script.platformCheck?.coverText ?? '',
      durationSec,
      useAI: false,
    });
    if (!response?.check) throw new Error('平台规则引擎没有返回检查结果');
    platformCheck = response.check;
  } catch (error) {
    platformCheckError = (error as Error).message || '平台规则检查失败';
  }

  return {
    checks: buildRunChecks(run, platformCheck, platformCheckError),
    platformCheck,
    platformCheckError,
  };
}
