import { useEffect, useState, useCallback } from 'react';
import { api, type NewsItem } from '../api/client';
import { useTopicStore } from '../store/topicStore';
import type { GameCategory } from '../types';

const SOURCE_LABELS: Record<string, string> = {
  rss: 'RSS',
  youtube: 'YouTube',
  bilibili: 'B站',
  steam: 'Steam',
};

const SOURCE_COLORS: Record<string, string> = {
  rss: 'bg-gray-100 text-gray-700',
  youtube: 'bg-red-50 text-red-700',
  bilibili: 'bg-pink-50 text-pink-700',
  steam: 'bg-blue-50 text-blue-700',
};

const CATEGORY_LABELS: Record<string, string> = {
  card: '卡牌游戏',
  horror: '恐怖游戏',
  general: '通用',
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

export default function InfoCenter() {
  const { addTopic } = useTopicStore();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [lastCollected, setLastCollected] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'card' | 'horror'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'youtube' | 'bilibili' | 'rss'>('all');

  const loadNews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getNews({
        category: filter === 'all' ? undefined : filter,
        sourceType: sourceFilter === 'all' ? undefined : sourceFilter,
        limit: 100,
      });
      setNews(data.news);
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

  const handleSaveAsTopic = async (item: NewsItem) => {
    const category = (item.category === 'horror' ? 'horror' : 'card') as GameCategory;
    await addTopic({
      title: item.title,
      category,
      status: 'idea',
      difficulty: 3,
      estimatedViews: 0,
      urgency: 'medium',
      notes: `来源: ${item.source} | ${item.url}`,
    });
    await api.markAsTopic(item.id);
    alert('已保存为选题！');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-text">资讯中心</h1>
          <p className="text-text-secondary text-sm mt-1">
            自动收集卡牌游戏资讯和恐怖游戏热门视频
            {lastCollected && ` | 上次更新: ${timeAgo(lastCollected)}`}
          </p>
        </div>
        <button
          onClick={handleCollect}
          disabled={collecting}
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {collecting ? '收集中...' : '立即收集'}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['all', 'card', 'horror'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary hover:text-text'
            }`}
          >
            {f === 'all' ? '全部' : CATEGORY_LABELS[f]}
          </button>
        ))}
        <span className="w-px h-5 bg-border mx-1" />
        {(['all', 'bilibili', 'youtube', 'rss'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              sourceFilter === s ? 'bg-gray-800 text-white' : 'bg-surface border border-border text-text-secondary hover:text-text'
            }`}
          >
            {s === 'all' ? '全部来源' : SOURCE_LABELS[s]}
          </button>
        ))}
        <span className="text-xs text-text-secondary ml-auto">{news.length} 条</span>
      </div>

      {loading ? (
        <div className="text-center text-text-secondary py-16">加载中...</div>
      ) : news.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📡</div>
          <p className="text-text-secondary mb-3">还没有资讯数据</p>
          <p className="text-xs text-text-secondary mb-4">
            点击「立即收集」开始抓取，或等待定时自动收集
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {news.map((item) => (
            <div
              key={item.id}
              className="bg-surface border border-border rounded-xl p-4 hover:shadow-sm transition-shadow flex gap-4"
            >
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt=""
                  className="w-28 h-16 object-cover rounded-lg shrink-0"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_COLORS[item.sourceType]}`}>
                    {SOURCE_LABELS[item.sourceType]}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-text-secondary">
                    {CATEGORY_LABELS[item.category]}
                  </span>
                  <span className="text-[10px] text-text-secondary">{item.source}</span>
                  {item.metrics?.views ? (
                    <span className="text-[10px] font-medium text-red-500">
                      🔥 {formatViews(item.metrics.views)} 播放
                    </span>
                  ) : null}
                  <span className="text-[10px] text-text-secondary ml-auto">{timeAgo(item.publishedAt)}</span>
                </div>
                <h3 className="font-medium text-text text-sm line-clamp-2 mb-1">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                    {item.translatedTitle || item.title}
                  </a>
                </h3>
                {item.translatedTitle && item.translatedTitle !== item.title && (
                  <p className="text-xs text-text-secondary line-clamp-1 mb-1 italic">
                    原文: {item.title}
                  </p>
                )}
                {item.summary && (
                  <p className="text-xs text-text-secondary line-clamp-2">{item.summary}</p>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleSaveAsTopic(item)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                      item.savedAsTopic
                        ? 'bg-green-50 text-green-600 border border-green-200'
                        : 'border border-primary/30 text-primary hover:bg-primary-light'
                    }`}
                  >
                    {item.savedAsTopic ? '已存为选题' : '存为选题'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
