import { useEffect, useRef, useState, useMemo, lazy, Suspense, useId } from 'react';
import { api, AUTH_TOKEN_KEY, type AccountInfo, type SyncResult, type SyncHistoryEntry } from '../api/client';
import { useTopicStore } from '../store/topicStore';
import { useAuthStore } from '../services/authService';
// 小时级本地缓存：账号统计只有「手动同步」或「改抖音数据」时才会变，
// 没必要每次打开都去服务端读一遍云端快照（本机实测 1.2～2.0 秒）。
import { isCacheFresh, loadWithCache, readCache, writeCache } from '../services/queryCache';
import { formatDeviation, formatViews } from '../utils/prediction';
import type { BenchmarkSnapshot, RetrospectiveTag } from '../types';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Select } from '../components/ui/Input';
import { SourceNote } from '../components/ui/SourceNote';
import { Stat } from '../components/ui/Stat';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { Skeleton } from '../components/ui/Skeleton';
import { LoadingBlock } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
// 只引类型：编译期就被抹掉，不会把 charts.tsx（以及它 import 的 recharts）拉回来
import type { ComparisonBarsProps, TrendChartProps } from './analytics/charts';
import { CHART } from './analytics/tokens';
import { CATEGORIES } from '../config/categories';
import {
  Activity,
  Clapperboard,
  Layers,
  Play,
  RefreshCw,
  Ruler,
  Target,
  ThumbsUp,
  TrendingUp,
  Users,
} from 'lucide-react';

// ─── Chart Components（按需加载）────────────────────────────

// recharts 约 400 kB raw：把它关进独立的 async chunk（charts-*.js），
// 页面骨架、指标卡与数据请求先渲染完，图表模块下载完再填进 Suspense 的坑位。
const LazyTrendChart = lazy(() =>
  import('./analytics/charts').then((m) => ({ default: m.TrendChart })),
);
const LazyComparisonBars = lazy(() =>
  import('./analytics/charts').then((m) => ({ default: m.ComparisonBars })),
);

/** 骨架与真图同高：图表 chunk 落地时不会把下面的内容顶下去 */
function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <Skeleton className="h-full w-full" />
    </div>
  );
}

function SnapshotTrendChart({ data, height = 220 }: { data: Array<{ day: number; growth: number; sampleSize: number }>; height?: number }) {
  const gradientId = useId().replace(/:/g, '');
  const width = 720;
  const padding = { top: 18, right: 20, bottom: 32, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxX = Math.max(1, ...data.map((point) => point.day));
  const maxY = Math.max(125, Math.ceil(Math.max(100, ...data.map((point) => point.growth)) / 25) * 25);
  const points = data.map((point) => ({ ...point, x: padding.left + (point.day / maxX) * innerWidth, y: padding.top + innerHeight - (point.growth / maxY) * innerHeight }));
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const areaPath = points.length ? `${path} L ${points[points.length - 1]!.x} ${padding.top + innerHeight} L ${points[0]!.x} ${padding.top + innerHeight} Z` : '';
  return <div className="w-full overflow-hidden">
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="发布后平均播放量相对首个快照的增长曲线">
      <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity=".22"/><stop offset="100%" stopColor="var(--primary)" stopOpacity="0"/></linearGradient></defs>
      {[0, 0.5, 1].map((ratio) => { const y = padding.top + innerHeight * ratio; const value = Math.round(maxY * (1 - ratio)); return <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 4"/><text x={padding.left - 8} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{value}%</text></g>; })}
      {areaPath && <path d={areaPath} fill={`url(#${gradientId})`}/>}
      {path && <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
      {points.map((point) => <g key={point.day}><circle cx={point.x} cy={point.y} r="4" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2"><title>发布后第 {point.day} 天 · 平均 {point.growth.toFixed(1)}% · {point.sampleSize} 个快照</title></circle><text x={point.x} y={height - 9} textAnchor="middle" fill="var(--text-muted)" fontSize="10">D+{point.day}</text></g>)}
    </svg>
  </div>;
}

/** 趋势图：真身在 ./analytics/charts.tsx，这里只负责 lazy + 占位 */
function TrendChart({ height = 180, ...props }: TrendChartProps) {
  return (
    <Suspense fallback={<ChartSkeleton height={height} />}>
      <LazyTrendChart height={height} {...props} />
    </Suspense>
  );
}

/** 平台对比条：真身在 ./analytics/charts.tsx，这里只负责 lazy + 占位 */
function ComparisonBars(props: ComparisonBarsProps) {
  return (
    <Suspense fallback={<ChartSkeleton height={280} />}>
      <LazyComparisonBars {...props} />
    </Suspense>
  );
}

// ─── 基准线表格辅助 ────────────────────────────────────────

const BENCHMARK_SCOPE_LABEL: Record<string, string> = {
  category: '品类',
  partition: '子分区',
  game: '游戏区',
};

/** 品类在前、大盘在后 */
const BENCHMARK_SCOPE_ORDER: Record<string, number> = { category: 0, partition: 1, game: 2 };

/** 比率 → 百分比。拿不到就显示「—」，绝不用 0 顶替。 */
const fmtRate = (r?: number) => (r === undefined ? '—' : `${(r * 100).toFixed(2)}%`);

/** 时间窗：null 表示榜单快照口径，不是一个固定时间窗 */
const fmtWindow = (days: number | null) => (days === null ? '榜单快照' : `近 ${days} 天`);

/** 缓存键。账号维度必须带命名空间：同一浏览器换账号登录不会读到上一个人的统计 */
const analyticsKey = (table: string, scope: string) => `analytics:${table}:${scope}`;

/**
 * 缓存命名空间。
 *
 * 不用 `useAuthStore.getState().user?.id`：首屏那一刻 token 已经在 localStorage 里，
 * 但 `user` 要等 /auth/me 回来才有值 —— 同一份数据会先落到一个键、user 就绪后又落到
 * 另一个键，刷新一次等于没命中缓存，白拉一遍。
 * 用 token 尾段做不透明命名空间：同一个登录态稳定不变；换账号 / 重新登录必然换 token，
 * 正好触发一次回源；也绝不会退化成一个所有账号共用的 'anon' 槽位。
 */
const cacheScope = () => {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? `t${token.slice(-20)}` : 'anon';
  } catch {
    return 'anon';
  }
};
/** 基准线是全站共享数据（不随账号变），单独一个键 */
const BENCHMARK_CACHE_KEY = 'analytics:benchmark:shared';

// ─── Main Page ─────────────────────────────────────────────

export default function Analytics() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [editingDouyin, setEditingDouyin] = useState(false);
  const [douyinForm, setDouyinForm] = useState({ followers: 0, avgViews: 0, totalVideos: 0, totalLikes: 0 });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'bilibili' | 'douyin' | 'calibration' | 'benchmark'>('overview');
  const [benchmark, setBenchmark] = useState<BenchmarkSnapshot | null>(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  /** 这一屏数据是否直接来自本地缓存（右上角显示「缓存 · N 分钟前」） */
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  /** 同步 / 保存 / 编辑期间，后台的每小时刷新不要插进来改数字 */
  const busyRef = useRef(false);
  const [retroPlatform, setRetroPlatform] = useState<'all' | 'bilibili' | 'douyin'>('all');
  const [retroSource, setRetroSource] = useState<'all' | 'ai' | 'manual'>('all');
  const [retroCategory, setRetroCategory] = useState('all');
  const [retroTag, setRetroTag] = useState('all');
  const toast = useToast();
  const { topics, loadTopics } = useTopicStore();

  useEffect(() => {
    const hasSession = !!useAuthStore.getState().token;
    if (!hasSession) {
      setAccount(null);
      setHistory([]);
      setInitialLoading(false);
      setLoadError('账号运营统计现已按账号隔离。登录后查看并保存你自己的平台统计；选题、脚本与报告仍可继续本地使用。');
      return;
    }
    void loadData();
    void loadBenchmark();
  }, []);

  // 页面一直开着时，每小时自动回源一次：缓存一过 TTL 就静默重取，
  // 期间不打断正在同步或正在编辑抖音数据的用户。
  useEffect(() => {
    if (!useAuthStore.getState().token) return;
    const timer = window.setInterval(() => {
      if (busyRef.current || document.visibilityState !== 'visible') return;
      void readCache(analyticsKey('account', cacheScope())).then((cached) => {
        if (!isCacheFresh(cached?.fetchedAt)) void loadData(false, { silent: true });
      });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
    // 只装一次定时器：回源函数每次渲染都是新的，用 ref 不需要重新订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    busyRef.current = syncing || saving || editingDouyin;
  }, [syncing, saving, editingDouyin]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  /**
   * 取账号统计。
   *
   * 两个接口都要在服务端读一遍云端快照（本机实测 1.2～2.0 秒），但账号数据
   * 只有「点立即同步」或「改抖音数据」时才会变 —— 所以走小时级本地缓存：
   * 一小时内重复打开、切页面回来都不再发请求。force=true（错误态点重新加载、
   * 后台每小时刷新）绕过缓存；silent=true 时不显示整页 loading。
   */
  const loadData = async (force = false, options: { silent?: boolean } = {}) => {
    const scope = cacheScope();
    if (!options.silent) setInitialLoading(true);
    setLoadError(null);
    try {
      const [status, hist] = await Promise.all([
        loadWithCache(analyticsKey('account', scope), () => api.getAccount(), { force }),
        loadWithCache(analyticsKey('history', scope), () => api.getSyncHistory(), { force }),
      ]);
      if (status.data) {
        const snapshot = status.data;
        setAccount(snapshot);
        setDouyinForm({
          followers: snapshot.douyinFollowers || 0,
          avgViews: snapshot.douyinAvgViews || 0,
          totalVideos: snapshot.douyinTotalVideos || 0,
          totalLikes: snapshot.douyinTotalLikes || 0,
        });
        setFromCache(status.fromCache);
        setCachedAt(status.fetchedAt);
      }
      if (hist.data) setHistory(hist.data);
      const failure = status.error ?? hist.error;
      if (failure) {
        console.error('Failed to load analytics:', failure);
        setLoadError(failure instanceof Error ? failure.message : '数据暂时无法读取');
      }
    } finally {
      if (!options.silent) setInitialLoading(false);
    }
  };

  /**
   * 基准线。ready=false 时界面显示「暂无基准数据」，不显示任何占位数字。
   *
   * GET /api/benchmark 只是读服务端快照（本机 13ms），同样按小时缓存；
   * 「重新采集」是显式动作，直接 POST /benchmark/refresh 并把结果写回缓存。
   */
  const loadBenchmark = async (options: { refresh?: boolean } = {}) => {
    setBenchmarkLoading(true);
    try {
      if (options.refresh) {
        const snapshot = await api.refreshBenchmark();
        setBenchmark(snapshot);
        await writeCache(BENCHMARK_CACHE_KEY, snapshot);
      } else {
        const res = await loadWithCache(BENCHMARK_CACHE_KEY, () => api.getBenchmark());
        if (res.data) setBenchmark(res.data);
        if (res.error) console.error('Failed to load benchmark:', res.error);
      }
    } catch (err) {
      console.error('Failed to load benchmark:', err);
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.syncAccount();
      setSyncResult(result);
      setAccount(result.accountInfo);
      const hist = await api.getSyncHistory();
      setHistory(hist);
      // 手动同步是最权威的一次回源：顺手刷新缓存，切页面回来不必再拉
      const scope = cacheScope();
      const fetchedAt = await writeCache(analyticsKey('account', scope), result.accountInfo);
      await writeCache(analyticsKey('history', scope), hist);
      setCachedAt(fetchedAt);
      setFromCache(false);
    } catch (err) {
      toast.error('同步失败：' + (err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveDouyin = async () => {
    setSaving(true);
    try {
      const updated = await api.updateAccount({
        douyinFollowers: douyinForm.followers,
        douyinAvgViews: douyinForm.avgViews,
        douyinTotalVideos: douyinForm.totalVideos,
        douyinTotalLikes: douyinForm.totalLikes,
      });
      setAccount(updated);
      // 本地改动同样写回缓存，避免下一次打开又看到旧数字
      await writeCache(analyticsKey('account', cacheScope()), updated);
      setEditingDouyin(false);
    } catch (err) {
      toast.error('保存失败：' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const formatSyncTime = (ts?: number) => {
    if (!ts) return '从未同步';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  // Chart data from history
  const chartData = useMemo(() => {
    const recent = history.slice(-15);
    const labels = recent.map(h => {
      const d = new Date(h.timestamp);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    return {
      labels,
      biliFollowers: recent.map(h => h.bilibiliFollowers),
      biliAvgViews: recent.map(h => h.bilibiliAvgViews),
      biliLikes: recent.map(h => h.bilibiliTotalLikes),
      douyinFollowers: recent.map(h => h.douyinFollowers),
      douyinAvgViews: recent.map(h => h.douyinAvgViews),
    };
  }, [history]);

  // ─── 预测校准 ────────────────────────────────────────────
  // 只统计「既有数字化预测、又有真实播放数据」的选题。
  // 缺任何一边都不参与统计——不补 0、不猜、不插值。
  //
  // ★★ 这个 useMemo 必须放在下面的 `if (!account) return` 之前！★★
  //    它只依赖 topics，与 account 无关。如果放到 early return 之后，
  //    首次渲染（account 为 null）会比第二次渲染少调用一个 hook，React 抛
  //    "Rendered more hooks than during the previous render."，整页白屏。
  //    （2026-10-05 实际踩过这个坑，tsc 完全不报错。）
  const calibration = useMemo(() => {
    const published = topics.filter((t) => t.published);
    const comparable = published
      .filter((t) => (t.prediction?.value ?? t.estimatedViews) > 0 && t.published?.views !== undefined)
      .map((t) => {
        const predicted = t.prediction?.value ?? t.estimatedViews;
        const actual = t.published?.views ?? 0;
        return {
          id: t.id,
          title: t.title,
          predicted,
          actual,
          absError: Math.abs(actual - predicted) / predicted,
          url: t.published?.url,
          publishedAt: t.published?.publishedAt ?? 0,
          predictionSource: t.prediction?.source ?? (t.estimatedViews > 0 ? 'ai' as const : undefined),
          retrospectiveTags: t.retrospective?.tags ?? [],
          retrospectiveNote: t.retrospective?.note ?? '',
        };
      })
      .sort((a, b) => b.absError - a.absError);

    const skipped = published.filter(
      (t) => !((t.prediction?.value ?? t.estimatedViews) > 0 && t.published?.views !== undefined),
    );

    const meanAbsError =
      comparable.length > 0
        ? comparable.reduce((sum, row) => sum + row.absError, 0) / comparable.length
        : null;

    // 中位数比值：>1 说明系统性低估，<1 说明系统性高估
    let medianRatio: number | null = null;
    if (comparable.length > 0) {
      const ratios = comparable.map((r) => r.actual / r.predicted).sort((a, b) => a - b);
      const mid = Math.floor(ratios.length / 2);
      medianRatio =
        ratios.length % 2 === 0
          ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2
          : (ratios[mid] ?? 0);
    }

    const overestimated = comparable.filter((row) => row.actual < row.predicted).length;
    const underestimated = comparable.filter((row) => row.actual >= row.predicted).length;
    const realComparable = comparable.filter((row) => !row.id.startsWith('demo-'));
    const aiSamples = realComparable.filter((row) => row.predictionSource === 'ai');
    const manualSamples = realComparable.filter((row) => row.predictionSource === 'manual');
    const meanErrorFor = (rows: typeof realComparable) => rows.length ? rows.reduce((sum, row) => sum + row.absError, 0) / rows.length : null;

    return {
      publishedCount: published.length,
      comparable,
      skipped,
      meanAbsError,
      medianRatio,
      overestimated,
      underestimated,
      aiSamples: aiSamples.length,
      manualSamples: manualSamples.length,
      aiMeanError: meanErrorFor(aiSamples),
      manualMeanError: meanErrorFor(manualSamples),
    };
  }, [topics]);

  const visibleCalibration = useMemo(() => calibration.comparable.filter((row) => {
      const topic = topics.find((item) => item.id === row.id);
      if (!topic) return false;
      if (topic.id.startsWith('demo-')) return false;
    if (retroPlatform !== 'all' && topic.published?.platform !== retroPlatform) return false;
    if (retroSource !== 'all' && row.predictionSource !== retroSource) return false;
    if (retroCategory !== 'all' && topic.category !== retroCategory) return false;
    if (retroTag !== 'all' && !row.retrospectiveTags.includes(retroTag as RetrospectiveTag)) return false;
    return true;
  }), [calibration.comparable, retroCategory, retroPlatform, retroSource, retroTag, topics]);
  const visibleMetrics = useMemo(() => {
    const rows = visibleCalibration;
    if (!rows.length) return { meanAbsError: null, medianRatio: null, overestimated: 0, underestimated: 0 };
    const meanAbsError = rows.reduce((sum, row) => sum + row.absError, 0) / rows.length;
    const ratios = rows.map((row) => row.actual / row.predicted).sort((a, b) => a - b);
    const middle = Math.floor(ratios.length / 2);
    const medianRatio = ratios.length % 2 ? ratios[middle] ?? null : ((ratios[middle - 1] ?? 0) + (ratios[middle] ?? 0)) / 2;
    return { meanAbsError, medianRatio, overestimated: rows.filter((row) => row.actual < row.predicted).length, underestimated: rows.filter((row) => row.actual >= row.predicted).length };
  }, [visibleCalibration]);

  const snapshotTrend = useMemo(() => {
    const points = new Map<number, number[]>();
    for (const row of visibleCalibration) {
      const topic = topics.find((item) => item.id === row.id);
      const publishedAt = topic?.published?.publishedAt;
      const snapshots = topic?.published?.snapshots ?? [];
      if (!publishedAt || snapshots.length < 2) continue;
      const baseline = snapshots[0]?.views;
      if (baseline === undefined) continue;
      for (const snapshot of snapshots) {
        if (snapshot.views === undefined) continue;
        const day = Math.max(0, Math.floor((snapshot.fetchedAt - publishedAt) / 86400000));
        const growth = baseline > 0 ? (snapshot.views / baseline) * 100 : 100;
        const bucket = points.get(day) ?? [];
        bucket.push(growth);
        points.set(day, bucket);
      }
    }
    return [...points.entries()].sort(([a], [b]) => a - b).map(([day, values]) => ({ day, growth: values.reduce((sum, value) => sum + value, 0) / values.length, sampleSize: values.length }));
  }, [topics, visibleCalibration]);

  if (!account) {
    if (loadError && !initialLoading) {
      return (
        <div className="space-y-4">
          <PageHeader eyebrow="数据 / ANALYTICS" title="数据看板" description="账号指标与平台增长趋势汇总。" />
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title="数据暂时无法加载"
            description={loadError}
            action={<Button variant="secondary" onClick={() => void loadData(true)}>重新加载</Button>}
          />
        </div>
      );
    }
    return (
      <LoadingBlock label="正在加载数据看板…" />
    );
  }

  const totalFollowers = account.bilibiliFollowers + account.douyinFollowers;
  const totalLikes = (account.bilibiliTotalLikes || 0) + (account.douyinTotalLikes || 0);
  const totalVideos = account.totalVideos + (account.douyinTotalVideos || 0);
  const totalAvgViews = account.bilibiliAvgViews + account.douyinAvgViews;

  return (
    <div>
      <PageHeader
        eyebrow="数据 / ANALYTICS"
        title="数据看板"
        description={
          <>
            双平台的账号数据、增长趋势与「预测 vs 实际」复盘都汇总在这里，每个数字都写明来源与口径 ——
            最近一次同步 {formatSyncTime(account.lastSyncAt)}
            {account.syncMessage ? ` · ${account.syncMessage.slice(0, 60)}` : ''}
          </>
        }
        actions={
          <Button onClick={handleSync} loading={syncing}>
            {!syncing && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {syncing ? '同步中...' : '立即同步'}
          </Button>
        }
      />

      {/* Sync result banner */}
      {syncResult && (
        <div
          className={`anim-fade mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border p-3 text-xs ${
            syncResult.success
              ? 'bg-success-soft border-success/30 text-success'
              : 'bg-warning-soft border-warning/30 text-warning'
          }`}
        >
          <span className="font-medium">{syncResult.success ? '✅ 同步完成' : '⚠️ 同步部分失败'}</span>
          {syncResult.syncedFields.length > 0 && ` — 已更新: ${syncResult.syncedFields.join('、')}`}
          {syncResult.failedFields.length > 0 && ` | 未更新: ${syncResult.failedFields.join('；')}`}
        </div>
      )}

      {/* Tab selector：圆角药丸，与首页筛选器同一套语言 */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {([
          { key: 'overview', label: '总览', icon: '📊' },
          { key: 'bilibili', label: 'B站', icon: '📺' },
          { key: 'douyin', label: '抖音', icon: '🎵' },
          { key: 'calibration', label: '预测校准', icon: '🎯' },
          { key: 'benchmark', label: '品类基准线', icon: '📐' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
              activeTab === tab.key
                ? 'border-transparent bg-primary text-white shadow-xs'
                : 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        <span
          className="num ml-auto shrink-0 text-xs text-text-muted"
          title="数据看板每小时自动回源一次，期间直接用本机缓存；点右上角「立即同步」可立刻获取最新平台数据"
        >
          {fromCache && cachedAt ? `缓存 · ${formatSyncTime(cachedAt)}` : '刚刚更新'}
        </span>
      </div>

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && (
        <div className="stagger-children space-y-6">
          {/* Combined stat cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="总粉丝数" value={totalFollowers.toLocaleString()} unit="人" icon={Users} tone="primary" hint="B站 + 抖音" />
            <Stat label="总视频数" value={totalVideos.toLocaleString()} unit="个" icon={Clapperboard} tone="success" hint="已发布" />
            <Stat label="总获赞数" value={totalLikes.toLocaleString()} unit="个" icon={ThumbsUp} tone="warning" hint="B站 + 抖音" />
            <Stat label="平均播放量" value={totalAvgViews.toLocaleString()} unit="次" icon={Play} tone="info" hint="两平台合计" />
          </div>

          {/* Platform comparison */}
          <Card padding="lg">
            <SectionHeading title="平台数据对比" hint="B站 / 抖音 同口径对照" />
            <ComparisonBars items={[
              { label: '粉丝数', bili: account.bilibiliFollowers, douyin: account.douyinFollowers, unit: '人' },
              { label: '平均播放量', bili: account.bilibiliAvgViews, douyin: account.douyinAvgViews, unit: '次' },
              { label: '视频数', bili: account.totalVideos, douyin: account.douyinTotalVideos || 0, unit: '个' },
              { label: '总获赞', bili: account.bilibiliTotalLikes || 0, douyin: account.douyinTotalLikes || 0, unit: '个' },
            ]} />
            <p className="mt-3 border-l-2 border-border-strong pl-3 text-xs leading-relaxed text-text-muted">
              数据口径：粉丝数、视频数、总获赞取两平台账号接口的累计值；平均播放量 B站为近 30 条视频均值，抖音为本地填写的估算值。
            </p>
          </Card>

          {/* Account info summary */}
          <Card padding="lg">
            <SectionHeading title="账号信息" hint="本地保存，不上传" />
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <div>
                <span className="block eyebrow mb-1">内容方向</span>
                <span className="font-medium text-text">{account.contentFocus}</span>
              </div>
              <div>
                <span className="block eyebrow mb-1">活跃天数</span>
                <span className="num font-medium text-text">{account.daysActive} 天</span>
              </div>
              <div>
                <span className="block eyebrow mb-1">B站账号</span>
                <span className="font-medium text-text">{account.bilibiliName || '未配置'}</span>
              </div>
              <div>
                <span className="block eyebrow mb-1">B站 UID</span>
                <span className="num font-medium text-text">{account.bilibiliUid || '未配置'}</span>
              </div>
              <div>
                <span className="block eyebrow mb-1">抖音号</span>
                <span className="num font-medium text-text">{account.douyinId || '未配置'}</span>
              </div>
              <div>
                <span className="block eyebrow mb-1">抖音名称</span>
                <span className="font-medium text-text">{account.douyinName || '未填写'}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Bilibili Tab ─── */}
      {activeTab === 'bilibili' && (
        <div className="stagger-children space-y-6">
          {/* B站 stat cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="粉丝数" value={account.bilibiliFollowers.toLocaleString()} unit="人" icon={Users} tone="primary" hint={account.bilibiliName || 'B站账号'} />
            <Stat label="视频数" value={account.totalVideos.toLocaleString()} unit="个" icon={Clapperboard} tone="success" hint="已发布" />
            <Stat label="总获赞" value={(account.bilibiliTotalLikes || 0).toLocaleString()} unit="个" icon={ThumbsUp} tone="warning" hint="累计" />
            <Stat label="平均播放" value={account.bilibiliAvgViews.toLocaleString()} unit="次" icon={Play} tone="info" hint="近 30 条视频" />
          </div>

          {/* Follower trend */}
          <Card padding="lg">
            <SectionHeading
              title="粉丝增长趋势"
              hint={chartData.labels.length > 0 ? `最近 ${chartData.labels.length} 次同步` : '等待首次同步'}
            />
            {chartData.biliFollowers.length > 0 ? (
              <TrendChart data={chartData.biliFollowers} labels={chartData.labels} color={CHART.bili} height={280} />
            ) : (
              <EmptyState
                compact
                icon={<TrendingUp className="h-5 w-5" />}
                title="暂无历史数据"
                description="点右上角「立即同步」开始记录，之后这里会出现趋势图。"
              />
            )}
            <SourceNote tier="A" label="数据来源" className="mt-3">
              B站 card API，每次同步写入一条快照，图上取最近 15 次记录。
            </SourceNote>
          </Card>

          {/* Avg views trend */}
          <Card padding="lg">
            <SectionHeading title="平均播放量趋势" hint="近 30 条视频均值" />
            {chartData.biliAvgViews.length > 0 ? (
              <TrendChart data={chartData.biliAvgViews} labels={chartData.labels} color={CHART.warning} height={280} />
            ) : (
              <EmptyState
                compact
                icon={<Activity className="h-5 w-5" />}
                title="暂无历史数据"
                description="点右上角「立即同步」开始记录，之后这里会出现趋势图。"
              />
            )}
            <SourceNote tier="A" label="数据来源" className="mt-3">
              B站视频列表接口，取账号最近 30 条视频播放量的算术平均。
            </SourceNote>
          </Card>

          {/* Likes trend */}
          <Card padding="lg">
            <SectionHeading title="总获赞趋势" hint="累计值" />
            {chartData.biliLikes.length > 0 ? (
              <TrendChart data={chartData.biliLikes} labels={chartData.labels} color={CHART.success} height={280} />
            ) : (
              <EmptyState
                compact
                icon={<ThumbsUp className="h-5 w-5" />}
                title="暂无历史数据"
                description="点右上角「立即同步」开始记录，之后这里会出现趋势图。"
              />
            )}
            <SourceNote tier="A" label="数据来源" className="mt-3">
              B站 card API 的累计点赞数，每次同步记录一次，因此只能看趋势、不能算「当天新增」。
            </SourceNote>
          </Card>

          {/* B站 sync info */}
          <Card padding="lg">
            <SectionHeading title="B站同步状态" hint="UID · 账号名 · 时间" />
            <div className="space-y-2 text-xs text-text-secondary">
              <p>UID：<span className="num text-text">{account.bilibiliUid || '未配置'}</span></p>
              <p>账号名：<span className="text-text">{account.bilibiliName || '未同步'}</span></p>
              <p>上次同步：<span className="text-text">{formatSyncTime(account.lastSyncAt)}</span></p>
            </div>
            <p className="mt-3 border-l-2 border-border-strong pl-3 text-xs leading-relaxed text-text-muted">
              B站数据通过 card API 自动获取（粉丝数、视频数、点赞数）。视频列表 API 可能因风控限制偶尔失败，平均播放量将保留上次成功值。
            </p>
          </Card>
        </div>
      )}

      {/* ─── Douyin Tab ─── */}
      {activeTab === 'douyin' && (
        <div className="stagger-children space-y-6">
          {/* 抖音 stat cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="粉丝数" value={account.douyinFollowers.toLocaleString()} unit="人" icon={Users} tone="neutral" hint={account.douyinName || '抖音账号'} />
            <Stat label="视频数" value={(account.douyinTotalVideos || 0).toLocaleString()} unit="个" icon={Clapperboard} tone="neutral" hint="已发布" />
            <Stat label="总获赞" value={(account.douyinTotalLikes || 0).toLocaleString()} unit="个" icon={ThumbsUp} tone="neutral" hint="累计" />
            <Stat label="平均播放" value={account.douyinAvgViews.toLocaleString()} unit="次" icon={Play} tone="neutral" hint="本地填写" />
          </div>

          {/* Follower trend */}
          <Card padding="lg">
            <SectionHeading
              title="粉丝增长趋势"
              hint={chartData.labels.length > 0 ? `最近 ${chartData.labels.length} 次同步` : '等待首次同步'}
            />
            {chartData.douyinFollowers.length > 0 ? (
              <TrendChart data={chartData.douyinFollowers} labels={chartData.labels} color={CHART.douyin} height={280} />
            ) : (
              <EmptyState
                compact
                icon={<TrendingUp className="h-5 w-5" />}
                title="暂无历史数据"
                description="同步后会自动把当前填写的粉丝数记入历史，之后这里会出现趋势图。"
              />
            )}
            <SourceNote tier="C" label="数据来源" className="mt-3">
              本地手动填写，每次同步时自动写入一条快照，图上取最近 15 次记录。
            </SourceNote>
          </Card>

          {/* Avg views trend */}
          <Card padding="lg">
            <SectionHeading title="平均播放量趋势" hint="近 30 条视频均值" />
            {chartData.douyinAvgViews.length > 0 ? (
              <TrendChart data={chartData.douyinAvgViews} labels={chartData.labels} color={CHART.primary} height={280} />
            ) : (
              <EmptyState
                compact
                icon={<Activity className="h-5 w-5" />}
                title="暂无历史数据"
                description="点右上角「立即同步」开始记录，之后这里会出现趋势图。"
              />
            )}
            <SourceNote tier="C" label="数据来源" className="mt-3">
              本地手动填写，抖音暂不支持自动采集，因此这条曲线只反映你手动更新的节奏。
            </SourceNote>
          </Card>

          {/* Manual data entry */}
          <Card padding="lg">
            <SectionHeading
              title="抖音数据管理"
              hint="手动维护"
              action={
                !editingDouyin ? (
                  <Button variant="link" size="xs" onClick={() => setEditingDouyin(true)}>
                    编辑数据
                  </Button>
                ) : undefined
              }
            />

            <div className="mb-4 rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs leading-relaxed text-warning">
              抖音因反爬机制暂不支持自动获取数据。每次同步时，系统会自动保存当前手动填写的数据到历史记录中，用于趋势追踪。
            </div>

            {editingDouyin ? (
              <div className="space-y-4">
                {/* 参数面板：四个手填数字统一走 Field + Input，不再是裸 input */}
                <div className="rounded-xl border border-border bg-surface-muted/50 p-3.5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="粉丝数" hint="累计值">
                      <Input
                        type="number"
                        className="num"
                        value={douyinForm.followers}
                        onChange={(e) => setDouyinForm({ ...douyinForm, followers: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="平均播放量" hint="本地填写的估算值">
                      <Input
                        type="number"
                        className="num"
                        value={douyinForm.avgViews}
                        onChange={(e) => setDouyinForm({ ...douyinForm, avgViews: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="视频数" hint="已发布">
                      <Input
                        type="number"
                        className="num"
                        value={douyinForm.totalVideos}
                        onChange={(e) => setDouyinForm({ ...douyinForm, totalVideos: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="总获赞" hint="累计">
                      <Input
                        type="number"
                        className="num"
                        value={douyinForm.totalLikes}
                        onChange={(e) => setDouyinForm({ ...douyinForm, totalLikes: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-text-muted">
                    这些数字由你手动维护，保存后每次同步都会写入一条历史快照，用于趋势追踪。
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSaveDouyin} loading={saving}>
                    {saving ? '保存中...' : '保存'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingDouyin(false);
                      setDouyinForm({
                        followers: account.douyinFollowers || 0,
                        avgViews: account.douyinAvgViews || 0,
                        totalVideos: account.douyinTotalVideos || 0,
                        totalLikes: account.douyinTotalLikes || 0,
                      });
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="block eyebrow mb-1">抖音号</span>
                  <span className="num font-medium text-text">{account.douyinId || '未配置'}</span>
                </div>
                <div>
                  <span className="block eyebrow mb-1">上次同步</span>
                  <span className="font-medium text-text">{formatSyncTime(account.lastSyncAt)}</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── Calibration Tab ─── */}
      {activeTab === 'calibration' && (
        <div className="stagger-children space-y-6">
          <Card padding="lg">
            <SectionHeading title="预测 vs 实际" hint="AI 预测与人工目标分来源统计" />
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              只统计同时具备预测值与真实播放量的选题。预测值来源可能是 AI 评估或人工目标，会逐条标记；
              缺任何一边都不参与统计，不补 0、不猜、不插值。实际数据来自 B站接口。
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="已发布选题"
                value={String(calibration.publishedCount)}
                unit="条"
                icon={Clapperboard}
                tone="success"
                hint="有发布记录"
              />
              <Stat
                label="可对比样本"
                value={String(visibleCalibration.length)}
                unit="条"
                icon={Layers}
                tone="primary"
                hint="预测与实际都有"
              />
              <Stat
                label="平均绝对偏差"
                value={
                  visibleMetrics.meanAbsError === null
                    ? '—'
                    : `${(visibleMetrics.meanAbsError * 100).toFixed(1)}%`
                }
                icon={Target}
                tone="danger"
                hint="越低越准"
              />
              <Stat
                label="实际 / 预测 中位数"
                value={visibleMetrics.medianRatio === null ? '—' : `${visibleMetrics.medianRatio.toFixed(2)}×`}
                icon={Activity}
                tone="warning"
                hint="1.00 表示无系统性偏差"
              />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-muted/40 px-3.5 py-3 text-xs">
                <div className="font-medium text-text">AI 预测</div>
                <div className="mt-1 text-text-secondary">{visibleCalibration.filter((row) => row.predictionSource === 'ai').length} 个样本 · 平均绝对偏差 {(() => { const rows = visibleCalibration.filter((row) => row.predictionSource === 'ai'); return rows.length ? `${(rows.reduce((sum, row) => sum + row.absError, 0) / rows.length * 100).toFixed(1)}%` : '—'; })()}</div>
              </div>
              <div className="rounded-xl border border-border bg-surface-muted/40 px-3.5 py-3 text-xs">
                <div className="font-medium text-text">人工目标</div>
                <div className="mt-1 text-text-secondary">{visibleCalibration.filter((row) => row.predictionSource === 'manual').length} 个样本 · 平均绝对偏差 {(() => { const rows = visibleCalibration.filter((row) => row.predictionSource === 'manual'); return rows.length ? `${(rows.reduce((sum, row) => sum + row.absError, 0) / rows.length * 100).toFixed(1)}%` : '—'; })()}</div>
              </div>
            </div>
            {visibleCalibration.length > 0 && (
              <p className="mt-4 text-xs text-text-muted">
                当前筛选中高估 <span className="num text-danger">{visibleMetrics.overestimated}</span> 条 ·
                低估 <span className="num text-success">{visibleMetrics.underestimated}</span> 条
              </p>
            )}
          </Card>

          <Card padding="lg">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><SectionHeading title="发布后播放增长" hint="相对首个成功取数快照；不是预测因果" className="mb-1"/><p className="text-xs text-text-muted">只展示至少有两次成功取数的内容；每个点标注快照数。</p></div>
              <Badge variant="neutral">{visibleCalibration.filter((row) => (topics.find((topic) => topic.id === row.id)?.published?.snapshots?.length ?? 0) >= 2).length} 条可画曲线</Badge>
            </div>
            {snapshotTrend.length > 0 ? <div className="mt-3"><SnapshotTrendChart data={snapshotTrend}/><p className="mt-1 text-[10px] text-text-muted">纵轴：相对首个快照播放量（100% 为持平）；横轴：发布后天数。每个时点对所有符合筛选的快照取平均。</p></div> : <EmptyState compact className="mt-4" title="快照样本不足，暂时无法画趋势" description="至少有一条已发布内容成功刷新两次以上，才会生成增长曲线。"/>}
          </Card>

          <Card padding="lg">
            <SectionHeading title="复盘筛选" hint="影响因素标签是人工记录，不作因果解释" className="mb-3"/>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="平台"><Select value={retroPlatform} onChange={(event) => setRetroPlatform(event.target.value as typeof retroPlatform)}><option value="all">全部平台</option><option value="bilibili">B站</option><option value="douyin">抖音</option></Select></Field>
              <Field label="预测来源"><Select value={retroSource} onChange={(event) => setRetroSource(event.target.value as typeof retroSource)}><option value="all">全部来源</option><option value="ai">AI 预测</option><option value="manual">人工目标</option></Select></Field>
              <Field label="品类"><Select value={retroCategory} onChange={(event) => setRetroCategory(event.target.value)}><option value="all">全部品类</option>{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</Select></Field>
              <Field label="复盘标签"><Select value={retroTag} onChange={(event) => setRetroTag(event.target.value)}><option value="all">全部标签</option>{[...new Set(topics.flatMap((topic) => topic.retrospective?.tags ?? []))].map((tag) => <option key={tag} value={tag}>{tag}</option>)}</Select></Field>
            </div>
            <p className="mt-3 text-xs text-text-muted">当前筛选 {visibleCalibration.length} 个预测/实际样本{visibleCalibration.length < 5 ? '；样本较少，只用于浏览，不应据此推断稳定规律。' : '。'} 具备人工复盘标签：{visibleCalibration.filter((row) => row.retrospectiveTags.length > 0).length} 个。</p>
          </Card>

          {visibleCalibration.length > 0 ? (
            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-border px-5 py-4">
                <SectionHeading title="逐条对比" hint={`${visibleCalibration.length} 条 · 当前筛选后，偏差从大到小`} className="mb-0" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-text-muted">
                      <th className="py-2.5 pl-5 pr-3 text-left font-medium">选题</th>
                      <th className="px-2 py-2.5 text-right font-medium">预测 / 来源</th>
                      <th className="px-2 py-2.5 text-right font-medium">实际</th>
                      <th className="px-2 py-2.5 text-right font-medium">偏差</th>
                      <th className="py-2.5 pl-2 pr-5 text-right font-medium">发布日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleCalibration.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-surface-hover">
                        <td className="max-w-[280px] py-2.5 pl-5 pr-3">
                          {row.url ? (
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate text-primary hover:underline"
                              title={row.title}
                            >
                              {row.title}
                            </a>
                          ) : (
                            <span className="block truncate" title={row.title}>{row.title}</span>
                          )}
                        </td>
                        <td className="num whitespace-nowrap px-2 text-right text-text-secondary">
                          {formatViews(row.predicted)} <span className="ml-1 text-[10px] text-text-muted">{row.predictionSource === 'manual' ? '人工' : 'AI'}</span>
                        </td>
                        <td className="num whitespace-nowrap px-2 text-right font-medium">
                          {formatViews(row.actual)}
                        </td>
                        <td
                          className={`num whitespace-nowrap px-2 text-right font-medium ${
                            row.actual >= row.predicted ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {formatDeviation(row.predicted, row.actual)}
                        </td>
                        <td className="min-w-40 py-2.5 pl-2 pr-5 text-right text-xs text-text-secondary">
                          <div className="num">{row.publishedAt ? new Date(row.publishedAt).toLocaleDateString('zh-CN') : '—'}</div>
                          {row.retrospectiveTags.length > 0 && <div className="mt-1 flex justify-end gap-1">{row.retrospectiveTags.slice(0, 2).map((tag) => <span key={tag} className="rounded bg-surface-muted px-1.5 py-0.5 text-[9px]">{tag}</span>)}</div>}
                          {row.retrospectiveNote && <div className="mt-1 max-w-48 truncate text-[10px] text-text-muted" title={row.retrospectiveNote}>{row.retrospectiveNote}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <EmptyState
              icon={<Target className="h-5 w-5" />}
              title="还没有可对比的样本"
                description="去「选题看板」通过 AI 评估记录预测值，或手动填写播放目标；再发布并回填真实数据，即可开始校准。"
            />
          )}

          {calibration.skipped.filter((topic) => !topic.id.startsWith('demo-')).length > 0 && (
            <Card padding="lg">
              <SectionHeading
                title="未参与统计"
                hint={`${calibration.skipped.filter((topic) => !topic.id.startsWith('demo-')).length} 条`}
              />
              <p className="mb-3 text-xs leading-relaxed text-text-secondary">
                这些选题已有发布记录，但缺少预测值或实际播放数据，因此不计入上面的偏差统计。
              </p>
              <ul className="space-y-1.5 text-sm">
                {calibration.skipped.filter((topic) => !topic.id.startsWith('demo-')).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 text-text-secondary">
                    <span className="flex-1 truncate" title={t.title}>{t.title}</span>
                    <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">
                      {(t.prediction?.value ?? t.estimatedViews) > 0 ? '缺实际数据' : '缺预测值'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {/* ─── Benchmark Tab ─── */}
      {activeTab === 'benchmark' && (
        <div className="stagger-children space-y-6">
          <Card padding="lg">
            <SectionHeading
              title="B站基准线"
              hint={benchmark?.ready ? '样本已达标' : '等待采集'}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadBenchmark({ refresh: true })}
                  disabled={benchmarkLoading}
                  loading={benchmarkLoading}
                >
                  {benchmarkLoading ? '采集中…' : '重新采集'}
                </Button>
              }
            />
            <p className="text-xs leading-relaxed text-text-secondary">
              这里的每个数字都来自 B站接口的真实样本，不含估算与占位。
              样本量不足的品类不会给出基准线，而是列在下方「样本不足」中。
            </p>
            {benchmark?.collectedAt && (
              <p className="mt-3 text-xs text-text-muted">
                采集于 <span className="num">{new Date(benchmark.collectedAt).toLocaleString('zh-CN')}</span>
                {benchmark.error ? ` · 上次刷新失败：${benchmark.error}` : ''}
              </p>
            )}
          </Card>

          {benchmark && benchmark.ready ? (
            <>
              <Card padding="none" className="overflow-hidden">
                <div className="border-b border-border px-5 py-4">
                  <SectionHeading title="采样口径" hint="榜单 / 品类两条来源" className="mb-0" />
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                    <span className="font-medium text-text">榜单口径</span>：B站热门榜（全站）中属于游戏子分区的条目 ——
                    这是「头部样本」，不是全量分布。
                    <span className="font-medium text-text"> 品类口径</span>：B站搜索「近 30 天 · 按播放量排序」——
                    代表该品类当前水位。
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-text-muted">
                        <th className="py-2.5 pl-5 pr-3 text-left font-medium">口径</th>
                        <th className="py-2.5 pr-3 text-left font-medium">样本</th>
                        <th className="px-2 py-2.5 text-right font-medium">样本量</th>
                        <th className="px-3 py-2.5 text-left font-medium">时间窗</th>
                        <th className="px-2 py-2.5 text-right font-medium">播放 P25</th>
                        <th className="px-2 py-2.5 text-right font-medium">播放中位</th>
                        <th className="px-2 py-2.5 text-right font-medium">播放 P90</th>
                        <th className="px-2 py-2.5 text-right font-medium">点赞率</th>
                        <th className="py-2.5 pl-2 pr-5 text-right font-medium">收藏率</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {[...benchmark.samples]
                        .sort(
                          (a, b) =>
                            (BENCHMARK_SCOPE_ORDER[a.scope] ?? 9) - (BENCHMARK_SCOPE_ORDER[b.scope] ?? 9) ||
                            b.sampleSize - a.sampleSize,
                        )
                        .map((s) => (
                          <tr
                            key={`${s.scope}:${s.key}`}
                            className="transition-colors hover:bg-surface-hover"
                          >
                            <td className="whitespace-nowrap py-2.5 pl-5 pr-3 text-xs text-text-secondary">
                              {BENCHMARK_SCOPE_LABEL[s.scope] ?? s.scope}
                            </td>
                            <td className="whitespace-nowrap py-2.5 pr-3" title={s.sourceLabel}>
                              {s.label}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2.5 text-right">
                              {s.sampleSize}
                              <span className="text-xs text-text-secondary"> 条</span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs text-text-secondary">
                              {fmtWindow(s.windowDays)}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2.5 text-right text-text-secondary">
                              {formatViews(s.views.p25)}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2.5 text-right font-medium">
                              {formatViews(s.views.median)}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2.5 text-right text-text-secondary">
                              {formatViews(s.views.p90)}
                            </td>
                            <td className="num whitespace-nowrap px-2 py-2.5 text-right">
                              {fmtRate(s.rates.like?.median)}
                            </td>
                            <td className="num whitespace-nowrap py-2.5 pl-2 pr-5 text-right">
                              {fmtRate(s.rates.favorite?.median)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {benchmark.samples.some((s) => s.unavailable.length > 0) && (
                  <p className="border-t border-border bg-warning-soft px-5 py-3 text-xs leading-relaxed text-warning">
                    数据源明确不提供的指标留空（显示「—」），不以 0 或估计值顶替：
                    {Array.from(new Set(benchmark.samples.flatMap((s) => s.unavailable))).join('；')}
                  </p>
                )}
              </Card>

              {benchmark.gaps.length > 0 && (
                <Card padding="lg">
                  <SectionHeading title="样本不足" hint={`${benchmark.gaps.length} 项`} />
                  <p className="mb-3 text-xs leading-relaxed text-text-secondary">
                    样本量没到门槛就不构成基准线，因此这些品类不显示任何数字。
                  </p>
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {benchmark.gaps.map((g) => (
                      <li
                        key={g.key}
                        className="rounded-full border border-warning/30 bg-warning-soft px-2.5 py-1 text-warning"
                      >
                        {g.label}：采到 <span className="num">{g.sampleSize}</span> 条，需要{' '}
                        <span className="num">{g.needed}</span> 条
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          ) : (
            <Card padding="lg">
              <EmptyState
                icon={<Ruler className="h-5 w-5" />}
                title="暂无基准数据"
                description={
                  <>
                    后端首次采集约需 30 秒，稍后点「重新采集」即可。
                    {benchmark?.error ? ` 上次失败原因：${benchmark.error}` : ''}
                  </>
                }
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
