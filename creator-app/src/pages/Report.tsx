// ============================================================
//  分析报告（M3）
//
//  把基准线数据变成一件可导出的作品：《B站游戏区内容分析报告》。
//
//  ★ 数据诚实原则在这个页面的落点：
//    - 页面上每一个数字都来自后端 ReportMetric.display —— 数字和它的来源
//      （样本量 / 时间窗 / 统计口径）是同一个对象，前端没有「只渲染数字」的路径；
//    - 「来源与样本量」列是表格的固定列，缩略为 n=…｜近 N 天，鼠标悬停可看完整口径；
//    - 没有样本的维度显示「本维度样本不足，不给结论」，而不是显示 0；
//    - 导出按钮直接下载后端渲染好的 Markdown（导出件与页面同源，不会对不上）。
// ============================================================

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Database,
  Download,
  FileChartColumn,
  ListChecks,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { SourceNote } from '../components/ui/SourceNote';
import { Stat } from '../components/ui/Stat';
import { categoryEmoji, categoryLabel } from '../config/categories';
import { loadWithCache } from '../services/queryCache';
import { useTopicStore } from '../store/topicStore';
import type {
  CompetitionIntensity,
  GameIndustryReport,
  ReportBasis,
  ReportMetric,
} from '../types';

const TREND_LABEL: Record<GameIndustryReport['durationCurve']['trend'], string> = {
  decreasing: '整体上「视频越长、点赞率越低」',
  increasing: '整体上「视频越长、点赞率越高」',
  flat: '两端基本持平，看不出方向',
  unknown: '样本不足以判断趋势',
};

const INTENSITY_STYLE: Record<CompetitionIntensity, { label: string; cls: string }> = {
  high: { label: '高', cls: 'bg-danger-soft text-danger border-danger/30' },
  medium: { label: '中', cls: 'bg-warning-soft text-warning border-warning/30' },
  low: { label: '低', cls: 'bg-success-soft text-success border-success/30' },
};

const windowText = (basis: ReportBasis) =>
  basis.windowDays === null ? '榜单快照' : `近 ${basis.windowDays} 天`;

/**
 * 报告里每条数据的等级：与下方「口径与出处」表的分级定义保持一致
 * （A = 平台官方口径 / 同行评审；C = 本工具自定义派生口径，不能当 KPI）。
 */
const basisTier = (basis: ReportBasis): 'A' | 'C' => (basis.source === 'derived' ? 'C' : 'A');

/** 表格里的「来源与样本量」列：缩略显示 + 悬停看完整统计口径 */
function SourceCell({ basis }: { basis: ReportBasis }) {
  return (
    <td
      className="num whitespace-nowrap px-3 py-2.5 text-xs text-text-muted"
      title={`${basis.sourceLabel}｜口径：${basis.method}`}
    >
      n={basis.sampleSize}｜{windowText(basis)}
    </td>
  );
}

function MetricCell({ m }: { m: ReportMetric | null }) {
  if (!m)
    return (
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-text-muted">
        该来源不提供
      </td>
    );
  return (
    <td
      className="num whitespace-nowrap px-3 py-2.5 text-right"
      title={`${m.label}：${m.display}｜口径：${m.basis.method}`}
    >
      {m.display}
    </td>
  );
}

function Caveat({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-xs leading-relaxed text-warning">
      <span className="font-medium">局限：</span>
      {text}
    </p>
  );
}

/** 样本不足 / 无结论：不用空白，也不给占位数字 */
function NoData({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-xs leading-relaxed text-text-secondary">
      {children}
    </p>
  );
}

export default function Report() {
  const [report, setReport] = useState<GameIndustryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const topics = useTopicStore((s) => s.topics);
  const loadTopics = useTopicStore((s) => s.loadTopics);

  /**
   * 取报告。
   *
   * 报告来自最近一次 B 站快照，一小时内的重复打开拿到的必然是同一份数据，
   * 却每次都要重传 32KB（公网隧道下体感更明显）。所以走小时级本地缓存：
   * 缓存新鲜就直接渲染、不发请求；点「刷新」时 force=true 强制回源。
   */
  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await loadWithCache('report:game-industry:default', () => api.getReport(), { force });
      if (res.data) setReport(res.data.report);
      setCachedAt(res.fetchedAt);
      setFromCache(res.fromCache);
      if (res.error) {
        if (res.error instanceof ApiError && res.error.status === 503) {
          // 503 = 样本还没采到。后端给的是 NOT_READY，不是空报告。
          setError(`报告暂不可用：${res.error.message}`);
        } else {
          setError(res.error instanceof Error ? res.error.message : '报告加载失败');
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadTopics();
  }, [load, loadTopics]);

  // 本地选题 × 报告品类：后端不持有用户选题，所以这个 join 只能在前端做
  const myCategories = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const t of topics) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
    const rows = [...byCat.entries()].map(([id, count]) => ({
      id,
      count,
      line: report?.categories.find((c) => c.key === id) ?? null,
    }));
    rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [topics, report]);

  const timingMax = useMemo(
    () => (report ? Math.max(1, ...report.publishTiming.buckets.map((b) => b.videoCount)) : 1),
    [report],
  );

  // 只有「手里还没有报告」时才占满整页显示生成中；点刷新时保留已有报告，
  // 不要在等新数据的几百毫秒里把整页内容清空。
  if (loading && !report) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="数据 / REPORT"
          title="分析报告"
          description="所有结论都可溯源到平台数据。"
        />
        <Card padding="lg">
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            <span
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            报告生成中……首次采集需要约 20 秒。
          </div>
        </Card>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="数据 / REPORT"
          title="分析报告"
          description="所有结论都可溯源到平台数据。"
        />
        <Card padding="lg" className="space-y-3">
          <SectionHeading title="报告暂不可用" className="mb-0" />
          <p className="text-sm text-text">{error ?? '报告加载失败'}</p>
          <p className="text-xs leading-relaxed text-text-muted">
            报告的数据来自 B站热门榜与搜索接口的一次快照。采集完成前，本页不会用 0 或占位数字顶替。
          </p>
          <div>
            <Button size="sm" onClick={() => void load(true)}>
              <RefreshCw className="h-3.5 w-3.5" />
              重新加载
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const { scope, selfCheck } = report;

  return (
    <div className="space-y-6">
      {/* 页面头：原来的 h1 + 生成时间/样本池 + 两个按钮都合并到这里 */}
      <PageHeader
        eyebrow="数据 / REPORT"
        title="分析报告"
        description={
          <>
            B站游戏区内容分析报告　·　所有结论都可溯源到平台数据。生成于{' '}
            <span className="num">{new Date(report.generatedAt).toLocaleString('zh-CN')}</span>
            　·　样本池 <span className="num">{report.poolSize}</span> 条原始条目
            {scope.sampleSize > 0 ? (
              <>
                　·　游戏子分区样本 <span className="num">{scope.sampleSize}</span> 条
              </>
            ) : (
              ''
            )}
            {fromCache && cachedAt ? (
              <>
                　·　本机缓存于{' '}
                <span className="num">{new Date(cachedAt).toLocaleTimeString('zh-CN')}</span>
                （每小时自动回源）
              </>
            ) : (
              ''
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void load(true)} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
            <a
              href={api.reportMarkdownUrl(report.days)}
              className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 text-xs font-medium text-white shadow-xs transition-colors duration-150 select-none hover:bg-primary-hover"
            >
              <Download className="h-3.5 w-3.5" />
              导出 Markdown
            </a>
          </>
        }
      />

      {error && (
        <p className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
          刷新失败（{error}），下面是本机缓存的上一次报告。
        </p>
      )}

      {/* 概览指标：全部由报告自身字段派生，未新增任何数据来源 */}
      <section className="stagger-children grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="原始样本池"
          value={report.poolSize}
          unit="条"
          hint="本次采集的原始条目"
          icon={Database}
          tone="primary"
        />
        <Stat
          label="游戏子分区样本"
          value={scope.sampleSize}
          unit="条"
          hint={scope.sourceLabel}
          icon={FileChartColumn}
          tone="info"
        />
        <Stat
          label="报告数字总数"
          value={selfCheck.metricCount}
          unit="个"
          hint="每个数字都绑定来源与口径"
          icon={ListChecks}
          tone="neutral"
        />
        <Stat
          label="无来源数字"
          value={selfCheck.unbackedMetricCount}
          unit="个"
          hint={selfCheck.unbackedMetricCount === 0 ? '数据自检通过' : '程序缺陷，请勿引用'}
          icon={selfCheck.unbackedMetricCount === 0 ? CircleCheck : CircleAlert}
          tone={selfCheck.unbackedMetricCount === 0 ? 'success' : 'danger'}
        />
      </section>

      {/* 数据自检 */}
      <section
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border p-4 text-xs leading-relaxed ${
          selfCheck.unbackedMetricCount === 0
            ? 'border-success/30 bg-success-soft text-success'
            : 'border-danger/30 bg-danger-soft text-danger'
        }`}
      >
        <span className="font-medium">
          数据自检：{selfCheck.metricCount} 个数字，{selfCheck.unbackedMetricCount} 个没有来源
        </span>
        <span>
          {selfCheck.unbackedMetricCount === 0
            ? '— 报告里每个数字都带着它的样本量与统计口径。'
            : '— 这是程序缺陷，请勿引用本报告。'}
        </span>
      </section>

      {/* 口径 */}
      <Card padding="lg">
        <SectionHeading title="数据口径" hint={windowText(scope)} />
        <SourceNote
          tier={basisTier(scope)}
          label="来源"
          note={`样本量 ${scope.sampleSize} 条，${windowText(scope)}`}
          className="mt-0"
        >
          {scope.sourceLabel}
        </SourceNote>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">{scope.method}</p>
      </Card>

      {/* 一、品类分布与竞争强度 */}
      <Card padding="none" className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <SectionHeading title="一、品类分布与竞争强度" className="mb-0" />
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            按播放中位降序。「播放中位」是这个品类当前的
            <strong className="font-medium text-text">水位线</strong>，不是对你的预测。
          </p>
        </div>
        {report.categories.length === 0 ? (
          <div className="p-5">
            <NoData>本次没有任何品类的样本量达标，因此不给品类结论。</NoData>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="py-2.5 pl-5 pr-3 text-left font-medium">品类</th>
                  <th className="px-3 py-2.5 text-right font-medium">样本量</th>
                  <th className="px-3 py-2.5 text-right font-medium">播放中位</th>
                  <th className="px-3 py-2.5 text-right font-medium">播放 P90</th>
                  <th className="px-3 py-2.5 text-right font-medium">点赞率中位</th>
                  <th className="px-3 py-2.5 text-right font-medium">头部集中度</th>
                  <th className="px-3 py-2.5 text-center font-medium">竞争强度</th>
                  <th className="px-3 py-2.5 text-right font-medium">疑问句标题</th>
                  <th className="px-3 py-2.5 text-right font-medium">时长中位</th>
                  <th className="px-3 py-2.5 text-left font-medium">来源与样本量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.categories.map((c) => (
                  <tr key={c.key} className="transition-colors hover:bg-surface-hover">
                    <td className="whitespace-nowrap py-2.5 pl-5 pr-3">
                      <span className="mr-1">{categoryEmoji(c.key)}</span>
                      {c.label}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                      {c.sampleSize}
                      <span className="text-xs text-text-muted"> 条</span>
                    </td>
                    <MetricCell m={c.viewMedian} />
                    <MetricCell m={c.viewP90} />
                    <MetricCell m={c.likeRateMedian} />
                    <MetricCell m={c.concentration} />
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs ${INTENSITY_STYLE[c.intensity].cls}`}
                      >
                        {INTENSITY_STYLE[c.intensity].label}
                      </span>
                    </td>
                    <MetricCell m={c.questionRatio} />
                    <MetricCell m={c.durationMedian} />
                    <SourceCell basis={c.viewMedian.basis} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-border bg-surface-muted px-5 py-3 text-xs leading-relaxed text-text-secondary">
          头部集中度 = 播放量前 10% 的视频占样本总播放的比例（≥60% 记为高、≥40% 记为中，阈值是本报告自定义分档）。
          集中度越高，越依赖单条爆款，新号越难靠稳定更新慢慢爬。
        </p>
      </Card>

      {/* 二、标题模式 */}
      <Card padding="lg" className="space-y-4">
        <div>
          <SectionHeading title="二、TOP 作品的标题模式" className="mb-0" />
          <SourceNote
            tier={basisTier(report.titlePattern.basis)}
            label="样本"
            note={`n=${report.titlePattern.basis.sampleSize}`}
            className="mt-1.5"
          >
            {report.titlePattern.basis.sourceLabel}
          </SourceNote>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: '疑问句标题占比', m: report.titlePattern.questionRatio },
            { label: '标题字数中位', m: report.titlePattern.lengthMedian },
            { label: '字数 P25', m: report.titlePattern.lengthP25 },
            { label: '字数 P75', m: report.titlePattern.lengthP75 },
          ].map(({ label, m }) => (
            <div
              key={label}
              className="rounded-xl border border-border bg-surface-muted/50 p-3.5"
              title={m?.basis.method}
            >
              <div className="eyebrow">{label}</div>
              <div className="num mt-1.5 text-2xl font-semibold leading-none tracking-tight text-text">
                {m ? m.display : '—'}
              </div>
              {m ? (
                <SourceNote
                  tier={basisTier(m.basis)}
                  label="来源"
                  note={`n=${m.basis.sampleSize}｜${windowText(m.basis)}`}
                  className="mt-2"
                >
                  {m.basis.sourceLabel}
                </SourceNote>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                  本维度样本不足，不给数字
                </p>
              )}
            </div>
          ))}
        </div>

        {report.titlePattern.lengthMedian === null && (
          <NoData>
            本维度样本不足（游戏子分区热门榜标题需 ≥ 20 条），这次不给数字——样本不够时宁可不写。
          </NoData>
        )}

        {report.titlePattern.lengthBuckets.length > 0 && (
          <div>
            <div className="mb-2.5 text-xs font-medium text-text-secondary">标题字数分布</div>
            <div className="space-y-2">
              {report.titlePattern.lengthBuckets.map((b) => (
                <div key={b.label} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-text-muted">{b.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${b.ratio * 100}%` }}
                    />
                  </div>
                  <span className="num w-20 shrink-0 text-right text-text-muted">
                    {b.count} 条 · {(b.ratio * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.titlePattern.keywords.length > 0 && (
          <div>
            <div className="mb-2.5 text-xs font-medium text-text-secondary">
              高频内容词（括号内为出现在多少条标题里）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {report.titlePattern.keywords.map((k) => (
                <span
                  key={k.word}
                  className="rounded-md border border-border bg-surface-muted px-2 py-1 text-xs text-text"
                  title={`${k.count} 条标题出现，占 ${(k.ratio * 100).toFixed(1)}%`}
                >
                  {k.word}
                  <span className="num text-text-muted"> ({k.count})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <Caveat text={report.titlePattern.caveat} />
      </Card>

      {/* 三、时长–互动率 */}
      <Card padding="none" className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <SectionHeading title="三、时长–互动率关系" className="mb-0" />
          <SourceNote
            tier={basisTier(report.durationCurve.basis)}
            label="样本"
            note={`n=${report.durationCurve.basis.sampleSize}`}
            className="mt-1.5"
          >
            {report.durationCurve.basis.sourceLabel}
          </SourceNote>
        </div>

        {report.durationCurve.buckets.length === 0 ? (
          <div className="p-5">
            <NoData>本维度样本不足，不给结论。</NoData>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-muted">
                    <th className="py-2.5 pl-5 pr-3 text-left font-medium">时长区间</th>
                    <th className="px-3 py-2.5 text-right font-medium">视频数</th>
                    <th className="px-3 py-2.5 text-right font-medium">播放中位</th>
                    <th className="px-3 py-2.5 text-right font-medium">点赞率中位</th>
                    <th className="px-3 py-2.5 text-left font-medium">来源与样本量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.durationCurve.buckets.map((b) => (
                    <tr
                      key={b.label}
                      className={`transition-colors hover:bg-surface-hover ${
                        b.label === report.durationCurve.bestBucket ? 'bg-info-soft' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap py-2.5 pl-5 pr-3">
                        {b.label}
                        {b.label === report.durationCurve.bestBucket && (
                          <span className="ml-2 rounded-full bg-info-soft px-2 py-0.5 text-xs text-info">
                            点赞率最高
                          </span>
                        )}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                        {b.videoCount}
                        <span className="text-xs text-text-muted"> 条</span>
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                        {b.videoCount > 0 ? b.viewMedian.display : '—'}
                      </td>
                      <MetricCell m={b.likeRateMedian} />
                      <SourceCell basis={b.viewMedian.basis} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border bg-surface-muted px-5 py-3 text-xs leading-relaxed text-text">
              趋势：
              <span className="font-medium">{TREND_LABEL[report.durationCurve.trend]}</span>
              {report.durationCurve.bestBucket
                ? `　·　点赞率中位最高的区间：「${report.durationCurve.bestBucket}」。`
                : '　·　没有任何区间样本量达标，本次不给「最优时长」结论。'}
            </p>
          </>
        )}

        <div className="px-5 pb-5 pt-4">
          <Caveat text={report.durationCurve.caveat} />
        </div>
      </Card>

      {/* 四、发布时段 */}
      <Card padding="lg" className="space-y-4">
        <div>
          <SectionHeading title="四、发布时段分布" className="mb-0" />
          <SourceNote
            tier={basisTier(report.publishTiming.basis)}
            label="时区 / 样本"
            note={`n=${report.publishTiming.basis.sampleSize}`}
            className="mt-1.5"
          >
            {report.publishTiming.timezone}
          </SourceNote>
        </div>

        {report.publishTiming.buckets.every((b) => b.videoCount === 0) ? (
          <NoData>本维度样本不足，不给结论。</NoData>
        ) : (
          <>
            <div className="rounded-xl border border-border p-4">
              <div className="flex h-40 items-end gap-[3px]">
                {report.publishTiming.buckets.map((b) => (
                  <div
                    key={b.hour}
                    className="group flex h-full flex-1 flex-col items-center justify-end"
                    title={`${String(b.hour).padStart(2, '0')}:00　${b.videoCount} 条　播放中位 ${b.viewMedian.toLocaleString()}`}
                  >
                    <div
                      className={`w-full rounded-t-[4px] transition-colors ${
                        report.publishTiming.topHours.includes(b.hour)
                          ? 'bg-info'
                          : 'bg-surface-muted group-hover:bg-border-strong'
                      }`}
                      style={{
                        height: `${(b.videoCount / timingMax) * 100}%`,
                        minHeight: b.videoCount > 0 ? '3px' : '0',
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-[3px] text-[11px] text-text-muted">
                {report.publishTiming.buckets.map((b) => (
                  <span key={b.hour} className="num flex-1 text-center">
                    {b.hour % 3 === 0 ? b.hour : ''}
                  </span>
                ))}
              </div>
            </div>
            {report.publishTiming.topHours.length > 0 && (
              <p className="text-xs leading-relaxed text-text">
                样本最集中的时段：
                <span className="num font-medium">
                  {report.publishTiming.topHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' / ')}
                </span>
                （蓝色柱子）
              </p>
            )}
          </>
        )}

        <Caveat text={report.publishTiming.caveat} />
      </Card>

      {/* 五、对你自己的选题的建议 */}
      <Card padding="lg" className="space-y-4">
        <SectionHeading title="五、对你自己的选题的建议" />

        <div>
          <div className="mb-2.5 text-xs font-medium text-text-secondary">
            你的选题看板在这个报告里的位置
          </div>
          {myCategories.length === 0 ? (
            <NoData>
              选题看板里还没有选题。先去「选题看板」建几个，这里就能把它们和上面的水位线对上。
            </NoData>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted text-xs text-text-muted">
                      <th className="py-2.5 pl-4 pr-3 text-left font-medium">你的品类</th>
                      <th className="px-3 py-2.5 text-right font-medium">你的选题数</th>
                      <th className="px-3 py-2.5 text-right font-medium">该品类播放中位</th>
                      <th className="px-3 py-2.5 text-right font-medium">头部集中度</th>
                      <th className="py-2.5 pl-3 pr-4 text-left font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {myCategories.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-surface-hover">
                        <td className="whitespace-nowrap py-2.5 pl-4 pr-3">
                          <span className="mr-1">{categoryEmoji(row.id)}</span>
                          {categoryLabel(row.id)}
                        </td>
                        <td className="num whitespace-nowrap px-3 py-2.5 text-right">
                          {row.count}
                          <span className="text-xs text-text-muted"> 个</span>
                        </td>
                        {row.line ? (
                          <>
                            <MetricCell m={row.line.viewMedian} />
                            <MetricCell m={row.line.concentration} />
                            <td className="num whitespace-nowrap py-2.5 pl-3 pr-4 text-xs text-text-muted">
                              n={row.line.sampleSize}｜{windowText(row.line.viewMedian.basis)}
                            </td>
                          </>
                        ) : (
                          <td
                            colSpan={3}
                            className="py-2.5 pl-3 pr-4 text-xs leading-relaxed text-text-muted"
                          >
                            本次采集里这个品类的样本量不达标，没有水位线可比 —— 不给数字，也不给占位值。
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {report.suggestions.length > 0 && (
          <ol className="space-y-3">
            {report.suggestions.map((s, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-xl border border-border bg-surface p-3.5"
              >
                <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary-soft text-[11px] font-semibold text-primary-contrast">
                  {i + 1}
                </span>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm leading-relaxed text-text">{s.text}</p>
                  {s.basis && (
                    <SourceNote
                      tier={basisTier(s.basis)}
                      label="依据"
                      note={`n=${s.basis.sampleSize}｜${windowText(s.basis)}｜${s.basis.method}`}
                    >
                      {s.basis.sourceLabel}
                    </SourceNote>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* 六、口径与出处 */}
      <Card padding="none" className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <SectionHeading title="六、口径、出处与已知局限" className="mb-0" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-text-muted">
                <th className="py-2.5 pl-5 pr-3 text-left font-medium">结论</th>
                <th className="px-3 py-2.5 text-left font-medium">出处</th>
                <th className="px-3 py-2.5 text-center font-medium">等级</th>
                <th className="py-2.5 pl-3 pr-5 text-left font-medium">用在哪</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.evidence.map((e, i) => (
                <tr
                  key={i}
                  className="align-top transition-colors hover:bg-surface-hover"
                >
                  <td className="py-2.5 pl-5 pr-3">{e.claim}</td>
                  <td className="px-3 py-2.5 text-text-secondary">{e.origin}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                        e.grade === 'A'
                          ? 'bg-success-soft text-success border-success/30'
                          : e.grade === 'B'
                            ? 'bg-warning-soft text-warning border-warning/30'
                            : 'bg-surface-muted text-text-secondary border-border'
                      }`}
                    >
                      {e.grade}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3 pr-5 text-text-secondary">{e.usedIn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border bg-surface-muted px-5 py-3 text-xs leading-relaxed text-text-secondary">
          分级：A = 平台官方口径 / 同行评审；B = 第三方大样本；C = 无法核实，不用于 KPI。
        </p>
      </Card>

      <Card padding="lg" className="space-y-4">
        {report.unavailable.length > 0 && (
          <div>
            <SectionHeading title="未能得出的维度" hint={`${report.unavailable.length} 项`} />
            <ul className="space-y-1.5">
              {report.unavailable.map((u, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning"
                >
                  {u}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <SectionHeading title="已知局限" />
          <ul className="space-y-1.5 text-xs leading-relaxed text-text-secondary">
            <li>· 全部数据来自 B站公开接口的一次快照，不是全量统计；「热门榜」本身只收录已经火了的视频。</li>
            <li>
              · 所有比率（点赞率、收藏率、头部集中度）都是本报告的自采样水位 ——
              游戏区没有公开可信的行业基准，不可当 KPI 或对外承诺。
            </li>
            <li>· 时长与互动率、发布时段与播放量之间都是横截面相关，没有控制变量，不能读成因果。</li>
          </ul>
        </div>
      </Card>

      <p className="pb-4 text-xs text-text-muted">
        报告为机器生成，结论需人工复核后使用。导出 Markdown 的内容与页面同源，便于归档、复盘或对外分享。
      </p>
    </div>
  );
}
