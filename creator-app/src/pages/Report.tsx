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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { categoryEmoji, categoryLabel } from '../config/categories';
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
  high: { label: '高', cls: 'bg-red-50 text-red-700 border-red-200' },
  medium: { label: '中', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  low: { label: '低', cls: 'bg-green-50 text-green-700 border-green-200' },
};

const windowText = (basis: ReportBasis) =>
  basis.windowDays === null ? '榜单快照' : `近 ${basis.windowDays} 天`;

/** 表格里的「来源与样本量」列：缩略显示 + 悬停看完整统计口径 */
function SourceCell({ basis }: { basis: ReportBasis }) {
  return (
    <td className="py-2 px-2 text-xs text-text-secondary whitespace-nowrap" title={`${basis.sourceLabel}｜口径：${basis.method}`}>
      n={basis.sampleSize}｜{windowText(basis)}
    </td>
  );
}

function MetricCell({ m }: { m: ReportMetric | null }) {
  if (!m) return <td className="py-2 px-2 text-right whitespace-nowrap text-text-secondary">该来源不提供</td>;
  return (
    <td className="py-2 px-2 text-right whitespace-nowrap" title={`${m.label}：${m.display}｜口径：${m.basis.method}`}>
      {m.display}
    </td>
  );
}

function Caveat({ text }: { text: string }) {
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 leading-relaxed">
      <span className="font-medium">局限：</span>
      {text}
    </p>
  );
}

export default function Report() {
  const [report, setReport] = useState<GameIndustryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const topics = useTopicStore((s) => s.topics);
  const loadTopics = useTopicStore((s) => s.loadTopics);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getReport();
      setReport(res.report);
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        // 503 = 样本还没采到。后端给的是 NOT_READY，不是空报告。
        setError(`报告暂不可用：${e.message}`);
      } else {
        setError(e instanceof Error ? e.message : '报告加载失败');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-secondary">
        报告生成中……首次采集需要约 20 秒。
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-text">B站游戏区内容分析报告</h1>
        <section className="bg-surface border border-border rounded-xl p-5 space-y-3">
          <p className="text-sm text-text">{error ?? '报告加载失败'}</p>
          <p className="text-xs text-text-secondary">
            报告的数据来自 B站热门榜与搜索接口的一次快照。采集完成前，本页不会用 0 或占位数字顶替。
          </p>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            重新加载
          </button>
        </section>
      </div>
    );
  }

  const { scope, selfCheck } = report;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-text">B站游戏区内容分析报告</h1>
          <p className="text-xs text-text-secondary mt-1">
            生成于 {new Date(report.generatedAt).toLocaleString('zh-CN')}　·　样本池 {report.poolSize} 条原始条目
            {scope.sampleSize > 0 ? `　·　游戏子分区样本 ${scope.sampleSize} 条` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 border border-border rounded-lg text-xs text-text-secondary hover:bg-gray-50 transition-colors"
          >
            刷新
          </button>
          <a
            href={api.reportMarkdownUrl(report.days)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
          >
            导出 Markdown
          </a>
        </div>
      </div>

      {/* 数据自检 */}
      <section
        className={`rounded-xl p-4 text-xs leading-relaxed border ${
          selfCheck.unbackedMetricCount === 0
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}
      >
        <span className="font-medium">
          数据自检：{selfCheck.metricCount} 个数字，{selfCheck.unbackedMetricCount} 个没有来源
        </span>
        {selfCheck.unbackedMetricCount === 0
          ? '　— 报告里每个数字都带着它的样本量与统计口径。'
          : '　— 这是程序缺陷，请勿引用本报告。'}
      </section>

      {/* 口径 */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-sm font-bold text-text mb-1">数据口径</h2>
        <p className="text-xs text-text-secondary leading-relaxed">
          <span className="text-text">{scope.sourceLabel}</span>，样本量 {scope.sampleSize} 条，
          {windowText(scope)}。
        </p>
        <p className="text-xs text-text-secondary leading-relaxed mt-1">{scope.method}</p>
      </section>

      {/* 一、品类分布与竞争强度 */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-sm font-bold text-text mb-1">一、品类分布与竞争强度</h2>
        <p className="text-xs text-text-secondary mb-3">
          按播放中位降序。「播放中位」是这个品类当前的<strong>水位线</strong>，不是对你的预测。
        </p>
        {report.categories.length === 0 ? (
          <p className="text-xs text-text-secondary">本次没有任何品类的样本量达标，因此不给品类结论。</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-secondary border-b border-border">
                  <th className="text-left py-2 pr-3 font-medium">品类</th>
                  <th className="text-right py-2 px-2 font-medium">样本量</th>
                  <th className="text-right py-2 px-2 font-medium">播放中位</th>
                  <th className="text-right py-2 px-2 font-medium">播放 P90</th>
                  <th className="text-right py-2 px-2 font-medium">点赞率中位</th>
                  <th className="text-right py-2 px-2 font-medium">头部集中度</th>
                  <th className="text-center py-2 px-2 font-medium">竞争强度</th>
                  <th className="text-right py-2 px-2 font-medium">疑问句标题</th>
                  <th className="text-right py-2 px-2 font-medium">时长中位</th>
                  <th className="text-left py-2 px-2 font-medium">来源与样本量</th>
                </tr>
              </thead>
              <tbody>
                {report.categories.map((c) => (
                  <tr key={c.key} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="mr-1">{categoryEmoji(c.key)}</span>
                      {c.label}
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      {c.sampleSize}
                      <span className="text-xs text-text-secondary"> 条</span>
                    </td>
                    <MetricCell m={c.viewMedian} />
                    <MetricCell m={c.viewP90} />
                    <MetricCell m={c.likeRateMedian} />
                    <MetricCell m={c.concentration} />
                    <td className="py-2 px-2 text-center whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-xs ${INTENSITY_STYLE[c.intensity].cls}`}>
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
        <p className="text-xs text-text-secondary mt-3 leading-relaxed">
          头部集中度 = 播放量前 10% 的视频占样本总播放的比例（≥60% 记为高、≥40% 记为中，阈值是本报告自定义分档）。
          集中度越高，越依赖单条爆款，新号越难靠稳定更新慢慢爬。
        </p>
      </section>

      {/* 二、标题模式 */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text mb-1">二、TOP 作品的标题模式</h2>
          <p className="text-xs text-text-secondary">
            样本：{report.titlePattern.basis.sourceLabel}　·　n={report.titlePattern.basis.sampleSize}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '疑问句标题占比', m: report.titlePattern.questionRatio },
            { label: '标题字数中位', m: report.titlePattern.lengthMedian },
            { label: '字数 P25', m: report.titlePattern.lengthP25 },
            { label: '字数 P75', m: report.titlePattern.lengthP75 },
          ].map(({ label, m }) => (
            <div key={label} className="border border-border rounded-lg p-3" title={m.basis.method}>
              <div className="text-xs text-text-secondary">{label}</div>
              <div className="text-xl font-bold text-text mt-1">{m.display}</div>
            </div>
          ))}
        </div>

        {report.titlePattern.lengthBuckets.length > 0 && (
          <div>
            <div className="text-xs text-text-secondary mb-2">标题字数分布</div>
            <div className="space-y-1.5">
              {report.titlePattern.lengthBuckets.map((b) => (
                <div key={b.label} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-text-secondary">{b.label}</span>
                  <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full bg-violet-500" style={{ width: `${b.ratio * 100}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-text-secondary">
                    {b.count} 条 · {(b.ratio * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.titlePattern.keywords.length > 0 && (
          <div>
            <div className="text-xs text-text-secondary mb-2">
              高频内容词（括号内为出现在多少条标题里）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {report.titlePattern.keywords.map((k) => (
                <span
                  key={k.word}
                  className="px-2 py-1 bg-gray-100 rounded-md text-xs text-text"
                  title={`${k.count} 条标题出现，占 ${(k.ratio * 100).toFixed(1)}%`}
                >
                  {k.word}
                  <span className="text-text-secondary"> ({k.count})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <Caveat text={report.titlePattern.caveat} />
      </section>

      {/* 三、时长–互动率 */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text mb-1">三、时长–互动率关系</h2>
          <p className="text-xs text-text-secondary">
            样本：{report.durationCurve.basis.sourceLabel}　·　n={report.durationCurve.basis.sampleSize}
          </p>
        </div>

        {report.durationCurve.buckets.length === 0 ? (
          <p className="text-xs text-text-secondary">本维度样本不足，不给结论。</p>
        ) : (
          <>
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-text-secondary border-b border-border">
                    <th className="text-left py-2 pr-3 font-medium">时长区间</th>
                    <th className="text-right py-2 px-2 font-medium">视频数</th>
                    <th className="text-right py-2 px-2 font-medium">播放中位</th>
                    <th className="text-right py-2 px-2 font-medium">点赞率中位</th>
                    <th className="text-left py-2 px-2 font-medium">来源与样本量</th>
                  </tr>
                </thead>
                <tbody>
                  {report.durationCurve.buckets.map((b) => (
                    <tr
                      key={b.label}
                      className={`border-b border-border last:border-0 ${
                        b.label === report.durationCurve.bestBucket ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {b.label}
                        {b.label === report.durationCurve.bestBucket && (
                          <span className="ml-2 text-xs text-blue-700">点赞率最高</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        {b.videoCount}
                        <span className="text-xs text-text-secondary"> 条</span>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        {b.videoCount > 0 ? b.viewMedian.display : '—'}
                      </td>
                      <MetricCell m={b.likeRateMedian} />
                      <SourceCell basis={b.viewMedian.basis} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text leading-relaxed">
              趋势：<span className="font-medium">{TREND_LABEL[report.durationCurve.trend]}</span>
              {report.durationCurve.bestBucket
                ? `　·　点赞率中位最高的区间：「${report.durationCurve.bestBucket}」。`
                : '　·　没有任何区间样本量达标，本次不给「最优时长」结论。'}
            </p>
          </>
        )}

        <Caveat text={report.durationCurve.caveat} />
      </section>

      {/* 四、发布时段 */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-text mb-1">四、发布时段分布</h2>
          <p className="text-xs text-text-secondary">
            {report.publishTiming.timezone}　·　n={report.publishTiming.basis.sampleSize}
          </p>
        </div>

        {report.publishTiming.buckets.every((b) => b.videoCount === 0) ? (
          <p className="text-xs text-text-secondary">本维度样本不足，不给结论。</p>
        ) : (
          <>
            <div className="flex items-end gap-1 h-24">
              {report.publishTiming.buckets.map((b) => (
                <div key={b.hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${String(b.hour).padStart(2, '0')}:00　${b.videoCount} 条　播放中位 ${b.viewMedian.toLocaleString()}`}>
                  <div
                    className={`w-full rounded-t ${report.publishTiming.topHours.includes(b.hour) ? 'bg-blue-500' : 'bg-gray-300'}`}
                    style={{ height: `${(b.videoCount / timingMax) * 100}%`, minHeight: b.videoCount > 0 ? '2px' : '0' }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-1 text-[10px] text-text-secondary">
              {report.publishTiming.buckets.map((b) => (
                <span key={b.hour} className="flex-1 text-center">
                  {b.hour % 3 === 0 ? b.hour : ''}
                </span>
              ))}
            </div>
            {report.publishTiming.topHours.length > 0 && (
              <p className="text-xs text-text">
                样本最集中的时段：
                <span className="font-medium">
                  {report.publishTiming.topHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' / ')}
                </span>
                （蓝色柱子）
              </p>
            )}
          </>
        )}

        <Caveat text={report.publishTiming.caveat} />
      </section>

      {/* 五、对你自己的选题的建议 */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-text">五、对你自己的选题的建议</h2>

        <div>
          <div className="text-xs text-text-secondary mb-2">你的选题看板在这个报告里的位置</div>
          {myCategories.length === 0 ? (
            <p className="text-xs text-text-secondary">
              选题看板里还没有选题。先去「选题看板」建几个，这里就能把它们和上面的水位线对上。
            </p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-text-secondary border-b border-border">
                    <th className="text-left py-2 pr-3 font-medium">你的品类</th>
                    <th className="text-right py-2 px-2 font-medium">你的选题数</th>
                    <th className="text-right py-2 px-2 font-medium">该品类播放中位</th>
                    <th className="text-right py-2 px-2 font-medium">头部集中度</th>
                    <th className="text-left py-2 px-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {myCategories.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="mr-1">{categoryEmoji(row.id)}</span>
                        {categoryLabel(row.id)}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        {row.count}
                        <span className="text-xs text-text-secondary"> 个</span>
                      </td>
                      {row.line ? (
                        <>
                          <MetricCell m={row.line.viewMedian} />
                          <MetricCell m={row.line.concentration} />
                          <td className="py-2 px-2 text-xs text-text-secondary whitespace-nowrap">
                            n={row.line.sampleSize}｜{windowText(row.line.viewMedian.basis)}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="py-2 px-2 text-xs text-text-secondary">
                          本次采集里这个品类的样本量不达标，没有水位线可比 —— 不给数字，也不给占位值。
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ol className="space-y-3 list-decimal list-inside">
          {report.suggestions.map((s, i) => (
            <li key={i} className="text-sm text-text leading-relaxed">
              {s.text}
              {s.basis && (
                <div className="text-xs text-text-secondary mt-1 ml-5">
                  依据：{s.basis.sourceLabel}｜n={s.basis.sampleSize}｜{windowText(s.basis)}｜{s.basis.method}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* 六、口径与出处 */}
      <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-text">六、口径、出处与已知局限</h2>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-text-secondary border-b border-border">
                <th className="text-left py-2 pr-3 font-medium">结论</th>
                <th className="text-left py-2 px-2 font-medium">出处</th>
                <th className="text-center py-2 px-2 font-medium">等级</th>
                <th className="text-left py-2 px-2 font-medium">用在哪</th>
              </tr>
            </thead>
            <tbody>
              {report.evidence.map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-3">{e.claim}</td>
                  <td className="py-2 px-2 text-text-secondary">{e.origin}</td>
                  <td className="py-2 px-2 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full border text-xs ${
                        e.grade === 'A'
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : e.grade === 'B'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-gray-100 text-text-secondary border-border'
                      }`}
                    >
                      {e.grade}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-text-secondary">{e.usedIn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-secondary">
          分级：A = 平台官方口径 / 同行评审；B = 第三方大样本；C = 无法核实，不用于 KPI。
        </p>

        {report.unavailable.length > 0 && (
          <div>
            <div className="text-xs font-medium text-text mb-1">未能得出的维度</div>
            <ul className="space-y-1">
              {report.unavailable.map((u, i) => (
                <li key={i} className="text-xs text-amber-800 leading-relaxed">
                  · {u}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-text mb-1">已知局限</div>
          <ul className="space-y-1 text-xs text-text-secondary leading-relaxed">
            <li>· 全部数据来自 B站公开接口的一次快照，不是全量统计；「热门榜」本身只收录已经火了的视频。</li>
            <li>· 所有比率（点赞率、收藏率、头部集中度）都是本报告的自采样水位 —— 游戏区没有公开可信的行业基准，不可当 KPI 或对外承诺。</li>
            <li>· 时长与互动率、发布时段与播放量之间都是横截面相关，没有控制变量，不能读成因果。</li>
          </ul>
        </div>
      </section>

      <p className="text-xs text-text-secondary pb-4">
        报告为机器生成，结论需人工复核后使用。导出 Markdown 的内容与页面同源，可随作品集一起提交。
      </p>
    </div>
  );
}
