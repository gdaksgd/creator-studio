import { useEffect, useState, useMemo, useId } from 'react';
import { api, type AccountInfo, type SyncResult, type SyncHistoryEntry } from '../api/client';
import { useTopicStore } from '../store/topicStore';
import { formatDeviation, formatViews } from '../utils/prediction';
import type { BenchmarkSnapshot } from '../types';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Input';
import { SourceNote } from '../components/ui/SourceNote';
import { Stat } from '../components/ui/Stat';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
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
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ─── Chart Components ──────────────────────────────────────

/** 图表配色全部走 CSS 变量：深浅色主题自动切换，不再写死 hex */
const CHART = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  bili: 'var(--accent-bili)',
  douyin: 'var(--accent-douyin)',
  grid: 'var(--border)',
  axis: 'var(--text-muted)',
} as const;

/** 坐标轴刻度：统一 11px + 弱化色，避免每张图各写一遍 */
const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 11 } as const;

/** 悬停高亮：用最浅的表面色，别用默认的灰色方块 */
const HOVER_CURSOR = { fill: 'var(--surface-muted)' } as const;

/** Tooltip 做成一张小卡片，和页面里的 card 同一套描边/圆角/阴影 */
const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontSize: 12,
  padding: '8px 10px',
  boxShadow: 'var(--shadow-card)',
} as const;

/** 把大数字压成「12.3 万」 */
function compactNum(v: number): string {
  if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(1) + ' 亿';
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + ' 万';
  return String(Math.round(v));
}

/** 趋势图（面积 + 折线）：Recharts 版，带坐标轴与 tooltip */
function TrendChart({ data, labels, color, height = 180 }: {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
}) {
  const rows = data.map((value, i) => ({ name: labels[i] ?? '#' + (i + 1), value }));
  // useId 保证同一页面多张面积图的渐变 id 不撞车（撞车会让先渲染的那张变黑）
  const gradId = 'trend-' + useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="55%" stopColor={color} stopOpacity={0.08} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={compactNum}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
            cursor={HOVER_CURSOR}
            formatter={(v) => compactNum(Number(v))}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={'url(#' + gradId + ')'}
            dot={false}
            activeDot={{ r: 5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 平台对比条：B站 vs 抖音（替换改造前 div 拼的进度条） */
function ComparisonBars({ items }: {
  items: { label: string; bili: number; douyin: number; unit?: string }[];
}) {
  const rows = items.map(({ label, bili, douyin, unit }) => ({
    name: unit ? label + '（' + unit + '）' : label,
    B站: bili,
    抖音: douyin,
  }));

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -14 }} barGap={3}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={compactNum}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
            cursor={HOVER_CURSOR}
            formatter={(v) => compactNum(Number(v))}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 4 }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="B站" name="B站" fill={CHART.bili} radius={[6, 6, 0, 0]} maxBarSize={34} />
          <Bar dataKey="抖音" name="抖音" fill={CHART.douyin} radius={[6, 6, 0, 0]} maxBarSize={34} />
        </BarChart>
      </ResponsiveContainer>
    </div>
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
  const { topics, loadTopics } = useTopicStore();

  useEffect(() => {
    loadData();
    void loadBenchmark();
  }, []);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const loadData = async () => {
    try {
      const [status, hist] = await Promise.all([
        api.getStatus(),
        api.getSyncHistory(),
      ]);
      setAccount(status.accountInfo);
      setHistory(hist);
      setDouyinForm({
        followers: status.accountInfo.douyinFollowers || 0,
        avgViews: status.accountInfo.douyinAvgViews || 0,
        totalVideos: status.accountInfo.douyinTotalVideos || 0,
        totalLikes: status.accountInfo.douyinTotalLikes || 0,
      });
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  };

  // 基准线。ready=false 时界面显示「暂无基准数据」，不显示任何占位数字。
  const loadBenchmark = async (force = false) => {
    setBenchmarkLoading(true);
    try {
      setBenchmark(force ? await api.refreshBenchmark() : await api.getBenchmark());
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
    } catch (err) {
      alert('同步失败: ' + (err as Error).message);
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
      setEditingDouyin(false);
    } catch (err) {
      alert('保存失败: ' + (err as Error).message);
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
      .filter((t) => t.estimatedViews > 0 && t.published?.views !== undefined)
      .map((t) => {
        const predicted = t.estimatedViews;
        const actual = t.published?.views ?? 0;
        return {
          id: t.id,
          title: t.title,
          predicted,
          actual,
          absError: Math.abs(actual - predicted) / predicted,
          url: t.published?.url,
          publishedAt: t.published?.publishedAt ?? 0,
        };
      })
      .sort((a, b) => b.absError - a.absError);

    const skipped = published.filter(
      (t) => !(t.estimatedViews > 0 && t.published?.views !== undefined),
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

    return {
      publishedCount: published.length,
      comparable,
      skipped,
      meanAbsError,
      medianRatio,
      overestimated,
      underestimated,
    };
  }, [topics]);

  if (!account) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary text-sm">加载中...</div>
      </div>
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
            <SectionHeading title="预测 vs 实际" hint="只统计两边都有数的选题" />
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              只统计「既有数字化预测、又有真实播放数据」的选题。缺任何一边都不参与统计——
              不补 0、不猜、不插值。实际数据由 B站接口取回。
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
                value={String(calibration.comparable.length)}
                unit="条"
                icon={Layers}
                tone="primary"
                hint="预测与实际都有"
              />
              <Stat
                label="平均绝对偏差"
                value={
                  calibration.meanAbsError === null
                    ? '—'
                    : `${(calibration.meanAbsError * 100).toFixed(1)}%`
                }
                icon={Target}
                tone="danger"
                hint="越低越准"
              />
              <Stat
                label="实际 / 预测 中位数"
                value={calibration.medianRatio === null ? '—' : `${calibration.medianRatio.toFixed(2)}×`}
                icon={Activity}
                tone="warning"
                hint="1.00 表示无系统性偏差"
              />
            </div>
            {calibration.comparable.length > 0 && (
              <p className="mt-4 text-xs text-text-muted">
                其中 高估 <span className="num text-danger">{calibration.overestimated}</span> 条 ·
                低估 <span className="num text-success">{calibration.underestimated}</span> 条
              </p>
            )}
          </Card>

          {calibration.comparable.length > 0 ? (
            <Card padding="none" className="overflow-hidden">
              <div className="border-b border-border px-5 py-4">
                <SectionHeading title="逐条对比" hint="偏差从大到小" className="mb-0" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-text-muted">
                      <th className="py-2.5 pl-5 pr-3 text-left font-medium">选题</th>
                      <th className="px-2 py-2.5 text-right font-medium">预测</th>
                      <th className="px-2 py-2.5 text-right font-medium">实际</th>
                      <th className="px-2 py-2.5 text-right font-medium">偏差</th>
                      <th className="py-2.5 pl-2 pr-5 text-right font-medium">发布日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {calibration.comparable.map((row) => (
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
                          {formatViews(row.predicted)}
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
                        <td className="num whitespace-nowrap py-2.5 pl-2 pr-5 text-right text-xs text-text-secondary">
                          {row.publishedAt ? new Date(row.publishedAt).toLocaleDateString('zh-CN') : '—'}
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
              description="去「选题看板」给选题做一次 AI 评估（会记下预测值），发布之后点「记录发布」粘贴视频链接，这里就会自动出现对比。"
            />
          )}

          {calibration.skipped.length > 0 && (
            <Card padding="lg">
              <SectionHeading
                title="未参与统计"
                hint={`${calibration.skipped.length} 条`}
              />
              <p className="mb-3 text-xs leading-relaxed text-text-secondary">
                这些选题已有发布记录，但缺少预测值或实际播放数据，因此不计入上面的偏差统计。
              </p>
              <ul className="space-y-1.5 text-sm">
                {calibration.skipped.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 text-text-secondary">
                    <span className="flex-1 truncate" title={t.title}>{t.title}</span>
                    <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">
                      {t.estimatedViews > 0 ? '缺实际数据' : '缺预测值'}
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
                  onClick={() => void loadBenchmark(true)}
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
