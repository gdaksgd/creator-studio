import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Clapperboard,
  ListChecks,
  Package,
  Plus,
  RotateCcw,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Stat } from '../components/ui/Stat';
import { Modal } from '../components/ui/Modal';
import { Field, Input, Select } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';
import { useScriptStore } from '../store/scriptStore';
import { useTopicStore } from '../store/topicStore';
import { useAuthStore } from '../services/authService';
import { createRun, getRunStages, listRuns, summarizeAssetProgress } from '../services/runService';
import {
  batchProgress,
  createRunBatch,
  executeRunBatch,
  getBatchCosts,
  listRunBatches,
} from '../services/batchService';
import { formatCost, type CostSummary } from '../services/costService';
import {
  PIPELINES,
  PLATFORM_LABELS,
  RUN_STATUS_META,
  VERSION_LABELS,
  VERSION_MARKETING_PIPELINE,
  getPipeline,
  getRunPipeline,
  inferPipeline,
} from '../config/productionPipeline';
import type {
  ProductionRun,
  RunBatch,
  RunBatchStatus,
  RunCostEntry,
  Script,
} from '../types';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const BATCH_STATUS_META: Record<
  RunBatchStatus,
  { label: string; variant: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }
> = {
  draft: { label: '待执行', variant: 'neutral' },
  running: { label: '执行中', variant: 'primary' },
  completed: { label: '已完成', variant: 'success' },
  partial: { label: '部分失败', variant: 'warning' },
  failed: { label: '失败', variant: 'danger' },
};

const BATCH_ITEM_META = {
  pending: { label: '待执行', variant: 'neutral' as const },
  running: { label: '预检中', variant: 'primary' as const },
  done: { label: '已预检', variant: 'success' as const },
  failed: { label: '失败', variant: 'danger' as const },
};

function scriptLabel(script: Script, topicTitle: string): string {
  return `${script.title || topicTitle || '未命名脚本'} · ${PLATFORM_LABELS[script.platform]} ${VERSION_LABELS[script.version]}`;
}

function runMatches(run: ProductionRun, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const pipeline = getRunPipeline(run);
  return `${run.title} ${run.scriptId} ${run.topicId} ${PLATFORM_LABELS[run.platform]} ${pipeline.name} ${pipeline.id}`
    .toLocaleLowerCase()
    .includes(q);
}

export default function ProductionRuns() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((state) => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const { scripts, loadScripts } = useScriptStore();
  const { topics, loadTopics } = useTopicStore();
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProductionRun['status']>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | ProductionRun['platform']>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [pipelineId, setPipelineId] = useState(PIPELINES[0].id);
  const [pipelineTouched, setPipelineTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [batches, setBatches] = useState<RunBatch[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchScriptIds, setBatchScriptIds] = useState<string[]>([]);
  const [batchConcurrency, setBatchConcurrency] = useState(2);
  const [batchCreating, setBatchCreating] = useState(false);
  const [batchDetail, setBatchDetail] = useState<RunBatch | null>(null);
  const [batchDetailCosts, setBatchDetailCosts] = useState<{
    entries: RunCostEntry[];
    summary: CostSummary;
  } | null>(null);
  const batchDetailId = batchDetail?.id ?? null;

  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const sortedScripts = useMemo(
    () => [...scripts].sort((a, b) => b.updatedAt - a.updatedAt),
    [scripts],
  );
  const selectedScript = sortedScripts.find((script) => script.id === selectedScriptId);
  const selectedTopic = selectedScript ? topicById.get(selectedScript.topicId) : undefined;
  const selectedDuration =
    selectedScript?.storyboards.reduce((sum, board) => sum + board.duration, 0) ?? 0;
  const selectedRunCount = selectedScript
    ? runs.filter((run) => run.scriptId === selectedScript.id).length
    : 0;
  const selectedPipeline = getPipeline(pipelineId);

  // 用户没手动切换流水线时，跟随所选脚本的平台/版本推断。
  useEffect(() => {
    if (!selectedScript || pipelineTouched) return;
    setPipelineId(inferPipeline(selectedScript).id);
  }, [selectedScript, pipelineTouched]);

  const load = async () => {
    setLoading(true);
    try {
      setRuns(await listRuns());
    } catch (error) {
      toast.error(`读取成片任务失败：${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadScripts();
    void loadTopics();
    void load();
    // 首次访问时演示任务可能比页面晚一步写入；1.6s 后再补一次，避免停在空状态。
    const timer = window.setTimeout(() => {
      void listRuns().then(setRuns).catch(() => undefined);
    }, 1600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadScripts, loadTopics]);

  const loadBatches = async () => {
    try {
      const rows = await listRunBatches();
      setBatches(rows);
      setBatchDetail((previous) =>
        previous ? rows.find((batch) => batch.id === previous.id) ?? previous : previous,
      );
      return rows;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    void loadBatches();
    const timer = window.setInterval(async () => {
      const rows = await loadBatches();
      if (rows.some((batch) => batch.status === 'running' || batch.status === 'draft')) {
        try {
          setRuns(await listRuns());
        } catch {
          /* 下一轮再试 */
        }
      }
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!batchDetailId) {
      setBatchDetailCosts(null);
      return;
    }
    let cancelled = false;
    void getBatchCosts(batchDetailId).then((data) => {
      if (!cancelled) setBatchDetailCosts(data);
    });
    return () => {
      cancelled = true;
    };
  }, [batchDetailId]);

  const startBatch = (batch: RunBatch, retryFailedOnly = false) => {
    void executeRunBatch(batch.id, {
      retryFailedOnly,
      actor: user?.username || '本地用户',
    })
      .then(async (next) => {
        await loadBatches();
        setRuns(await listRuns());
        const progress = batchProgress(next);
        const message = `批量预检完成：${progress.done}/${progress.total} 完成，${progress.failed} 失败`;
        if (next.status === 'failed') toast.error(message);
        else if (next.status === 'partial') toast.info(message);
        else toast.success(message);
      })
      .catch((error) => {
        toast.error(`批量预检失败：${(error as Error).message}`);
        void loadBatches();
      });
  };

  const openBatchCreate = () => {
    setBatchTitle(`批量任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    setBatchScriptIds(sortedScripts.slice(0, 5).map((script) => script.id));
    setBatchConcurrency(2);
    setBatchOpen(true);
  };

  const toggleBatchScript = (scriptId: string) => {
    setBatchScriptIds((current) =>
      current.includes(scriptId)
        ? current.filter((id) => id !== scriptId)
        : [...current, scriptId],
    );
  };

  const handleCreateBatch = async () => {
    if (!batchScriptIds.length) return;
    setBatchCreating(true);
    try {
      const batch = await createRunBatch({
        title: batchTitle,
        scriptIds: batchScriptIds,
        concurrency: batchConcurrency,
        actor: user?.username || '本地用户',
      });
      setBatchOpen(false);
      await loadBatches();
      setRuns(await listRuns());
      toast.success(`已创建 ${batch.items.length} 条任务，正在预检`);
      startBatch(batch);
    } catch (error) {
      toast.error(`批量创建失败：${(error as Error).message}`);
    } finally {
      setBatchCreating(false);
    }
  };

  // 从脚本页跳过来时自动打开创建弹窗
  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    if (!scripts.length) return;
    const requested = searchParams.get('scriptId');
    const picked = sortedScripts.find((script) => script.id === requested) ?? sortedScripts[0];
    if (picked) setSelectedScriptId(picked.id);
    setShowCreate(true);
  }, [searchParams, scripts.length, sortedScripts]);

  const closeCreate = () => {
    setShowCreate(false);
    setPipelineTouched(false);
    setSearchParams({}, { replace: true });
  };

  const openCreate = () => {
    if (!selectedScriptId && sortedScripts[0]) setSelectedScriptId(sortedScripts[0].id);
    const picked = selectedScript ?? sortedScripts[0];
    if (picked) setPipelineId(inferPipeline(picked).id);
    setPipelineTouched(false);
    setShowCreate(true);
    setSearchParams({ create: '1' }, { replace: true });
  };

  const handleCreate = async () => {
    if (!selectedScript) return;
    setCreating(true);
    try {
      const run = await createRun(
        selectedScript,
        selectedTopic,
        user?.username || '本地用户',
        pipelineId || inferPipeline(selectedScript).id,
      );
      toast.success('成片任务已创建，正在生成检查');
      setShowCreate(false);
      setSearchParams({}, { replace: true });
      navigate(`/runs/${run.id}`);
    } catch (error) {
      toast.error(`创建失败：${(error as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const visibleRuns = useMemo(
    () =>
      runs.filter((run) => {
        if (statusFilter !== 'all' && run.status !== statusFilter) return false;
        if (platformFilter !== 'all' && run.platform !== platformFilter) return false;
        return runMatches(run, query);
      }),
    [runs, statusFilter, platformFilter, query],
  );

  const activeCount = runs.filter((run) =>
    ['draft', 'blocked', 'review', 'ready'].includes(run.status),
  ).length;
  const blockedCount = runs.filter((run) => run.status === 'blocked').length;
  const readyCount = runs.filter((run) => run.status === 'ready').length;
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const exportedCount = runs.filter((run) => run.status === 'exported' && run.updatedAt >= sevenDaysAgo).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="创作台 / 成片任务"
        title="成片任务"
        description="按所选流水线把脚本或简报变成可检查、可交接的发布包；当前支持阶段工件、配音字幕与媒体包，成片渲染不在范围内。"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={openBatchCreate}
              disabled={!sortedScripts.length}
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              批量创建
            </Button>
            <Button onClick={openCreate} disabled={!sortedScripts.length}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              从脚本创建
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="进行中" value={activeCount} hint="未完成任务" tone="primary" />
        <Stat label="阻塞" value={blockedCount} hint="处理后才能导出" tone={blockedCount ? 'danger' : 'neutral'} />
        <Stat label="可导出" value={readyCount} hint="按流水线门禁" tone="success" />
        <Stat label="已导出" value={exportedCount} hint="发布包已生成" tone="info" />
      </div>

      <Card padding="md">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索成片任务</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务标题、脚本 ID、选题 ID…"
              className="pl-9"
            />
          </label>
          <Select
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="sm:w-36"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="blocked">阻塞</option>
            <option value="review">待复核</option>
            <option value="ready">可导出</option>
            <option value="exported">已导出</option>
            <option value="archived">已归档</option>
          </Select>
          <Select
            aria-label="按平台筛选"
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value as typeof platformFilter)}
            className="sm:w-32"
          >
            <option value="all">全部平台</option>
            <option value="bilibili">B站</option>
            <option value="douyin">抖音</option>
          </Select>
        </div>
      </Card>

      {batches.length ? (
        <Card padding="lg" data-testid="batch-section">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-text">
                <ListChecks className="h-4 w-4 text-text-muted" aria-hidden="true" />
                批量任务
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                批量只执行创建与发布前检查；素材、配音、复核仍需逐条完成任务门禁。
              </p>
            </div>
            <Badge variant="outline" size="sm">{batches.length} 批</Badge>
          </div>
          <div className="mt-2 divide-y divide-border/60">
            {batches.slice(0, 3).map((batch) => {
              const progress = batchProgress(batch);
              const meta = BATCH_STATUS_META[batch.status];
              const percent = progress.total
                ? Math.round(((progress.done + progress.failed) / progress.total) * 100)
                : 0;
              return (
                <div key={batch.id} className="py-3 first:pt-2 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text" title={batch.title}>{batch.title}</p>
                      <p className="mt-0.5 text-[10px] text-text-muted">
                        {formatDate(batch.createdAt)} · 并发 {batch.concurrency} · {progress.total} 条
                      </p>
                    </div>
                    <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-brand-gradient transition-[width]"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-text-muted">
                      完成 {progress.done} · 失败 {progress.failed}
                      {progress.running ? ` · 进行中 ${progress.running}` : ''}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setBatchDetail(batch)}>
                        查看
                      </Button>
                      {batch.status === 'draft' ? (
                        <Button variant="secondary" size="sm" onClick={() => startBatch(batch)}>
                          执行
                        </Button>
                      ) : null}
                      {progress.failed > 0 && batch.status !== 'running' ? (
                        <Button variant="secondary" size="sm" onClick={() => startBatch(batch, true)}>
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          重试失败项
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {batches.length > 3 ? (
            <p className="mt-2 text-[10px] text-text-muted">仅显示最近 3 批；更早的批量记录仍保存在本机。</p>
          ) : null}
        </Card>
      ) : null}

      {loading ? (
        <Card padding="lg">
          <p className="text-sm text-text-muted">读取成片任务…</p>
        </Card>
      ) : visibleRuns.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="h-5 w-5" />}
          title={runs.length ? '没有符合条件的任务' : '还没有成片任务'}
          description={
            runs.length
              ? '换一个状态或平台筛选试试。'
              : '从一份已完成的脚本开始，先跑检查。'
          }
          action={
            runs.length ? (
              <Button variant="secondary" onClick={() => { setQuery(''); setStatusFilter('all'); setPlatformFilter('all'); }}>
                清除筛选
              </Button>
            ) : (
              <Button onClick={openCreate} disabled={!sortedScripts.length}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                从脚本创建
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleRuns.map((run) => {
            const stages = getRunStages(run);
            const done = stages.filter((stage) => stage.status === 'done').length;
            const blocks = run.checks.filter((check) => check.level === 'block').length;
            const assets = summarizeAssetProgress(run.assetSlots);
            return (
              <Link key={run.id} to={`/runs/${run.id}`} className="block">
                <Card interactive padding="md" className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={RUN_STATUS_META[run.status].variant} size="sm">
                          {RUN_STATUS_META[run.status].label}
                        </Badge>
                        <Badge variant="outline" size="sm">
                          {PLATFORM_LABELS[run.platform]} · {VERSION_LABELS[run.version]}
                        </Badge>
                        <Badge variant="outline" size="sm">{getRunPipeline(run).shortLabel}</Badge>
                        {run.demo ? <Badge variant="outline" size="sm">演示任务</Badge> : null}
                        {run.publishRef ? <Badge variant="success" size="sm">已绑定发布</Badge> : null}
                      </div>
                      <h2 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-text">
                        {run.title}
                      </h2>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                    <span>阶段 {done} / {stages.length}</span>
                    <span className="text-right">素材 {assets.ready + assets.skipped} / {assets.total}</span>
                    <span>阻塞 {blocks}</span>
                    <span className="text-right">{formatDate(run.updatedAt)}</span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-brand-gradient transition-[width]"
                        style={{ width: `${(done / stages.length) * 100}%` }}
                      />
                    </div>
                    {blocks > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-danger">
                        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        {blocks} 个阻塞
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                        <Package className="h-3.5 w-3.5" aria-hidden="true" />
                        {run.pack ? '已导出' : '未导出'}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Modal
        open={batchOpen}
        onClose={() => {
          if (!batchCreating) setBatchOpen(false);
        }}
        size="lg"
        title="批量创建成片任务"
        description="选择一组脚本，创建 N 条独立任务并执行发布前检查；批量不会自动准备素材、配音或复核。"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={batchCreating}
              onClick={() => setBatchOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={batchCreating}
              disabled={!batchScriptIds.length}
              onClick={() => void handleCreateBatch()}
            >
              创建并预检（{batchScriptIds.length}）
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="任务名称">
            <Input
              value={batchTitle}
              onChange={(event) => setBatchTitle(event.target.value)}
              placeholder="例如：丝之歌发售期 · 5 条切片"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="并发数" hint="同时执行预检的任务数">
              <Select
                value={batchConcurrency}
                onChange={(event) => setBatchConcurrency(Number(event.target.value))}
              >
                <option value={1}>1 条</option>
                <option value={2}>2 条</option>
                <option value={3}>3 条</option>
              </Select>
            </Field>
            <Field label="已选脚本">
              <p className="flex h-9 items-center rounded-lg border border-border bg-surface-muted/35 px-3 text-sm text-text">
                {batchScriptIds.length} 条
              </p>
            </Field>
          </div>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-text">选择脚本</p>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBatchScriptIds(sortedScripts.map((script) => script.id))}
                >
                  全选
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setBatchScriptIds([])}>
                  清空
                </Button>
              </div>
            </div>
            <div className="mt-2 max-h-72 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border bg-surface">
              {sortedScripts.length ? sortedScripts.map((script) => {
                const topic = topicById.get(script.topicId);
                return (
                  <label
                    key={script.id}
                    className="flex cursor-pointer items-start gap-2.5 p-2.5 hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={batchScriptIds.includes(script.id)}
                      onChange={() => toggleBatchScript(script.id)}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--primary)]"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-text" title={script.title}>
                        {script.title || '未命名脚本'}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-text-muted">
                        {topic?.title || '未关联选题'} · {PLATFORM_LABELS[script.platform]} · {VERSION_LABELS[script.version]}
                      </p>
                    </div>
                  </label>
                );
              }) : (
                <p className="p-4 text-xs text-text-muted">还没有可用脚本。</p>
              )}
            </div>
          </div>
          <p className="rounded-lg border border-border bg-surface-muted/35 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            每个脚本会生成一条独立 run（按脚本平台/版本推断 v2 流水线）；批量只负责创建与预检，配音/字幕/素材/复核仍需逐条完成。
          </p>
        </div>
      </Modal>

      <Modal
        open={!!batchDetail}
        onClose={() => setBatchDetail(null)}
        size="lg"
        title={batchDetail?.title || '批量任务'}
        description={
          batchDetail
            ? `创建于 ${formatDate(batchDetail.createdAt)} · 并发 ${batchDetail.concurrency} · ${batchDetail.items.length} 条`
            : ''
        }
        footer={
          <>
            {batchDetail && batchDetail.items.some((item) => item.status === 'failed') && batchDetail.status !== 'running' ? (
              <Button variant="secondary" size="sm" onClick={() => startBatch(batchDetail, true)}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                重试失败项
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setBatchDetail(null)}>
              关闭
            </Button>
          </>
        }
      >
        {batchDetail ? (
          <div className="space-y-4" data-testid="batch-detail">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={BATCH_STATUS_META[batchDetail.status].variant} size="sm">
                {BATCH_STATUS_META[batchDetail.status].label}
              </Badge>
              <span className="text-[11px] text-text-muted">
                {batchProgress(batchDetail).done}/{batchDetail.items.length} 已预检 ·{' '}
                {batchProgress(batchDetail).failed} 失败
              </span>
              {batchDetailCosts ? (
                <span className="text-[11px] text-text-muted">
                  · 成本 {formatCost(batchDetailCosts.summary.totalActual)}
                  {batchDetailCosts.summary.unknownActual ? `（${batchDetailCosts.summary.unknownActual} 条未记录）` : ''}
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              {batchDetail.items.map((item) => {
                const run = runs.find((row) => row.id === item.runId);
                const itemMeta = BATCH_ITEM_META[item.status];
                const runMeta = run ? RUN_STATUS_META[run.status] : null;
                const blockCount = run ? run.checks.filter((check) => check.level === 'block').length : 0;
                return (
                  <div key={`${item.runId}-${item.scriptId}`} className="rounded-xl border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-text" title={item.runTitle}>{item.runTitle}</p>
                        <p className="mt-0.5 text-[10px] text-text-muted">
                          {PLATFORM_LABELS[item.platform]} · {VERSION_LABELS[item.version]} · 预检 {item.attempts} 次
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={itemMeta.variant} size="sm">{itemMeta.label}</Badge>
                        {runMeta ? <Badge variant={runMeta.variant} size="sm">{runMeta.label}</Badge> : null}
                        {blockCount ? <Badge variant="danger" size="sm">阻塞项 {blockCount}</Badge> : null}
                      </div>
                    </div>
                    {item.error ? <p className="mt-2 text-[11px] text-danger">{item.error}</p> : null}
                    {item.runId ? (
                      <Link
                        to={`/runs/${item.runId}`}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        打开任务
                        <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] leading-relaxed text-text-muted">
              批量「已预检」只表示发布前检查跑完，不代表任务可以导出；阻塞项与素材/配音/复核状态以每条任务详情为准。成本按该批任务已记录的供应商调用汇总。
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={showCreate}
        onClose={closeCreate}
        size="lg"
        title="创建成片任务"
        description="创建后会锁定当前脚本快照；之后修改源脚本不会影响这个任务。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeCreate} disabled={creating}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!selectedScript}
              onClick={() => void handleCreate()}
            >
              创建并检查
            </Button>
          </>
        }
      >
        {sortedScripts.length === 0 ? (
          <EmptyState
            compact
            title="还没有可用的脚本"
            description="先到脚本编辑页完成一份脚本，再回来创建成片任务。"
            action={<Button size="sm" onClick={() => navigate('/scripts')}>去写脚本</Button>}
          />
        ) : (
          <div className="space-y-4">
            <Field label="选择脚本" hint="一个任务对应一个平台和一个脚本版本">
              <Select
                value={selectedScriptId}
                onChange={(event) => setSelectedScriptId(event.target.value)}
              >
                {sortedScripts.map((script) => (
                  <option key={script.id} value={script.id}>
                    {scriptLabel(script, topicById.get(script.topicId)?.title ?? '')}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="流水线" hint="默认按脚本平台/版本推断；创建后不可切换">
              <Select
                aria-label="选择流水线"
                value={pipelineId}
                onChange={(event) => {
                  setPipelineTouched(true);
                  setPipelineId(event.target.value);
                }}
              >
                {PIPELINES.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name} · {pipeline.id}@{pipeline.version}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="rounded-lg border border-border bg-surface-muted/35 px-3 py-2 text-xs leading-relaxed text-text-secondary">
              {selectedPipeline.description}
            </p>
            {selectedPipeline.id === VERSION_MARKETING_PIPELINE.id ? (
              <p className="rounded-lg border border-warning/30 bg-warning-soft/50 px-3 py-2 text-xs leading-relaxed text-warning">
                营销包不跑平台规则、不导出完整分镜，也不进入人工复核阶段；仍会要求素材与版权确认。
              </p>
            ) : null}

            {selectedScript ? (
              <Card padding="md" className="space-y-3 bg-surface-muted/35">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="primary" size="sm">
                    {PLATFORM_LABELS[selectedScript.platform]} · {VERSION_LABELS[selectedScript.version]}
                  </Badge>
                  <Badge variant="outline" size="sm">{selectedScript.storyboards.length} 镜</Badge>
                  <Badge variant="outline" size="sm">{selectedDuration} 秒</Badge>
                  {selectedRunCount > 0 ? <Badge variant="warning" size="sm">已有 {selectedRunCount} 个任务</Badge> : null}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">{selectedScript.title || '未命名脚本'}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    关联选题：{selectedTopic?.title || '未关联'} · 源脚本更新于{' '}
                    {new Date(selectedScript.updatedAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {selectedPipeline.stageKeys.includes('voice')
                    ? '创建后会生成发布前检查、素材清单、配音与字幕、复核记录。'
                    : selectedPipeline.stageKeys.includes('review')
                      ? '创建后会生成发布前检查、素材清单和复核记录。'
                      : '创建后会生成素材清单与本地检查，不进入人工复核。'}
                  当前版本不包含成片。
                </p>
              </Card>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
