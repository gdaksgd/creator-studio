import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  CircleCheck,
  Download,
  ExternalLink,
  History,
  Info,
  Captions,
  Layers,
  Library,
  Link2,
  Mic,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  Trash2,
  TriangleAlert,
  Unlink,
  X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { SourceNote } from '../components/ui/SourceNote';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { useScriptStore } from '../store/scriptStore';
import { useTopicStore } from '../store/topicStore';
import { useAuthStore } from '../services/authService';
import {
  MAX_RUN_EVENTS,
  archiveRun,
  assignSlotAsset,
  bindRunPublish,
  createVariantRun,
  deleteRun,
  findRunPublishConflict,
  getRun,
  getRunStages,
  listCampaignRuns,
  publishRefMatches,
  recordCampaignPack,
  recordRunPack,
  recordRunVoiceover,
  recordRunVoiceFailure,
  refreshRun,
  syncRunAssetRights,
  saveReview,
  saveRunNotes,
  setRightsConfirmed,
  summarizeAssetProgress,
  unbindRunPublish,
  updateAssetSlot,
  type RunPublishInput,
} from '../services/runService';
import {
  buildCampaignPackWithMedia,
  buildRunPackWithMedia,
  buildStageArtifacts,
  downloadRunPack,
  downloadStageArtifact,
  type RunPackMode,
} from '../services/runPack';
import { getRunVoiceMedia } from '../services/runMedia';
import { formatCost, listRunCosts, summarizeCosts } from '../services/costService';
import {
  PROVIDERS,
  PROVIDER_CAPABILITY_LABELS,
  PROVIDER_RUNTIME_LABELS,
  getProvider,
} from '../config/providers';
import {
  DEFAULT_VOICE_SETTINGS,
  TTS_PITCHES,
  TTS_RATES,
  TTS_VOICES,
  checkTtsWorker,
  synthesizeVoice,
  type TtsHealth,
} from '../services/ttsService';
import {
  SUBTITLE_PRESETS,
  buildEstimatedSubtitles,
  buildSubtitlesFromBoundaries,
  buildVoiceScript,
  subtitlePresetForPlatform,
} from '../services/subtitleService';
import {
  ASSET_KIND_LABELS,
  ASSET_STATUS_LABELS,
  PLATFORM_LABELS,
  RUN_CHECK_LEVEL_META,
  RUN_STATUS_META,
  VERSION_LABELS,
  VERSION_MARKETING_PIPELINE,
  getRunPipeline,
  inferPipeline,
} from '../config/productionPipeline';
import { useAssetStore } from '../store/assetStore';
import {
  ASSET_RIGHTS_META,
  assetTypeMatchesSlot,
  evaluateAssetRights,
  formatAssetExpiry,
  formatAssetLicense,
  formatAssetPlatforms,
  formatAssetSource,
  getSlotMatchStatus,
  getSlotRightsStatus,
  suggestAssetsForSlot,
} from '../services/assetRights';
import { cn } from '../utils/cn';
import { formatDeviation, formatViews } from '../utils/prediction';
import type {
  AssetSlot,
  AssetSlotKind,
  AssetSlotStatus,
  LibraryAsset,
  LibraryAssetType,
  Platform,
  ProductionRun,
  RunCostEntry,
  RunCheck,
  RunCheckLevel,
  RunEventType,
} from '../types';

// 创建后详情页自动跑预检；StrictMode 双挂载时共享同一个 Promise，避免重复请求。
const pendingAutoChecks = new Map<string, Promise<ProductionRun>>();
function ensureRunChecked(runId: string, actor: string): Promise<ProductionRun> {
  const existing = pendingAutoChecks.get(runId);
  if (existing) return existing;
  const promise = refreshRun(runId, actor).finally(() => pendingAutoChecks.delete(runId));
  pendingAutoChecks.set(runId, promise);
  return promise;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function formatCueTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const ARTIFACT_HINTS: Record<string, string> = {
  'script.md': '当前脚本快照（Markdown）',
  'shotlist.csv': '逐镜时长、画面与台词（CSV）',
  'assets.csv': '素材槽位状态与备注（CSV）',
  'checks.json': '预检明细与依据（JSON）',
  'publish.md': '平台规则与人工清单（Markdown）',
};

const LIBRARY_TYPE_LABELS: Record<LibraryAssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  link: '链接',
  document: '文档',
};

function AssetLibraryOption({
  asset,
  current,
  platform,
  onPick,
}: {
  asset: LibraryAsset;
  current: boolean;
  platform: Platform;
  onPick: () => void;
}) {
  const rightsMeta = ASSET_RIGHTS_META[evaluateAssetRights(asset, platform)];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`选择素材 ${asset.title}`}
      className={cn(
        'flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition-colors',
        current
          ? 'border-primary/30 bg-primary-soft/30'
          : 'border-border bg-surface hover:border-primary/30 hover:bg-surface-hover',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" size="sm">{LIBRARY_TYPE_LABELS[asset.type]}</Badge>
          <Badge variant={rightsMeta.variant} size="sm" title={rightsMeta.description}>{rightsMeta.label}</Badge>
          {current ? <Badge variant="primary" size="sm">当前关联</Badge> : null}
        </div>
        <p className="mt-1 truncate text-xs font-medium text-text" title={asset.title}>{asset.title}</p>
        <p className="mt-0.5 text-[10px] text-text-muted">
          {formatAssetSource(asset.sourceType)} · {formatAssetLicense(asset.license)} · 到期 {formatAssetExpiry(asset.expiresAt)} · {formatAssetPlatforms(asset.allowedPlatforms)}
        </p>
        {asset.tags.length ? (
          <p className="mt-0.5 truncate text-[10px] text-text-muted">#{asset.tags.join(' #')}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-[11px] text-primary">{current ? '已关联' : '选择'}</span>
    </button>
  );
}

const RUN_EVENT_META: Record<
  RunEventType,
  { label: string; variant: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline' }
> = {
  created: { label: '创建', variant: 'primary' },
  checked: { label: '检查', variant: 'info' },
  asset_updated: { label: '素材', variant: 'warning' },
  rights_confirmed: { label: '版权', variant: 'success' },
  rights_revoked: { label: '版权', variant: 'neutral' },
  review_approved: { label: '复核', variant: 'success' },
  review_revoked: { label: '复核', variant: 'neutral' },
  pack_exported: { label: '导出', variant: 'info' },
  archived: { label: '归档', variant: 'neutral' },
  note_updated: { label: '备注', variant: 'outline' },
  publish_bound: { label: '发布', variant: 'primary' },
  publish_unbound: { label: '发布', variant: 'neutral' },
  voice_generated: { label: '配音', variant: 'success' },
  voice_failed: { label: '配音', variant: 'danger' },
  subtitles_generated: { label: '字幕', variant: 'success' },
  subtitles_failed: { label: '字幕', variant: 'danger' },
};

function CheckIcon({ level }: { level: RunCheckLevel }) {
  if (level === 'block') return <X className="h-4 w-4 text-danger" aria-hidden="true" />;
  if (level === 'warn') return <TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" />;
  if (level === 'pass') return <CircleCheck className="h-4 w-4 text-success" aria-hidden="true" />;
  return <Info className="h-4 w-4 text-text-muted" aria-hidden="true" />;
}

function CheckList({ checks, level }: { checks: RunCheck[]; level: RunCheckLevel }) {
  const filtered = checks.filter((check) => check.level === level);
  if (!filtered.length) return null;
  const meta = RUN_CHECK_LEVEL_META[level];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
        <span className="text-[11px] text-text-muted">{filtered.length} 项</span>
      </div>
      <div className="space-y-2">
        {filtered.map((check) => (
          <div key={check.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0"><CheckIcon level={level} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-text">{check.label}</p>
                  <Badge variant="outline" size="sm">
                    {check.source === 'platform' ? '平台规则' : check.source === 'topic' ? '选题依据' : '本地检查'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{check.detail}</p>
                {check.hint ? <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{check.hint}</p> : null}
                {check.evidence ? (
                  <SourceNote tier={check.evidence.level} label="依据" note={check.evidence.note}>
                    {check.evidence.source}
                  </SourceNote>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageRail({ run }: { run: ProductionRun }) {
  const stages = getRunStages(run);
  return (
    <Card padding="md">
      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          stages.length === 3
            ? 'sm:grid-cols-3'
            : stages.length === 7
              ? 'sm:grid-cols-7'
              : 'sm:grid-cols-5',
        )}
      >
        {stages.map((stage, index) => {
          const done = stage.status === 'done';
          const active = stage.status === 'active';
          const blocked = stage.status === 'blocked';
          return (
            <div key={stage.key} className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                  done
                    ? 'border-success/30 bg-success-soft text-success'
                    : blocked
                      ? 'border-danger/30 bg-danger-soft text-danger'
                      : active
                        ? 'border-primary/30 bg-primary-soft text-primary-contrast'
                        : 'border-border bg-surface-muted text-text-muted',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className={cn('text-xs font-medium', active ? 'text-primary-contrast' : 'text-text')}>
                  {stage.label}
                </p>
                <p className="mt-0.5 text-[10px] text-text-muted">
                  {stage.status === 'done' ? '完成' : stage.status === 'active' ? '进行中' : stage.status === 'blocked' ? '阻塞' : '待处理'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <span className="min-w-0 text-right text-xs text-text">{children}</span>
    </div>
  );
}

function RunTimeline({ events = [] }: { events?: ProductionRun['events'] }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => b.event.at - a.event.at || b.index - a.index);
  const visible = expanded ? ordered : ordered.slice(0, 8);
  return (
    <Card padding="lg" data-testid="run-timeline">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-text">
            <History className="h-4 w-4 text-text-muted" aria-hidden="true" />
            运行记录
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            谁在什么时候检查、改素材、复核、导出，都会记在这里。
          </p>
        </div>
        {ordered.length > 8 ? (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起' : `展开全部 ${ordered.length} 条`}
          </Button>
        ) : null}
      </div>
      {!ordered.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface-muted/35 p-4 text-sm text-text-muted">
          还没有操作记录。
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {visible.map(({ event, index }) => {
            const meta = RUN_EVENT_META[event.type] ?? { label: '记录', variant: 'outline' as const };
            return (
              <li key={`${event.id}-${index}`} className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
                    <span className="text-[11px] text-text-muted">{formatDate(event.at)} · {event.actor}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">{event.summary}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {events.length >= MAX_RUN_EVENTS ? (
        <p className="mt-3 text-[10px] text-text-muted">
          只保留最近 {MAX_RUN_EVENTS} 条操作记录，更早的记录已截断。
        </p>
      ) : null}
    </Card>
  );
}

export default function ProductionRunDetail() {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((state) => state.user);
  const { scripts, loadScripts } = useScriptStore();
  const { topics, loadTopics } = useTopicStore();
  const { assets: libraryAssets, loadAssets, touchAsset } = useAssetStore();
  const [run, setRun] = useState<ProductionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [exporting, setExporting] = useState<RunPackMode | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [binding, setBinding] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [bindConflict, setBindConflict] = useState<{ title: string; input: RunPublishInput } | null>(null);
  const [campaignRuns, setCampaignRuns] = useState<ProductionRun[]>([]);
  const [variantOpen, setVariantOpen] = useState(false);
  const [variantScriptId, setVariantScriptId] = useState('');
  const [creatingVariant, setCreatingVariant] = useState(false);
  const [exportingCampaign, setExportingCampaign] = useState(false);
  const [assetSlotTarget, setAssetSlotTarget] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [voiceWorker, setVoiceWorker] = useState<TtsHealth | null>(null);
  const [voiceSettings, setVoiceSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceAudioUrl, setVoiceAudioUrl] = useState('');
  const [voiceMediaMissing, setVoiceMediaMissing] = useState(false);
  const [costs, setCosts] = useState<RunCostEntry[]>([]);
  const [providerOpen, setProviderOpen] = useState(false);
  const actor = user?.username || '本地用户';
  const costRunId = run?.id;
  const costRunUpdatedAt = run?.updatedAt;

  useEffect(() => {
    void loadScripts();
    void loadTopics();
    void loadAssets();
  }, [loadScripts, loadTopics, loadAssets]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        // 首次加载时 App 可能还在补演示任务；给本地写入留一点时间，最多等 3 秒。
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const next = await getRun(runId);
          if (cancelled) return;
          if (next) {
            setRun(next);
            setReviewer(next.review.reviewer || user?.username || '本地复核');
            setReviewNote(next.review.note);
            setNotesDraft(next.notes);
            if (!next.checks.length) {
              setRechecking(true);
              try {
                const checked = await ensureRunChecked(next.id, actor);
                if (cancelled) return;
                setRun(checked);
                setReviewer(checked.review.reviewer || user?.username || '本地复核');
                setReviewNote(checked.review.note);
                setNotesDraft(checked.notes);
              } catch (error) {
                if (!cancelled) toast.error(`发布前检查失败：${(error as Error).message}`);
              } finally {
                if (!cancelled) setRechecking(false);
              }
            }
            return;
          }
          if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        if (!cancelled) setRun(null);
      } catch (error) {
        if (!cancelled) toast.error(`读取任务失败：${(error as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // runId 变化时才重新读取；reviewer/notes 的初始值只跟任务加载有关。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (!run) return;
    if (!getRunPipeline(run).stageKeys.includes('voice')) return;
    let cancelled = false;
    void checkTtsWorker().then((health) => {
      if (!cancelled) setVoiceWorker(health);
    });
    return () => {
      cancelled = true;
    };
    // 只在任务切换时检查；v1/营销包不请求本地 worker。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  // 只在切换任务时用已保存设置初始化；生成失败/成功后不打断用户当前选择。
  useEffect(() => {
    if (!run) return;
    setVoiceSettings({
      voice: run.voiceSettings?.voice ?? run.voiceover?.voice ?? DEFAULT_VOICE_SETTINGS.voice,
      rate: run.voiceSettings?.rate ?? run.voiceover?.rate ?? DEFAULT_VOICE_SETTINGS.rate,
      pitch: run.voiceSettings?.pitch ?? run.voiceover?.pitch ?? DEFAULT_VOICE_SETTINGS.pitch,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setVoiceAudioUrl('');
    setVoiceMediaMissing(false);
    if (!run?.voiceover?.mediaId) return;
    void getRunVoiceMedia(run.id).then((media) => {
      if (cancelled) return;
      if (!media) {
        setVoiceMediaMissing(true);
        return;
      }
      objectUrl = URL.createObjectURL(media.blob);
      setVoiceAudioUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [run?.id, run?.voiceover?.mediaId]);

  useEffect(() => {
    let cancelled = false;
    if (!run) {
      setCampaignRuns([]);
      return;
    }
    if (!run.campaignId) {
      setCampaignRuns([run]);
      return;
    }
    void listCampaignRuns(run.campaignId)
      .then((rows) => {
        if (!cancelled) setCampaignRuns(rows.length ? rows : [run]);
      })
      .catch(() => {
        if (!cancelled) setCampaignRuns([run]);
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  useEffect(() => {
    if (!costRunId) return;
    let cancelled = false;
    void listRunCosts(costRunId).then((rows) => {
      if (!cancelled) setCosts(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [costRunId, costRunUpdatedAt]);

  const sourceScript = useMemo(
    () => scripts.find((script) => script.id === run?.scriptId),
    [scripts, run?.scriptId],
  );
  const sourceTopic = useMemo(
    () => topics.find((topic) => topic.id === run?.topicId),
    [topics, run?.topicId],
  );
  const snapshotStale = !!run && !!sourceScript && sourceScript.updatedAt > run.snapshot.scriptUpdatedAt;
  const stageArtifacts = useMemo(() => (run ? buildStageArtifacts(run) : []), [run]);
  const variantScripts = useMemo(
    () =>
      run
        ? scripts.filter(
            (script) =>
              script.topicId === run.topicId &&
              script.id !== run.scriptId &&
              script.platform !== run.platform,
          )
        : [],
    [scripts, run],
  );
  const published = sourceTopic?.published;
  const publishInput: RunPublishInput | null =
    sourceTopic && published
      ? {
          topicId: sourceTopic.id,
          platform: published.platform,
          bvid: published.bvid,
          url: published.url,
          title: published.title,
          publishedAt: published.publishedAt,
        }
      : null;
  const publishBound = !!publishInput && publishRefMatches(run?.publishRef, publishInput);
  const publishPlatformMismatch = !!published && published.platform !== run?.platform;
  const predictedValue = sourceTopic
    ? sourceTopic.prediction?.value ?? sourceTopic.estimatedViews
    : 0;
  const hasPrediction = Number.isFinite(predictedValue) && predictedValue > 0;
  const predictionSourceLabel =
    sourceTopic?.prediction?.source === 'manual'
      ? '人工目标'
      : sourceTopic?.prediction?.source === 'ai'
        ? 'AI 预测'
        : '历史目标';
  const actualMetrics: Array<{ label: string; value: number | undefined }> = published
    ? [
        { label: '播放', value: published.views },
        { label: '点赞', value: published.likes },
        { label: '投币', value: published.coins },
        { label: '收藏', value: published.favorites },
        { label: '分享', value: published.shares },
        { label: '评论', value: published.comments },
      ]
    : [];

  if (loading) {
    return (
      <div className="space-y-4">
        <Link to="/runs" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          返回成片任务
        </Link>
        <Card padding="lg"><p className="text-sm text-text-muted">读取任务…</p></Card>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Link to="/runs" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          返回成片任务
        </Link>
        <EmptyState
          title="成片任务不存在"
          description="它可能已经被删除。"
          action={<Button onClick={() => navigate('/runs')}>返回列表</Button>}
        />
      </div>
    );
  }

  const pipeline = getRunPipeline(run);
  const hasPreflight = pipeline.stageKeys.includes('preflight');
  const hasVoice = pipeline.stageKeys.includes('voice');
  const hasSubtitles = pipeline.stageKeys.includes('subtitles');
  const hasReview = pipeline.stageKeys.includes('review');
  const isMarketing = pipeline.id === VERSION_MARKETING_PIPELINE.id;
  const variantScriptSelected = variantScripts.find((script) => script.id === variantScriptId);
  const variantPipeline = variantScriptSelected ? inferPipeline(variantScriptSelected) : null;
  const assetSlotTargetSlot = run.assetSlots.find((slot) => slot.id === assetSlotTarget) ?? null;
  const assetQuery = assetSearch.trim().toLocaleLowerCase();
  const matchesAssetSearch = (asset: (typeof libraryAssets)[number]) =>
    !assetQuery ||
    `${asset.title} ${asset.tags.join(' ')} ${asset.note}`.toLocaleLowerCase().includes(assetQuery);
  const pickerSuggestions = assetSlotTargetSlot
    ? suggestAssetsForSlot(assetSlotTargetSlot, libraryAssets, run.scriptId).filter(matchesAssetSearch)
    : [];
  const suggestedIds = new Set(pickerSuggestions.map((asset) => asset.id));
  const pickerAssets = assetSlotTargetSlot
    ? libraryAssets
        .filter((asset) => assetTypeMatchesSlot(assetSlotTargetSlot.kind, asset.type))
        .filter(matchesAssetSearch)
        .sort((a, b) => {
          const aRelated = a.relatedScriptId === run.scriptId ? 1 : 0;
          const bRelated = b.relatedScriptId === run.scriptId ? 1 : 0;
          return bRelated - aRelated || Number(!!b.favorite) - Number(!!a.favorite) || b.updatedAt - a.updatedAt;
        })
    : [];
  const otherPickerAssets = pickerAssets.filter((asset) => !suggestedIds.has(asset.id));
  const costSummary = summarizeCosts(costs);
  const recentCosts = [...costs].sort((a, b) => b.at - a.at).slice(0, 5);
  const blocks = run.checks.filter((check) => check.level === 'block');
  const warnings = run.checks.filter((check) => check.level === 'warn');
  const assets = summarizeAssetProgress(run.assetSlots);
  const canPublish = run.status === 'ready' || (run.status === 'exported' && !run.pack?.stale);
  const reviewDisabled =
    savingReview ||
    blocks.length > 0 ||
    !run.rightsConfirmed ||
    (warnings.length > 0 && !reviewNote.trim());

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      const next = await refreshRun(run.id, actor);
      setRun(next);
      setReviewer(next.review.reviewer || user?.username || '本地复核');
      setReviewNote(next.review.note);
      toast.success('重新检查完成');
    } catch (error) {
      toast.error(`检查失败：${(error as Error).message}`);
    } finally {
      setRechecking(false);
    }
  };

  const handleExport = async (mode: RunPackMode) => {
    setExporting(mode);
    try {
      const synced = await syncRunAssetRights(run.id);
      setRun(synced);
      let voiceBlob: Blob | undefined;
      if (synced.voiceover?.status === 'ready') {
        const media = await getRunVoiceMedia(synced.id);
        if (!media) throw new Error('配音文件不在本机，重新生成或检查本机 IndexedDB');
        voiceBlob = media.blob;
      }
      const result = await buildRunPackWithMedia(synced, mode, voiceBlob);
      downloadRunPack(result);
      const next = await recordRunPack(
        synced.id,
        {
          exportedAt: Date.now(),
          fileName: result.fileName,
          fileCount: result.fileCount,
        },
        mode,
        actor,
      );
      setRun(next);
      toast.success(mode === 'publish' ? '发布交接包已生成' : '草稿交接包已生成');
    } catch (error) {
      toast.error(`导出失败：${(error as Error).message}`);
    } finally {
      setExporting(null);
    }
  };

  const handleAssetChange = async (
    slotId: string,
    patch: { kind?: AssetSlotKind; status?: AssetSlotStatus; note?: string },
  ) => {
    try {
      const next = await updateAssetSlot(run.id, slotId, patch, actor);
      setRun(next);
    } catch (error) {
      toast.error(`保存素材状态失败：${(error as Error).message}`);
    }
  };

  const openAssetPicker = (slot: AssetSlot) => {
    setAssetSlotTarget(slot.id);
    setAssetSearch('');
    void loadAssets();
  };

  const handleAssignAsset = async (assetId: string) => {
    if (!assetSlotTarget) return;
    try {
      const next = await assignSlotAsset(run.id, assetSlotTarget, assetId, actor);
      setRun(next);
      await touchAsset(assetId);
      await loadAssets();
      setAssetSlotTarget(null);
      setAssetSearch('');
      toast.success('已关联素材库并刷新授权');
    } catch (error) {
      toast.error(`关联素材失败：${(error as Error).message}`);
    }
  };

  const handleUnassignAsset = async (slotId: string) => {
    try {
      const next = await assignSlotAsset(run.id, slotId, null, actor);
      setRun(next);
      toast.success('已取消素材库关联');
    } catch (error) {
      toast.error(`取消关联失败：${(error as Error).message}`);
    }
  };

  const handleGenerateVoice = async () => {
    setGeneratingVoice(true);
    setVoiceError('');
    try {
      const health = await checkTtsWorker();
      setVoiceWorker(health);
      if (!health.ok) throw new Error(health.error || 'TTS worker 未运行');
      const text = buildVoiceScript(run.snapshot.script);
      if (!text) throw new Error('脚本没有可配音的台词');
      const result = await synthesizeVoice(text, voiceSettings);
      const charCount = [...text.replace(/\s+/g, '')].length;
      const presetId = subtitlePresetForPlatform(run.platform);
      const duration = result.durationSec > 0
        ? result.durationSec
        : Math.max(1, [...text.replace(/\s+/g, '')].length / 4);
      let subtitles = result.boundaries.length
        ? buildSubtitlesFromBoundaries(result.boundaries, presetId, duration)
        : buildEstimatedSubtitles(text, presetId, duration);
      if (!subtitles.cueCount) {
        subtitles = buildEstimatedSubtitles(text, presetId, duration);
      }
      const next = await recordRunVoiceover(
        run.id,
        {
          blob: result.blob,
          durationSec: duration,
          provider: result.provider,
          voice: result.voice,
          rate: result.rate,
          pitch: result.pitch,
          charCount,
          boundaries: result.boundaries,
          subtitles,
        },
        actor,
      );
      setRun(next);
      toast.success('配音与字幕已生成');
    } catch (error) {
      const message = (error as Error).message;
      setVoiceError(message);
      try {
        const next = await recordRunVoiceFailure(run.id, message, voiceSettings, actor);
        setRun(next);
      } catch {
        /* 保留本地错误提示 */
      }
      toast.error(`配音生成失败：${message}`);
    } finally {
      setGeneratingVoice(false);
    }
  };

  const handleCheckWorker = async () => {
    const health = await checkTtsWorker();
    setVoiceWorker(health);
    if (health.ok) toast.success('TTS worker 已连接');
    else toast.error(health.error || 'TTS worker 未运行');
  };

  const handleDownloadVoice = () => {
    if (!voiceAudioUrl) return;
    const anchor = document.createElement('a');
    anchor.href = voiceAudioUrl;
    anchor.download = run.voiceover?.fileName || 'voiceover.mp3';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleDownloadSubtitles = () => {
    if (!run.subtitles?.content) return;
    const blob = new Blob([run.subtitles.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = run.subtitles.fileName || 'subtitles.srt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleRights = async (confirmed: boolean) => {
    try {
      const next = await setRightsConfirmed(run.id, confirmed, actor);
      setRun(next);
      setReviewNote(next.review.note);
    } catch (error) {
      toast.error(`保存版权确认失败：${(error as Error).message}`);
    }
  };

  const handleReview = async (approved: boolean) => {
    setSavingReview(true);
    try {
      const next = await saveReview(
        run.id,
        {
          approved,
          reviewer: reviewer || user?.username || '本地复核',
          note: reviewNote,
        },
        actor,
      );
      setRun(next);
      toast.success(approved ? '已标记复核通过' : '已撤销复核');
    } catch (error) {
      toast.error(`保存复核失败：${(error as Error).message}`);
    } finally {
      setSavingReview(false);
    }
  };

  const handleBindPublish = async (input: RunPublishInput, force = false) => {
    setBinding(true);
    try {
      if (!force) {
        const conflict = await findRunPublishConflict(run.id, input);
        if (conflict) {
          setBindConflict({ title: conflict.title, input });
          return;
        }
      }
      const next = await bindRunPublish(run.id, input, { actor, force });
      setRun(next);
      setBindConflict(null);
      toast.success('已绑定本次发布');
    } catch (error) {
      toast.error(`绑定失败：${(error as Error).message}`);
    } finally {
      setBinding(false);
    }
  };

  const handleUnbindPublish = async () => {
    setUnbinding(true);
    try {
      const next = await unbindRunPublish(run.id, actor);
      setRun(next);
      toast.success('已解绑发布记录');
    } catch (error) {
      toast.error(`解绑失败：${(error as Error).message}`);
    } finally {
      setUnbinding(false);
    }
  };

  const openVariantDialog = () => {
    if (!variantScripts.length) return;
    setVariantScriptId(variantScripts[0].id);
    setVariantOpen(true);
  };

  const handleCreateVariant = async () => {
    if (!variantScriptId) return;
    setCreatingVariant(true);
    try {
      const result = await createVariantRun(run.id, variantScriptId, actor);
      setRun(result.original);
      if (result.original.campaignId) {
        setCampaignRuns(await listCampaignRuns(result.original.campaignId));
      }
      const selected = variantScripts.find((script) => script.id === variantScriptId);
      setVariantOpen(false);
      toast.success(
        selected
          ? `已创建同组任务：${PLATFORM_LABELS[selected.platform]} · ${VERSION_LABELS[selected.version]}`
          : '已创建同组任务',
      );
    } catch (error) {
      toast.error(`创建同组任务失败：${(error as Error).message}`);
    } finally {
      setCreatingVariant(false);
    }
  };

  const handleCampaignExport = async () => {
    if (!run.campaignId) return;
    setExportingCampaign(true);
    try {
      const rows = await listCampaignRuns(run.campaignId);
      if (rows.length < 2) throw new Error('至少需要两条同组任务');
      for (const row of rows) {
        await syncRunAssetRights(row.id);
      }
      const syncedRows = await listCampaignRuns(run.campaignId);
      const voiceBlobs = new Map<string, Blob>();
      for (const row of syncedRows) {
        if (row.voiceover?.status === 'ready') {
          const media = await getRunVoiceMedia(row.id);
          if (!media) throw new Error(`「${row.title}」的配音文件不在本机`);
          voiceBlobs.set(row.id, media.blob);
        }
      }
      const result = await buildCampaignPackWithMedia(syncedRows, run.campaignId, voiceBlobs);
      downloadRunPack(result);
      await recordCampaignPack(
        syncedRows.map((row) => row.id),
        { fileName: result.fileName, fileCount: result.fileCount },
        actor,
      );
      setCampaignRuns(await listCampaignRuns(run.campaignId));
      const current = await getRun(run.id);
      if (current) setRun(current);
      toast.success('组合包已生成');
    } catch (error) {
      toast.error(`导出组合包失败：${(error as Error).message}`);
    } finally {
      setExportingCampaign(false);
    }
  };

  const handleSaveNotes = async () => {
    if (notesDraft === run.notes) return;
    try {
      const next = await saveRunNotes(run.id, notesDraft, actor);
      setRun(next);
    } catch (error) {
      toast.error(`保存备注失败：${(error as Error).message}`);
    }
  };

  const handleArchive = async () => {
    try {
      const next = await archiveRun(run.id, actor);
      setRun(next);
      toast.success('任务已归档');
    } catch (error) {
      toast.error(`归档失败：${(error as Error).message}`);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteRun(run.id);
      toast.success('任务已删除');
      navigate('/runs');
    } catch (error) {
      toast.error(`删除失败：${(error as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Link to="/runs" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        返回成片任务
      </Link>

      <PageHeader
        eyebrow="创作台 / 成片任务"
        title={run.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={RUN_STATUS_META[run.status].variant} size="sm">{RUN_STATUS_META[run.status].label}</Badge>
            <Badge variant="outline" size="sm">{PLATFORM_LABELS[run.platform]} · {VERSION_LABELS[run.version]}</Badge>
            <Badge variant="outline" size="sm">{pipeline.name} · {pipeline.id}@{pipeline.version}</Badge>
            {run.demo ? <Badge variant="outline" size="sm">演示任务 · 非实绩</Badge> : null}
            <span className="text-xs text-text-muted">更新于 {formatDate(run.updatedAt)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" loading={rechecking} onClick={() => void handleRecheck()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              重新检查
            </Button>
            <Button variant="secondary" size="sm" loading={exporting === 'draft'} onClick={() => void handleExport('draft')}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              导出草稿包
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={exporting === 'publish'}
              disabled={!canPublish}
              title={
                canPublish
                  ? undefined
                  : hasReview
                    ? '复核通过、版权确认且没有阻塞项后才能导出发布包'
                    : '版权确认且没有阻塞项后才能导出发布包'
              }
              onClick={() => void handleExport('publish')}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              导出发布包
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleArchive()} disabled={run.status === 'archived'}>
              归档
            </Button>
            <Button variant="dangerGhost" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              删除
            </Button>
          </>
        }
      />

      {snapshotStale ? (
        <Card padding="md" className="border-warning/30 bg-warning-soft/50">
          <p className="text-xs leading-relaxed text-warning">
            源脚本已更新。当前任务使用创建时的快照，不会被自动覆盖。
            <Link
              to={`/runs?create=1&scriptId=${encodeURIComponent(run.scriptId)}`}
              className="ml-1 font-medium underline underline-offset-2"
            >
              基于最新脚本新建任务
            </Link>
          </p>
        </Card>
      ) : null}

      <StageRail run={run} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card padding="lg">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text">
                  {hasPreflight ? '发布前检查' : '素材与发布检查'}
                </h2>
                <p className="mt-1 text-xs text-text-muted">
                  {blocks.length} 个阻塞 · {warnings.length} 个提醒 · {run.checks.filter((check) => check.level === 'pass').length} 个通过
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pipeline-check-groups">
                  {pipeline.checkGroups.map((group) => {
                    const count = run.checks.filter((check) =>
                      group.categories.includes(check.category),
                    ).length;
                    return count ? (
                      <Badge key={group.key} variant="outline" size="sm">
                        {group.label} {count}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </div>
              <Badge variant={blocks.length ? 'danger' : 'success'} size="sm">
                {blocks.length ? '有阻塞，发布包不可导出' : '无阻塞项'}
              </Badge>
            </div>
            {!run.checks.length ? (
              <p className="text-sm text-text-muted">
                {rechecking
                  ? hasPreflight
                    ? '正在运行发布前检查…'
                    : '正在生成素材与发布检查…'
                  : '还没有检查结果，点右上角「重新检查」。'}
              </p>
            ) : (
              <div className="space-y-4">
                <CheckList checks={run.checks} level="block" />
                <CheckList checks={run.checks} level="warn" />
                <CheckList checks={run.checks} level="pass" />
                <CheckList checks={run.checks} level="info" />
              </div>
            )}
          </Card>

          <Card padding="lg">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text">素材清单</h2>
                <p className="mt-1 text-xs text-text-muted">
                  已准备 {assets.ready} / {assets.total} · 不需要 {assets.skipped} · 待准备 {assets.missing}
                </p>
              </div>
              <Badge variant={assets.missing ? 'danger' : 'success'} size="sm">
                {assets.missing ? `${assets.missing} 个待准备` : '素材已确认'}
              </Badge>
            </div>

            <div className="space-y-2">
              {run.assetSlots.map((slot) => {
                const snapshot = slot.assetSnapshot;
                const linked = !!slot.assetId;
                const rightsMeta = ASSET_RIGHTS_META[getSlotRightsStatus(slot, run.platform)];
                const suggestions = linked ? [] : suggestAssetsForSlot(slot, libraryAssets, run.scriptId);
                return (
                  <div
                    key={slot.id}
                    data-testid={`asset-slot-${slot.sceneNumber}`}
                    className="rounded-xl border border-border bg-surface p-3"
                  >
                    <div className="grid gap-2 md:grid-cols-[48px_minmax(0,1fr)_120px_105px_minmax(0,1fr)] md:items-center">
                      <div className="flex items-center gap-2 md:block">
                        <span className="text-[11px] text-text-muted">镜</span>
                        <span className="num text-sm font-semibold text-text">{slot.sceneNumber}</span>
                        <span className="text-[10px] text-text-muted">· {slot.duration}s</span>
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-xs font-medium text-text">{slot.description || '未填写画面描述'}</p>
                        {slot.visualDirection ? <p className="mt-0.5 line-clamp-1 text-[10px] text-text-muted">画面方向：{slot.visualDirection}</p> : null}
                      </div>
                      <Select
                        aria-label={`镜 ${slot.sceneNumber} 素材类型`}
                        value={slot.kind}
                        onChange={(event) => void handleAssetChange(slot.id, { kind: event.target.value as typeof slot.kind })}
                        className="h-8 text-xs"
                      >
                        {Object.entries(ASSET_KIND_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                      <Select
                        aria-label={`镜 ${slot.sceneNumber} 素材状态`}
                        value={slot.status}
                        onChange={(event) => void handleAssetChange(slot.id, { status: event.target.value as typeof slot.status })}
                        className="h-8 text-xs"
                      >
                        {Object.entries(ASSET_STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                      <Input
                        aria-label={`镜 ${slot.sceneNumber} 素材备注`}
                        defaultValue={slot.note}
                        placeholder="素材备注…"
                        className="h-8 text-xs"
                        onBlur={(event) => {
                          if (event.target.value !== slot.note) {
                            void handleAssetChange(slot.id, { note: event.target.value });
                          }
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                      {linked ? (
                        <>
                          <Badge variant={rightsMeta.variant} size="sm" title={rightsMeta.description}>
                            {rightsMeta.label}
                          </Badge>
                          <span className="min-w-0 truncate text-[11px] font-medium text-text-secondary" title={snapshot?.title}>
                            素材库：{snapshot?.title ?? slot.assetId}
                          </span>
                          {snapshot ? (
                            <span className="text-[10px] text-text-muted">
                              {formatAssetSource(snapshot.sourceType)} · {formatAssetLicense(snapshot.license)} · 到期 {formatAssetExpiry(snapshot.expiresAt)} · {formatAssetPlatforms(snapshot.allowedPlatforms)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-warning">素材库快照缺失，重新检查后刷新</span>
                          )}
                          {slot.matchStatus === 'missing' ? (
                            <span className="text-[10px] text-danger">素材库记录已删除，请重新关联</span>
                          ) : null}
                          <Button variant="ghost" size="sm" onClick={() => openAssetPicker(slot)}>更换</Button>
                          <Button variant="ghost" size="sm" onClick={() => void handleUnassignAsset(slot.id)}>取消关联</Button>
                        </>
                      ) : (
                        <>
                          <Badge variant="outline" size="sm">
                            {getSlotMatchStatus(slot) === 'missing' ? '素材缺失' : '未关联素材库'}
                          </Badge>
                          {slot.status === 'ready' ? (
                            <span className="text-[10px] text-warning">已标记已准备，但授权无法核对</span>
                          ) : null}
                          {suggestions.length ? (
                            <span className="min-w-0 truncate text-[10px] text-text-muted">
                              建议：{suggestions[0].title} 等 {suggestions.length} 个
                            </span>
                          ) : null}
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`镜 ${slot.sceneNumber} 选择素材库素材`}
                            onClick={() => openAssetPicker(slot)}
                          >
                            <Library className="h-3.5 w-3.5" aria-hidden="true" />
                            从素材库选择
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-muted/35 p-3">
              <input
                type="checkbox"
                checked={run.rightsConfirmed}
                onChange={(event) => void handleRights(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="text-xs font-medium text-text">我已确认本任务使用的素材版权/授权</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-text-muted">
                  v1 只记录确认状态和时间，不保存授权文件；未确认时不能导出发布包。
                </span>
              </span>
            </label>
          </Card>

          {hasVoice || hasSubtitles ? (
            <Card padding="lg" data-testid="voice-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold text-text">
                    <Mic className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    配音与字幕
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    本地 Edge TTS worker 生成；音频只存本机 IndexedDB，不进入备份和云同步。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={voiceWorker?.ok ? 'success' : voiceWorker ? 'danger' : 'outline'}
                    size="sm"
                  >
                    {voiceWorker?.ok
                      ? `Worker 已连接 · ${voiceWorker.provider ?? 'edge-tts'}`
                      : voiceWorker
                        ? 'Worker 未运行'
                        : '检查 Worker…'}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => void handleCheckWorker()}>
                    检查
                  </Button>
                </div>
              </div>

              {voiceWorker && !voiceWorker.ok ? (
                <div className="mt-3 rounded-xl border border-warning/30 bg-warning-soft/50 p-3 text-xs leading-relaxed text-warning">
                  {voiceWorker.error}
                  <span className="mt-1 block font-mono text-[10px]">
                    powershell -File tools/tts-worker/start-tts-worker.ps1
                  </span>
                  <span className="mt-1 block">没有 worker 时不会生成假音频。</span>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="音色">
                  <Select
                    aria-label="配音音色"
                    value={voiceSettings.voice}
                    disabled={generatingVoice}
                    onChange={(event) => setVoiceSettings((current) => ({ ...current, voice: event.target.value }))}
                  >
                    {TTS_VOICES.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="语速">
                  <Select
                    aria-label="配音语速"
                    value={voiceSettings.rate}
                    disabled={generatingVoice}
                    onChange={(event) => setVoiceSettings((current) => ({ ...current, rate: event.target.value }))}
                  >
                    {TTS_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="音调">
                  <Select
                    aria-label="配音音调"
                    value={voiceSettings.pitch}
                    disabled={generatingVoice}
                    onChange={(event) => setVoiceSettings((current) => ({ ...current, pitch: event.target.value }))}
                  >
                    {TTS_PITCHES.map((pitch) => (
                      <option key={pitch} value={pitch}>{pitch}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={generatingVoice}
                  disabled={!voiceWorker?.ok}
                  onClick={() => void handleGenerateVoice()}
                >
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  {run.voiceover?.status === 'ready' ? '重新生成配音与字幕' : '生成配音与字幕'}
                </Button>
                {!voiceWorker?.ok ? <span className="text-[11px] text-text-muted">先启动本地 TTS worker</span> : null}
                {run.voiceover?.status === 'ready' ? (
                  <span className="text-[11px] text-text-muted">
                    {run.voiceover.durationSec?.toFixed(1) ?? '—'} 秒 · {run.voiceover.voice}
                  </span>
                ) : null}
              </div>

              {voiceError || run.voiceover?.status === 'failed' ? (
                <p className="mt-3 rounded-xl border border-danger/30 bg-danger-soft p-3 text-xs leading-relaxed text-danger">
                  {voiceError || run.voiceover?.error || '配音生成失败'}
                </p>
              ) : null}

              {run.voiceover?.status === 'ready' ? (
                <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface-muted/35 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success" size="sm">配音已生成</Badge>
                    <span className="text-xs text-text-secondary">
                      {run.voiceover.voice} · {run.voiceover.durationSec?.toFixed(1)} 秒 · {run.voiceover.provider}
                    </span>
                    <Button variant="secondary" size="sm" onClick={handleDownloadVoice}>
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      下载 MP3
                    </Button>
                  </div>
                  {voiceMediaMissing ? (
                    <p className="text-xs leading-relaxed text-danger">
                      音频文件不在本机（可能来自备份恢复）。重新生成配音后才能播放和导出媒体包。
                    </p>
                  ) : voiceAudioUrl ? (
                    <audio
                      controls
                      src={voiceAudioUrl}
                      preload="metadata"
                      className="w-full"
                      data-testid="voice-audio"
                    />
                  ) : (
                    <p className="text-xs text-text-muted">读取本机音频…</p>
                  )}
                </div>
              ) : null}

              {run.subtitles?.status === 'ready' ? (
                <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-muted/35 p-3" data-testid="subtitle-panel">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success" size="sm">字幕已生成</Badge>
                    <span className="text-xs text-text-secondary">
                      {run.subtitles.cueCount ?? 0} 条 · {SUBTITLE_PRESETS[run.subtitles.preset].label} · 最长行 {run.subtitles.maxLineChars ?? 0} 字 · 最高 {run.subtitles.maxCharsPerSecond ?? 0} 字/秒
                    </span>
                    <Button variant="secondary" size="sm" onClick={handleDownloadSubtitles}>
                      <Captions className="h-3.5 w-3.5" aria-hidden="true" />
                      下载 SRT
                    </Button>
                    {run.subtitles.timingSource === 'estimated' ? (
                      <Badge variant="warning" size="sm">估算时间</Badge>
                    ) : (
                      <Badge variant="outline" size="sm">TTS 句级时间戳</Badge>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {(run.subtitles.cues ?? []).slice(0, 4).map((cue) => (
                      <div key={cue.index} className="flex gap-2 text-[11px] text-text-secondary">
                        <span className="num shrink-0 text-text-muted">{formatCueTime(cue.startMs)}</span>
                        <span className="whitespace-pre-line">{cue.text}</span>
                      </div>
                    ))}
                    {(run.subtitles.cues?.length ?? 0) > 4 ? (
                      <p className="text-[10px] text-text-muted">仅预览前 4 条…</p>
                    ) : null}
                  </div>
                </div>
              ) : run.voiceover?.status === 'ready' ? (
                <p className="mt-3 text-xs text-text-muted">字幕尚未生成；重新生成配音会自动生成字幕。</p>
              ) : null}
            </Card>
          ) : null}

          {hasReview ? (
          <Card padding="lg">
            <h2 className="text-base font-semibold text-text">人工复核</h2>
            {run.review.approved ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success" size="sm"><ShieldCheck className="h-3.5 w-3.5" /> 复核已通过</Badge>
                  <span className="text-xs text-text-muted">
                    {run.review.reviewer} · {run.review.approvedAt ? formatDate(run.review.approvedAt) : ''}
                  </span>
                </div>
                {run.review.note ? (
                  <p className="rounded-xl border border-border bg-surface-muted/35 p-3 text-xs leading-relaxed text-text-secondary">
                    {run.review.note}
                  </p>
                ) : null}
                <Button variant="secondary" size="sm" loading={savingReview} onClick={() => void handleReview(false)}>
                  撤销复核
                </Button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <Field label="复核人">
                  <Input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="输入复核人" />
                </Field>
                <Field
                  label="复核备注"
                  hint={warnings.length ? `有 ${warnings.length} 个提醒项，备注必填` : '可选：记录本次判断或交接说明'}
                >
                  <Textarea
                    rows={3}
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    placeholder="例如：素材已确认，时长落在 B站区间；发布后回填播放数据。"
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingReview}
                    disabled={reviewDisabled}
                    title={
                      blocks.length
                        ? '还有阻塞项'
                        : !run.rightsConfirmed
                          ? '请先确认版权/授权'
                          : warnings.length && !reviewNote.trim()
                            ? '有提醒项，请填写复核备注'
                            : undefined
                    }
                    onClick={() => void handleReview(true)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    标记复核通过
                  </Button>
                  {blocks.length ? <span className="text-[11px] text-danger">先处理 {blocks.length} 个阻塞项</span> : null}
                </div>
              </div>
            )}
          </Card>
          ) : null}

          <Card padding="lg" data-testid="publish-calibration">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text">发布回填与校准</h2>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  实际播放来自 B站接口或人工填写；预测只用于校准，不是承诺。
                </p>
              </div>
              {sourceTopic ? (
                <Badge variant="outline" size="sm" title={sourceTopic.title}>
                  {sourceTopic.title}
                </Badge>
              ) : null}
            </div>

            {!sourceTopic ? (
              <p className="mt-4 rounded-xl border border-dashed border-border bg-surface-muted/35 p-4 text-sm text-text-muted">
                找不到源选题（可能已删除），无法显示发布数据。
              </p>
            ) : !published ? (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-surface-muted/35 p-4">
                <p className="text-sm font-medium text-text">这个选题还没有发布记录。</p>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                  发布后回到选题看板填写 B站链接，系统会取回真实播放与互动数据；这里不会补 0 或占位数字。
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate(`/?publish=${encodeURIComponent(sourceTopic.id)}`)}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  去记录发布
                </Button>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {actualMetrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-lg border border-border bg-surface px-2 py-2 text-center"
                    >
                      <div className="num text-sm font-semibold text-text">{formatViews(metric.value)}</div>
                      <div className="text-xs text-text-muted">{metric.label}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-border bg-surface-muted/35 p-3">
                  <SummaryRow label="发布时间">{formatDate(published.publishedAt)}</SummaryRow>
                  <SummaryRow label="BVID">{published.bvid || '—'}</SummaryRow>
                  <SummaryRow label="取数时间">{formatDate(published.fetchedAt)}</SummaryRow>
                  <SummaryRow label="数据来源">{published.source === 'auto' ? 'B站接口' : '人工填写'}</SummaryRow>
                  <SummaryRow label="预测">
                    {hasPrediction ? (
                      <span>
                        {formatViews(predictedValue)}
                        <span className="ml-1 text-text-muted">· {predictionSourceLabel}</span>
                      </span>
                    ) : (
                      '该选题没有数字化预测'
                    )}
                  </SummaryRow>
                  <SummaryRow label="偏差">
                    {!hasPrediction
                      ? '不计算'
                      : published.views === undefined
                        ? '发布记录没有播放量'
                        : formatDeviation(predictedValue, published.views)}
                  </SummaryRow>
                </div>

                {publishPlatformMismatch ? (
                  <div className="rounded-xl border border-warning/30 bg-warning-soft/50 p-3 text-xs leading-relaxed text-warning">
                    发布记录属于{PLATFORM_LABELS[published.platform]}，当前任务是{PLATFORM_LABELS[run.platform]}，不能直接绑定。
                    这里只展示真实数据，不能作为本任务的直接校准。
                  </div>
                ) : publishBound && run.publishRef ? (
                  <div className="rounded-xl border border-success/30 bg-success-soft/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-success">
                          已绑定本次任务{run.publishRef.bvid ? ` · BVID ${run.publishRef.bvid}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          绑定于 {formatDate(run.publishRef.boundAt)}
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" loading={unbinding} onClick={() => void handleUnbindPublish()}>
                        <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                        解绑
                      </Button>
                    </div>
                  </div>
                ) : publishInput ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={binding}
                      onClick={() => void handleBindPublish(publishInput)}
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {run.publishRef ? '重新绑定本次发布' : '绑定本次发布'}
                    </Button>
                    {run.publishRef ? (
                      <span className="text-[11px] leading-relaxed text-text-muted">
                        当前绑定的是另一条发布记录{run.publishRef.bvid ? `（${run.publishRef.bvid}）` : ''}，重新绑定会替换它。
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card padding="lg">
            <h2 className="text-base font-semibold text-text">任务备注</h2>
            <Textarea
              rows={3}
              className="mt-3"
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              onBlur={() => void handleSaveNotes()}
              placeholder="记录这次任务的背景、对接人或特殊要求…"
            />
          </Card>
        </div>

        <div className="space-y-4">
          <Card padding="lg">
            <h2 className="text-base font-semibold text-text">任务摘要</h2>
            <div className="mt-2">
              <SummaryRow label="源脚本">
                <Link to={`/scripts/${run.scriptId}`} className="text-primary hover:underline">
                  {run.snapshot.script.title || run.scriptId}
                </Link>
              </SummaryRow>
              <SummaryRow label="源选题">
                {sourceTopic ? (
                  <Link to="/" className="text-primary hover:underline">{sourceTopic.title}</Link>
                ) : (
                  run.topicId || '未关联'
                )}
              </SummaryRow>
              <SummaryRow label="流水线">
                {pipeline.name} · {pipeline.id}@{pipeline.version}
              </SummaryRow>
              <SummaryRow label={isMarketing ? '素材槽位' : '分镜'}>
                {isMarketing
                  ? `${run.assetSlots.length} 个 · 打包不含完整分镜`
                  : `${run.snapshot.script.storyboards.length} 镜 · ${run.snapshot.script.storyboards.reduce((sum, board) => sum + board.duration, 0)} 秒`}
              </SummaryRow>
              <SummaryRow label="素材">
                {assets.ready + assets.skipped} / {assets.total} 已准备或不需要
              </SummaryRow>
              <SummaryRow label="版权">
                {run.rightsConfirmed ? '已确认' : <span className="text-danger">未确认</span>}
              </SummaryRow>
              <SummaryRow label="复核">
                {!hasReview ? '不适用' : run.review.approved ? '已通过' : '未通过'}
              </SummaryRow>
              {hasVoice ? (
                <SummaryRow label="配音">
                  {run.voiceover?.status === 'ready'
                    ? `${run.voiceover.durationSec?.toFixed(1) ?? '—'} 秒 · ${run.voiceover.voice}`
                    : run.voiceover?.status === 'failed'
                      ? '生成失败'
                      : '未生成'}
                </SummaryRow>
              ) : null}
              {hasSubtitles ? (
                <SummaryRow label="字幕">
                  {run.subtitles?.status === 'ready'
                    ? `${run.subtitles.cueCount ?? 0} 条 · ${SUBTITLE_PRESETS[run.subtitles.preset].label}`
                    : run.subtitles?.status === 'failed'
                      ? '生成失败'
                      : '未生成'}
                </SummaryRow>
              ) : null}
              <SummaryRow label="快照时间">
                {formatDate(run.snapshot.capturedAt)}
              </SummaryRow>
            </div>
          </Card>

          <Card padding="lg" data-testid="stage-artifacts">
            <h2 className="text-base font-semibold text-text">阶段工件</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              不需要导出整包，也可以只拿当前阶段的工件。
            </p>
            <div className="mt-2 divide-y divide-border/60">
              {stageArtifacts.map((artifact) => (
                <div key={artifact.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text">
                      {artifact.label}
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-text-muted">{artifact.fileName}</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-text-muted">{ARTIFACT_HINTS[artifact.fileName]}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`下载 ${artifact.fileName}`}
                    title={`下载 ${artifact.fileName}`}
                    onClick={() => downloadStageArtifact(artifact)}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
              只包含当前任务的文本工件，不含媒体文件；完整包仍用下方导出按钮。
            </p>
          </Card>

          <Card padding="lg">
            <h2 className="text-base font-semibold text-text">导出交接包</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              当前流水线「{pipeline.name}」导出下方工件；有配音/字幕时会包含媒体文件，不含成片。
            </p>
            <div className="mt-3 space-y-3" data-testid="pack-file-list">
              {pipeline.packSections.map((section) => (
                <div key={section.key}>
                  <p className="text-[10px] font-medium tracking-wide text-text-muted">{section.label}</p>
                  <div className="mt-1 space-y-1">
                    {section.files.map((file) => (
                      <div key={file} className="flex items-center gap-2 text-[11px] text-text-secondary">
                        <span className="h-1 w-1 rounded-full bg-primary" aria-hidden="true" />
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                loading={exporting === 'publish'}
                disabled={!canPublish}
                onClick={() => void handleExport('publish')}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                {run.pack ? '重新导出发布包' : '导出发布包'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                loading={exporting === 'draft'}
                onClick={() => void handleExport('draft')}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                导出草稿包
              </Button>
            </div>
            {run.pack ? (
              <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
                发布包：{run.pack.fileName} · {formatDate(run.pack.exportedAt)}
                {run.pack.stale ? ' · 内容已变更，需重新导出' : ''}
              </p>
            ) : null}
            {run.draftPack ? (
              <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
                草稿包：{run.draftPack.fileName} · {formatDate(run.draftPack.exportedAt)}
              </p>
            ) : null}
          </Card>

          <Card padding="lg" data-testid="cost-card">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-text">
                  <Wallet className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  成本
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  记录供应商调用与成本；实际账单以供应商为准，未记录的金额不补 0。
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setProviderOpen(true)}>
                供应商
              </Button>
            </div>
            {costs.length ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-2 text-xs">
                  <span className="text-text-secondary">实际合计</span>
                  <span className="num font-semibold text-text">{formatCost(costSummary.totalActual)}</span>
                </div>
                {costSummary.unknownActual ? (
                  <p className="text-[10px] text-warning">
                    {costSummary.unknownActual} 条实际成本未记录，未计入合计。
                  </p>
                ) : null}
                {recentCosts.map((entry) => {
                  const provider = getProvider(entry.providerId);
                  const cost = entry.actualCost !== null
                    ? formatCost(entry.actualCost)
                    : entry.estimatedCost !== null
                      ? `预估 ${formatCost(entry.estimatedCost)}`
                      : '未记录';
                  return (
                    <div key={entry.id} className="rounded-lg border border-border bg-surface p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-text">{provider?.name ?? entry.providerId}</span>
                        <span className="text-[11px] text-text-secondary">{cost}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-text-muted">
                        {PROVIDER_CAPABILITY_LABELS[entry.capability]} · {entry.operation} · {entry.units} {entry.unitLabel} · {formatDate(entry.at)}
                      </p>
                    </div>
                  );
                })}
                {costs.length > 5 ? <p className="text-[10px] text-text-muted">仅显示最近 5 条…</p> : null}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-border bg-surface-muted/35 p-3 text-xs text-text-muted">
                还没有供应商调用记录。生成配音或使用 API 后会记录在这里。
              </p>
            )}
          </Card>

          <Card padding="md" className="border-info/30 bg-info-soft/40">
            <p className="text-[11px] leading-relaxed text-info">
              <Info className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              {hasReview
                ? '发布包只在没有阻塞项、版权已确认、复核通过后可导出；草稿包随时可导出，并会在 README 中标明 DRAFT 和未通过项。'
                : '发布包只在没有阻塞项、版权已确认后可导出（本流水线无人工复核）；草稿包随时可导出，并会标明 DRAFT。'}
            </p>
          </Card>
        </div>
      </div>

      <Card padding="lg" data-testid="campaign-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-text">
              <Layers className="h-4 w-4 text-text-muted" aria-hidden="true" />
              同组任务
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              同一选题的 B站/抖音版本可以成组生产；检查、素材和复核互不影响。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!variantScripts.length}
              title={variantScripts.length ? undefined : '同选题下没有另一平台的脚本'}
              onClick={openVariantDialog}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              创建另一平台任务
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={exportingCampaign}
              disabled={campaignRuns.length < 2}
              onClick={() => void handleCampaignExport()}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              导出组合包
            </Button>
          </div>
        </div>

        {campaignRuns.length <= 1 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-surface-muted/35 p-4">
            <p className="text-sm font-medium text-text">还没有同组任务。</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              从当前任务创建另一平台的同选题任务后，这里会并列显示两条任务，并可以导出组合包。
            </p>
            {!variantScripts.length ? (
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                这个选题下没有其他平台的脚本版本；先到脚本页补一条对应平台脚本。
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {campaignRuns.map((item) => {
              const itemPipeline = getRunPipeline(item);
              const itemBlocks = item.checks.filter((check) => check.level === 'block').length;
              const itemAssets = summarizeAssetProgress(item.assetSlots);
              const isCurrent = item.id === run.id;
              return (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-xl border p-3',
                    isCurrent ? 'border-primary/30 bg-primary-soft/30' : 'border-border bg-surface',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={RUN_STATUS_META[item.status].variant} size="sm">
                          {RUN_STATUS_META[item.status].label}
                        </Badge>
                        <Badge variant="outline" size="sm">
                          {PLATFORM_LABELS[item.platform]} · {VERSION_LABELS[item.version]}
                        </Badge>
                        <Badge variant="outline" size="sm">{itemPipeline.shortLabel}</Badge>
                        {isCurrent ? <Badge variant="primary" size="sm">当前任务</Badge> : null}
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs font-medium text-text">{item.title}</p>
                    </div>
                    {!isCurrent ? (
                      <Link to={`/runs/${item.id}`} className="text-xs text-primary hover:underline">
                        打开
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                    <span>阻塞 {itemBlocks}</span>
                    <span>素材 {itemAssets.ready + itemAssets.skipped} / {itemAssets.total}</span>
                    <span>
                      {item.pack && !item.pack.stale
                        ? `已导出${item.pack.mode === 'publish' ? '发布包' : '草稿包'}`
                        : '未导出'}
                    </span>
                    {item.publishRef ? <span>已绑定发布</span> : null}
                  </div>
                </div>
              );
            })}
            <p className="text-[10px] leading-relaxed text-text-muted">
              组合包会把每条任务的交接包放进各自目录；未就绪任务使用 DRAFT 包，并在 campaign.json 标注状态。
            </p>
          </div>
        )}
      </Card>

      <RunTimeline events={run.events ?? []} />

      <Modal
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        size="lg"
        title="供应商与成本口径"
        description="成片流水线默认只调用本地规则与本地 TTS；付费供应商需要人工确认，实际金额以供应商账单为准。"
        footer={
          <Button variant="ghost" size="sm" onClick={() => setProviderOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-2" data-testid="provider-registry">
          {PROVIDERS.map((provider) => (
            <div key={provider.id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">{provider.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" size="sm">{PROVIDER_CAPABILITY_LABELS[provider.capability]}</Badge>
                  <Badge variant="outline" size="sm">{PROVIDER_RUNTIME_LABELS[provider.runtime]}</Badge>
                  <Badge variant={provider.paid ? 'warning' : 'success'} size="sm">
                    {provider.paid ? '付费' : '免费'}
                  </Badge>
                  {provider.requiresWorker ? <Badge variant="info" size="sm">需本地 worker</Badge> : null}
                </div>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">{provider.description}</p>
              <p className="mt-1 text-[11px] text-text-muted">
                计价：{provider.pricing.unitLabel} ·{' '}
                {provider.pricing.estimatedCostPerUnit === null
                  ? '按供应商账单'
                  : formatCost(provider.pricing.estimatedCostPerUnit)}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">{provider.pricing.note}</p>
              {provider.requiresWorker ? (
                <p className="mt-0.5 text-[10px] text-text-muted">
                  Worker 状态：{voiceWorker?.ok ? '已连接' : '未运行'}
                </p>
              ) : null}
              {provider.requiresConfirmation ? (
                <p className="mt-1 text-[10px] leading-relaxed text-warning">
                  首次使用需要人工确认；当前成片流水线不会自动调用该付费供应商。
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!assetSlotTargetSlot}
        onClose={() => setAssetSlotTarget(null)}
        size="lg"
        title={assetSlotTargetSlot ? `为镜 ${assetSlotTargetSlot.sceneNumber} 选择素材` : '选择素材'}
        description="按类型/标签/关键词给出建议，不会自动认定；授权未记录或平台不符的素材会阻塞发布包。"
        footer={
          <Button variant="ghost" size="sm" onClick={() => setAssetSlotTarget(null)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <label className="relative block">
            <span className="sr-only">搜索素材库</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <Input
              className="pl-9"
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder="搜索名称、标签、备注…"
            />
          </label>

          {!libraryAssets.length ? (
            <EmptyState
              compact
              title="素材库还是空的"
              description="先收藏素材并记录来源/授权，再回来关联。"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setAssetSlotTarget(null);
                    navigate('/library');
                  }}
                >
                  去素材库
                </Button>
              }
            />
          ) : (
            <>
              {pickerSuggestions.length ? (
                <section>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-text">建议匹配</p>
                    <span className="text-[10px] text-text-muted">按类型/标签/关键词排序，仍需你确认</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {pickerSuggestions.map((asset) => (
                      <AssetLibraryOption
                        key={asset.id}
                        asset={asset}
                        current={asset.id === assetSlotTargetSlot?.assetId}
                        platform={run.platform}
                        onPick={() => void handleAssignAsset(asset.id)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-text">全部可用素材</p>
                  <span className="text-[10px] text-text-muted">{otherPickerAssets.length} 条</span>
                </div>
                {otherPickerAssets.length ? (
                  <div className="mt-2 space-y-2">
                    {otherPickerAssets.map((asset) => (
                      <AssetLibraryOption
                        key={asset.id}
                        asset={asset}
                        current={asset.id === assetSlotTargetSlot?.assetId}
                        platform={run.platform}
                        onPick={() => void handleAssignAsset(asset.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-xl border border-dashed border-border bg-surface-muted/35 p-3 text-xs text-text-muted">
                    没有更多匹配素材。可以调整搜索词，或先去素材库补充。
                  </p>
                )}
              </section>

              <p className="text-[10px] leading-relaxed text-text-muted">
                未记录授权的素材仍可选择，但会在「素材授权记录」检查中阻塞发布包；可到素材库补齐授权类型与允许平台。
              </p>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={variantOpen}
        onClose={() => {
          if (!creatingVariant) setVariantOpen(false);
        }}
        size="md"
        title="创建另一平台任务"
        description="选择同一选题下另一平台的脚本版本。新任务会锁定自己的脚本快照，单独走检查、素材与复核。"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={creatingVariant}
              onClick={() => setVariantOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={creatingVariant}
              disabled={!variantScriptId}
              onClick={() => void handleCreateVariant()}
            >
              创建同组任务
            </Button>
          </>
        }
      >
        {variantScripts.length ? (
          <div className="space-y-4">
            <Field label="选择脚本" hint="只列出同选题、另一平台的脚本版本">
              <Select
                aria-label="选择另一平台脚本"
                value={variantScriptId}
                onChange={(event) => setVariantScriptId(event.target.value)}
              >
                {variantScripts.map((script) => (
                  <option key={script.id} value={script.id}>
                    {script.title || '未命名脚本'} · {PLATFORM_LABELS[script.platform]}{' '}
                    {VERSION_LABELS[script.version]}
                  </option>
                ))}
              </Select>
            </Field>
            {variantPipeline ? (
              <p className="rounded-lg border border-border bg-surface-muted/35 px-3 py-2 text-xs leading-relaxed text-text-secondary">
                新任务流水线：{variantPipeline.name} · {variantPipeline.id}@{variantPipeline.version}
              </p>
            ) : null}
            <p className="text-[11px] leading-relaxed text-text-muted">
              原任务的内容、检查、素材和导出包都不会被改写；两条任务只共享选题与 campaign 关联。
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            这个选题下没有另一平台的脚本版本。先到脚本页补一条对应平台的脚本，再回来创建同组任务。
          </p>
        )}
      </Modal>

      <Modal
        open={!!bindConflict}
        onClose={() => setBindConflict(null)}
        size="sm"
        title="该发布记录已绑定到另一条任务"
        description={bindConflict ? `发布记录已经绑定在「${bindConflict.title}」上。继续会把绑定转移到当前任务，原任务保留但不再指向这条发布记录。` : ''}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setBindConflict(null)} disabled={binding}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={binding}
              onClick={() => {
                if (bindConflict) void handleBindPublish(bindConflict.input, true);
              }}
            >
              继续绑定
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          这个操作只改变本机成片任务的绑定关系，不会修改选题的发布记录，也不会改动已经导出的交接包。
        </p>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="删除这个成片任务？"
        description="只删除任务记录，不会删除源脚本、选题或已下载的交接包。"
        confirmLabel="删除任务"
        pending={deleting}
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
