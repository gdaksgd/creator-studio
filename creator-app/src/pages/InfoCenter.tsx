import { useEffect, useState, useCallback } from 'react';
import { api, type NewsItem } from '../api/client';
import { useTopicStore } from '../store/topicStore';
import { NEWS_CATEGORIES, categoryLabel, isCreativeCategory, DEFAULT_CATEGORY } from '../config/categories';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/Spinner';
import { Stat } from '../components/ui/Stat';
import { BookmarkPlus, Check, Flame, Languages, Newspaper, Radar, Radio } from 'lucide-react';

const SOURCE_LABELS: Record<string, string> = {
  rss: 'RSS',
  youtube: 'YouTube',
  bilibili: 'B站',
  steam: 'Steam',
};

/** 来源徽标配色：走 Badge 的语义变体，避免每处再写一套色值 */
const SOURCE_VARIANT: Record<string, 'neutral' | 'danger' | 'primary' | 'info'> = {
  rss: 'neutral',
  youtube: 'danger',
  bilibili: 'primary',
  steam: 'info',
};

/** 列表行左侧 2px 竖条：用来源色区分渠道，比再加一个图标更克制 */
const SOURCE_BAR: Record<string, string> = {
  rss: 'bg-text-muted/40',
  youtube: 'bg-danger',
  bilibili: 'bg-primary',
  steam: 'bg-info',
};

function formatViews(views?: number): string {
  if (!views) return '';
  if (views >= 10000) return `${(views / 10000).toFixed(1)}万`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}千`;
  return String(views);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  const mins = Math.floor(diff / 60000);
  return `${mins}分钟前`;
}

/** 首屏只铺这么多条：库里最多 500 条，一次全渲染会让首屏很重、滚动条长得没边 */
const PAGE_SIZE = 24;

export default function InfoCenter() {
  const { addTopic } = useTopicStore();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  const [lastCollected, setLastCollected] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'youtube' | 'bilibili' | 'rss'>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadNews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getNews({
        category: filter === 'all' ? undefined : filter,
        sourceType: sourceFilter === 'all' ? undefined : sourceFilter,
        // 拉取全部（数据库上限 500），否则较早的 YouTube 等来源会被分页截断看不到
        limit: 500,
      });
      setNews(data.news);
      setVisibleCount(PAGE_SIZE);
      setLastCollected(data.lastCollected);
    } catch (err) {
      console.error('Failed to load news:', err);
    } finally {
      setLoading(false);
    }
  }, [filter, sourceFilter]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const handleCollect = async () => {
    setCollecting(true);
    try {
      await api.collectNews();
      await loadNews();
    } catch (err) {
      alert('收集失败: ' + (err as Error).message);
    } finally {
      setCollecting(false);
    }
  };

  const handleRetranslate = async () => {
    if (!confirm('确定重新翻译全部新闻标题？这会清空现有翻译并重新生成。')) return;
    setRetranslating(true);
    try {
      const result = await api.retranslate();
      await loadNews();
      alert(`已重新翻译 ${result.translated}/${result.total} 条标题`);
    } catch (err) {
      alert('重新翻译失败: ' + (err as Error).message);
    } finally {
      setRetranslating(false);
    }
  };

  const handleSaveAsTopic = async (item: NewsItem) => {
    // 资讯的品类可能是采集用的「综合资讯」(general)，它不是创作品类。
    // 存成选题时必须落到一个真正的创作品类，否则看板的品类筛选器里看不到它。
    const category = isCreativeCategory(item.category) ? item.category : DEFAULT_CATEGORY;
    await addTopic({
      title: item.title,
      category,
      status: 'idea',
      difficulty: 3,
      estimatedViews: 0,
      urgency: 'medium',
      notes: `来源: ${item.source} | ${item.url}`,
      productionIdea: '',
      gameDescription: item.summary || '',
    });
    await api.markAsTopic(item.id);
    alert('已保存为选题！');
  };

  // ── 顶部指标：全部由已加载的 news 现算，不额外发请求、不编造数据 ──
  const DAY_MS = 86400000;
  const nowMs = Date.now();
  const todayCount = news.filter((n) => nowMs - n.publishedAt < DAY_MS).length;
  const platformCount = new Set(news.map((n) => n.sourceType)).size;
  const savedCount = news.filter((n) => n.savedAsTopic).length;
  const visibleNews = news.slice(0, visibleCount);

  return (
    <div>
      <PageHeader
        eyebrow="数据 / NEWS"
        title="资讯中心"
        description={`自动收集各品类游戏资讯和热门视频${
          lastCollected ? ` | 上次更新: ${timeAgo(lastCollected)}` : ''
        }`}
        actions={
          <>
            <Button onClick={handleCollect} loading={collecting}>
              <Radar className="h-4 w-4" aria-hidden="true" />
              {collecting ? '收集中...' : '立即收集'}
            </Button>
            <Button variant="secondary" onClick={handleRetranslate} loading={retranslating}>
              <Languages className="h-4 w-4" aria-hidden="true" />
              {retranslating ? '翻译中...' : '重新翻译'}
            </Button>
          </>
        }
      />

      {/* 指标条：四个数字全部来自当前已加载的资讯列表 */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="收录资讯"
          value={news.length}
          unit="条"
          icon={Newspaper}
          hint="当前筛选结果"
        />
        <Stat
          label="今日新增"
          value={todayCount}
          unit="条"
          icon={Flame}
          tone="warning"
          hint="按发布时间统计"
        />
        <Stat
          label="覆盖平台"
          value={platformCount}
          unit="个"
          icon={Radio}
          tone="info"
          hint="当前结果内的来源数"
        />
        <Stat
          label="已存选题"
          value={savedCount}
          unit="条"
          icon={BookmarkPlus}
          tone="success"
          hint="已转成选题的资讯"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/70 p-2.5">
        <div role="group" aria-label="按品类筛选" className="flex flex-wrap items-center gap-2">
          {[{ id: 'all', short: '全部', emoji: '' }, ...NEWS_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(c.id)}
              aria-pressed={filter === c.id}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                filter === c.id
                  ? 'border-transparent bg-primary text-white shadow-xs'
                  : 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text'
              }`}
            >
              {c.id === 'all' ? '全部' : `${c.emoji} ${c.short}`}
            </button>
          ))}
        </div>
        <span className="h-4 w-px bg-border" aria-hidden="true" />
        <div role="group" aria-label="按来源筛选" className="flex flex-wrap items-center gap-2">
          {(['all', 'bilibili', 'youtube', 'rss'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSourceFilter(s)}
              aria-pressed={sourceFilter === s}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                sourceFilter === s
                  ? 'border-transparent bg-text text-bg shadow-xs'
                  : 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text'
              }`}
            >
              {s === 'all' ? '全部来源' : SOURCE_LABELS[s]}
            </button>
          ))}
        </div>
        <span className="num ml-auto shrink-0 text-xs text-text-muted">
          {news.length} 条
        </span>
      </div>

      {loading ? (
        <LoadingBlock label="正在读取本地资讯…" />
      ) : news.length === 0 ? (
        <EmptyState
          icon={<Radar className="h-5 w-5" />}
          title="还没有资讯数据"
          description="点击右上角「立即收集」开始抓取，或等待定时自动收集"
        />
      ) : (
        <div className="stagger-children grid gap-3">
          {visibleNews.map((item) => (
            <article
              key={item.id}
              className="card card-hover relative flex gap-4 overflow-hidden p-4"
            >
              {/* 2px 来源色竖条 */}
              <span
                className={`absolute inset-y-0 left-0 w-0.5 ${SOURCE_BAR[item.sourceType]}`}
                aria-hidden="true"
              />
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt=""
                  className="h-16 w-28 shrink-0 rounded-lg border border-border object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-muted">
                  <Badge variant={SOURCE_VARIANT[item.sourceType]} size="sm">
                    {SOURCE_LABELS[item.sourceType]}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    {categoryLabel(item.category)}
                  </Badge>
                  <span className="min-w-0 truncate">{item.source}</span>
                  {item.metrics?.views ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Flame className="h-3 w-3 shrink-0 text-danger" aria-hidden="true" />
                        <span className="num">{formatViews(item.metrics.views)}</span> 播放
                      </span>
                    </>
                  ) : null}
                  <span className="num ml-auto shrink-0">{timeAgo(item.publishedAt)}</span>
                </div>
                <h3 className="text-sm font-medium leading-snug tracking-tight text-text line-clamp-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-primary"
                  >
                    {item.translatedTitle || item.title}
                  </a>
                </h3>
                {item.translatedTitle && item.translatedTitle !== item.title && (
                  <p className="mt-1 text-xs italic text-text-muted line-clamp-1">
                    原文: {item.title}
                  </p>
                )}
                {item.summary && (
                  <p className="mt-1.5 text-xs leading-relaxed text-text-secondary line-clamp-2">
                    {item.summary}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant={item.savedAsTopic ? 'soft' : 'secondary'}
                    size="xs"
                    onClick={() => handleSaveAsTopic(item)}
                    className={
                      item.savedAsTopic
                        ? 'border border-success/30 bg-success-soft text-success'
                        : 'border-primary/30 text-primary hover:bg-primary-soft'
                    }
                  >
                    {item.savedAsTopic ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {item.savedAsTopic ? '已存为选题' : '存为选题'}
                  </Button>
                </div>
              </div>
            </article>
          ))}
          {news.length > visibleCount && (
            <div className="flex justify-center pt-1">
              <Button
                variant="secondary"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                显示更多（还有 {news.length - visibleCount} 条）
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
