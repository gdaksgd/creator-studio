import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { api } from '../api/client';
import type { Topic, GameCategory, TopicStatus, TopicEvaluation, PublishedRecord } from '../types';
import type { VideoStat } from '../api/client';
import { formatDeviation, formatDuration, formatViews, parseEstimatedViews } from '../utils/prediction';
import { CATEGORIES, DEFAULT_CATEGORY, categoryBadge, categoryEmoji, categoryLabel, getCategory } from '../config/categories';

const STATUS_LABELS: Record<TopicStatus, string> = {
  idea: '灵感',
  researching: '调研中',
  approved: '已通过',
  scripting: '写脚本',
  done: '已完成',
  published: '已发布',
};

const STATUS_COLORS: Record<TopicStatus, string> = {
  idea: 'bg-gray-100 text-gray-700',
  researching: 'bg-blue-50 text-blue-700',
  approved: 'bg-green-50 text-green-700',
  scripting: 'bg-amber-50 text-amber-700',
  done: 'bg-purple-50 text-purple-700',
  published: 'bg-emerald-50 text-emerald-700',
};

const URGENCY_LABELS: Record<string, string> = {
  low: '不急',
  medium: '适中',
  high: '紧急',
};

const DIFFICULTY_STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];

export default function TopicDashboard() {
  const { topics, loading, loadTopics, addTopic, updateTopic, deleteTopic } = useTopicStore();
  const { createScript } = useScriptStore();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | GameCategory>('all');
  const [form, setForm] = useState({
    title: '',
    category: DEFAULT_CATEGORY,
    difficulty: 3,
    urgency: 'medium' as 'low' | 'medium' | 'high',
    notes: '',
    productionIdea: '',
    gameDescription: '',
  });
  const [evaluating, setEvaluating] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<TopicEvaluation | null>(null);
  const [evalTopicId, setEvalTopicId] = useState<string | null>(null);
  const [evalError, setEvalError] = useState('');
  // 「记录发布」弹窗状态
  const [publishTopicId, setPublishTopicId] = useState<string | null>(null);
  const [publishUrl, setPublishUrl] = useState('');
  const [publishStat, setPublishStat] = useState<VideoStat | null>(null);
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const filtered = filter === 'all' ? topics : topics.filter((t) => t.category === filter);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await addTopic({
      title: form.title,
      category: form.category,
      status: 'idea',
      difficulty: form.difficulty as Topic['difficulty'],
      estimatedViews: 0,
      urgency: form.urgency,
      notes: form.notes,
      productionIdea: form.productionIdea,
      gameDescription: form.gameDescription,
    });
    setForm({ title: '', category: DEFAULT_CATEGORY, difficulty: 3, urgency: 'medium', notes: '', productionIdea: '', gameDescription: '' });
    setShowForm(false);
  };

  const handleStartScript = async (topic: Topic) => {
    await updateTopic(topic.id, { status: 'scripting' });
    const script = await createScript(topic.id, 'bilibili', 'long');
    navigate(`/scripts/${script.id}`);
  };

  const handleViewScripts = (topic: Topic) => {
    navigate(`/scripts?topic=${topic.id}`);
  };

  const handleEvaluate = async (topic: Topic, forceRefresh = false) => {
    // Check if evaluation is cached (within 24h) unless force refresh
    if (!forceRefresh && topic.evaluation && (Date.now() - topic.evaluation.evaluatedAt < 86400000)) {
      setEvalTopicId(topic.id);
      setEvaluation(topic.evaluation);
      return;
    }

    setEvaluating(topic.id);
    setEvalTopicId(topic.id);
    setEvalError('');
    setEvaluation(null);
    try {
      const result = await api.evaluateTopic({
        topicTitle: topic.title,
        category: topic.category,
        notes: topic.notes,
        gameDescription: topic.gameDescription,
      });
      const evalWithTime: TopicEvaluation = { ...result, evaluatedAt: Date.now() };
      setEvaluation(evalWithTime);
      // Persist evaluation to IndexedDB。
      // ★ 同时把 AI 给出的「预估播放量」文本解析成数字存进 estimatedViews，
      //   这样日后才能拿它和真实播放量做对比。解析不出来就保持原值，绝不写 0。
      const parsedPrediction = parseEstimatedViews(result.estimatedViews);
      await updateTopic(topic.id, {
        evaluation: evalWithTime,
        ...(parsedPrediction !== null ? { estimatedViews: parsedPrediction } : {}),
      });
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvaluating(null);
    }
  };

  const closeEvaluation = () => {
    setEvaluation(null);
    setEvalTopicId(null);
    setEvalError('');
  };

  // ─── 记录发布 ───────────────────────────────────────────
  // 设计取向：不猜、不匹配、不估算。用户贴链接，后端向 B站 view 接口取精确数据。
  // 取不到就明确报错，绝不用 0 或占位数字糊过去。
  const openPublish = (topic: Topic) => {
    setPublishTopicId(topic.id);
    setPublishUrl(topic.published?.url || topic.published?.bvid || '');
    setPublishStat(null);
    setPublishError('');
  };

  const closePublish = () => {
    setPublishTopicId(null);
    setPublishUrl('');
    setPublishStat(null);
    setPublishError('');
  };

  const handleFetchStat = async () => {
    const input = publishUrl.trim();
    if (!input) return;
    setPublishing(true);
    setPublishError('');
    setPublishStat(null);
    try {
      const resp = await api.getVideoStat(input);
      if (resp.ok && resp.stat) {
        setPublishStat(resp.stat);
      } else {
        setPublishError(resp.error || '取数失败');
      }
    } catch (err) {
      setPublishError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const handleConfirmPublish = async () => {
    if (!publishTopicId || !publishStat) return;
    const record: PublishedRecord = {
      platform: 'bilibili',
      bvid: publishStat.bvid,
      url: publishStat.url,
      title: publishStat.title,
      publishedAt: publishStat.publishedAt,
      duration: publishStat.duration,
      views: publishStat.views,
      likes: publishStat.likes,
      coins: publishStat.coins,
      favorites: publishStat.favorites,
      shares: publishStat.shares,
      comments: publishStat.comments,
      danmaku: publishStat.danmaku,
      fetchedAt: publishStat.fetchedAt,
      source: 'auto',
    };
    await updateTopic(publishTopicId, { published: record, status: 'published' });
    closePublish();
  };

  const publishTarget = topics.find((t) => t.id === publishTopicId);
  const publishPredicted =
    publishTarget && publishTarget.estimatedViews > 0 ? publishTarget.estimatedViews : undefined;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">选题看板</h1>
          <p className="text-text-secondary text-sm mt-1">
            管理你的视频选题，从灵感到发布
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
        >
          + 新选题
        </button>
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'bg-primary text-white'
              : 'bg-surface border border-border text-text-secondary hover:text-text'
          }`}
        >
          全部
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === c.id
                ? 'bg-primary text-white'
                : 'bg-surface border border-border text-text-secondary hover:text-text'
            }`}
          >
            {c.emoji} {c.short}
          </button>
        ))}
        <span className="text-xs text-text-secondary ml-auto">{filtered.length} 个选题</span>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 z-20 flex items-center justify-center" onClick={() => setShowForm(false)}>
          <form
            onSubmit={handleSubmit}
            className="bg-surface rounded-xl p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">添加新选题</h2>

            <label className="block mb-3">
              <span className="text-sm font-medium text-text">
                {getCategory(form.category).titleLabel}
              </span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={getCategory(form.category).titlePlaceholder}
                autoFocus
              />
            </label>

            <label className="block mb-3">
              <span className="text-sm font-medium text-text">{getCategory(form.category).descriptionLabel}</span>
              <textarea
                value={form.gameDescription}
                onChange={(e) => setForm({ ...form, gameDescription: e.target.value })}
                rows={3}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder={getCategory(form.category).descriptionPlaceholder}
              />
            </label>

            <label className="block mb-3">
              <span className="text-sm font-medium text-text">备注（选题原因、预期效果等）</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="block">
                <span className="text-sm font-medium text-text">分类</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as GameCategory })}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-text">制作难度</span>
                <select
                  value={form.difficulty}
                  onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {[1, 2, 3, 4, 5].map((d) => (
                    <option key={d} value={d}>{DIFFICULTY_STARS[d]}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block mb-3">
              <span className="text-sm font-medium text-text">紧急程度</span>
              <div className="flex gap-2 mt-1">
                {(['low', 'medium', 'high'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setForm({ ...form, urgency: u })}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      form.urgency === u
                        ? u === 'high'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : u === 'medium'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-100 text-gray-700 border-gray-200'
                        : 'border-border text-text-secondary'
                    }`}
                  >
                    {URGENCY_LABELS[u]}
                  </button>
                ))}
              </div>
            </label>

            <label className="block mb-4">
              <span className="text-sm font-medium text-text">制作思路（视频怎么做、切入角度、结构设想等）</span>
              <textarea
                value={form.productionIdea}
                onChange={(e) => setForm({ ...form, productionIdea: e.target.value })}
                rows={3}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="比如：从新手视角体验，设定一个挑战规则，穿插专业背景解读..."
              />
            </label>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
              >
                添加选题
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center text-text-secondary py-16">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🎬</div>
          <p className="text-text-secondary">还没有选题，点击右上角开始</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((topic) => (
            <div
              key={topic.id}
              className="bg-surface border border-border rounded-xl p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${categoryBadge(topic.category)}`}>
                      {categoryEmoji(topic.category)} {categoryLabel(topic.category)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[topic.status]}`}>
                      {STATUS_LABELS[topic.status]}
                    </span>
                    {topic.urgency === 'high' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                        紧急
                      </span>
                    )}
                  </div>
                  <h3 className="font-medium text-text truncate">{topic.title}</h3>
                  {topic.gameDescription && (
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                      <span className="font-medium">{getCategory(topic.category).descriptionLabel}：</span>{topic.gameDescription}
                    </p>
                  )}
                  {topic.notes && (
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{topic.notes}</p>
                  )}
                  {topic.productionIdea && (
                    <p className="text-xs text-blue-600/70 mt-1 line-clamp-2">
                      <span className="font-medium">制作思路：</span>{topic.productionIdea}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                    <span>难度 {DIFFICULTY_STARS[topic.difficulty]}</span>
                    <span>{new Date(topic.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  {topic.published && (
                    <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                        实际播放 {formatViews(topic.published.views)}
                      </span>
                      <span className="text-text-secondary">
                        {topic.estimatedViews > 0
                          ? `预测 ${formatViews(topic.estimatedViews)} · 偏差 ${formatDeviation(topic.estimatedViews, topic.published.views)}`
                          : '没有数字化的预测值，无法计算偏差'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleEvaluate(topic)}
                    disabled={evaluating === topic.id}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                      topic.evaluation && (Date.now() - topic.evaluation.evaluatedAt < 86400000)
                        ? 'text-green-700 bg-green-50 border border-green-200 hover:bg-green-100'
                        : 'text-purple-600 border border-purple-200 hover:bg-purple-50'
                    }`}
                  >
                    {evaluating === topic.id
                      ? '评估中...'
                      : topic.evaluation && (Date.now() - topic.evaluation.evaluatedAt < 86400000)
                      ? `已评估 (${topic.evaluation.score}分)`
                      : 'AI评估'}
                  </button>
                  <button
                    onClick={() => handleViewScripts(topic)}
                    className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary-light transition-colors"
                  >
                    查看脚本
                  </button>
                  <button
                    onClick={() => handleStartScript(topic)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
                  >
                    开始写脚本
                  </button>
                  <button
                    onClick={() => openPublish(topic)}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    {topic.published ? '更新数据' : '记录发布'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('确定删除这个选题吗？')) deleteTopic(topic.id);
                    }}
                    className="px-2 py-1.5 text-xs text-text-secondary hover:text-danger transition-colors"
                    title="删除"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI 评估弹窗 */}
      {(evaluation || evalError || evaluating) && (
        <div className="fixed inset-0 bg-black/30 z-20 flex items-center justify-center p-4" onClick={closeEvaluation}>
          <div className="bg-surface rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            {evaluating && (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-text-secondary">AI 正在分析选题可行性...</p>
              </div>
            )}

            {evalError && (
              <div>
                <h2 className="text-lg font-bold mb-2 text-red-600">评估失败</h2>
                <p className="text-sm text-text-secondary">{evalError}</p>
                <button onClick={() => setEvalError('')} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm">关闭</button>
              </div>
            )}

            {evaluation && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">
                    AI 选题评估
                    {evaluation.evaluatedAt && (
                      <span className="text-xs font-normal text-text-secondary ml-2">
                        (评估于 {new Date(evaluation.evaluatedAt).toLocaleString('zh-CN')})
                      </span>
                    )}
                  </h2>
                  <button onClick={closeEvaluation} className="text-text-secondary hover:text-text text-sm">关闭</button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <div className="text-3xl font-bold text-purple-700">{evaluation.score}</div>
                    <div className="text-xs text-purple-600 mt-1">综合评分 /100</div>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3 text-center">
                    <div className="text-3xl font-bold text-amber-700">{evaluation.heatLevel}/10</div>
                    <div className="text-xs text-amber-600 mt-1">话题热度</div>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium text-text">竞争程度: </span>
                    <span className="text-text-secondary">{evaluation.competitionLevel}/10</span>
                  </div>
                  <div>
                    <span className="font-medium text-text">制作难度: </span>
                    <span className="text-text-secondary">{evaluation.difficulty}</span>
                  </div>
                  <div>
                    <span className="font-medium text-text">预估播放: </span>
                    <span className="text-text-secondary">{evaluation.estimatedViews}</span>
                  </div>

                  {/* ★ 数据诚实原则：必须让用户分清这个数字是「有样本算出来的」还是「模型猜的」 */}
                  {evaluation.basis &&
                    (evaluation.basis.source === 'benchmark' ? (
                      <div className="text-xs rounded-lg px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800">
                        数据依据：{evaluation.basis.label ?? '同品类'}真实样本
                        {evaluation.basis.sampleSize != null && `（${evaluation.basis.sampleSize} 条`}
                        {evaluation.basis.windowDays != null
                          ? `，近 ${evaluation.basis.windowDays} 天）`
                          : '，榜单快照）'}
                        {evaluation.basis.percentile != null &&
                          (evaluation.basis.percentile <= 0
                            ? '· 该预估低于样本最低值'
                            : evaluation.basis.percentile >= 100
                              ? '· 该预估高于样本最高值'
                              : `· 该预估约处于 P${evaluation.basis.percentile} 水位`)}
                      </div>
                    ) : (
                      <div className="text-xs rounded-lg px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800">
                        暂无该品类的真实基准数据，本条预估为 AI 推断，未经数据校验
                      </div>
                    ))}
                  <div>
                    <span className="font-medium text-text">推荐平台: </span>
                    <span className="text-text-secondary">{evaluation.bestPlatform}</span>
                  </div>
                  <div>
                    <span className="font-medium text-text">最佳发布时间: </span>
                    <span className="text-text-secondary">{evaluation.bestTime}</span>
                  </div>

                  {evaluation.titleSuggestions.length > 0 && (
                    <div>
                      <span className="font-medium text-text">标题建议:</span>
                      <ul className="mt-1 space-y-1">
                        {evaluation.titleSuggestions.map((t, i) => (
                          <li key={i} className="text-text-secondary bg-gray-50 px-3 py-1.5 rounded-lg">{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <span className="font-medium text-text">具体建议:</span>
                    <p className="text-text-secondary mt-1 bg-gray-50 p-3 rounded-lg">{evaluation.suggestions}</p>
                  </div>

                  <div>
                    <span className="font-medium text-text">风险提示:</span>
                    <p className="text-text-secondary mt-1 bg-red-50 p-3 rounded-lg text-red-700">{evaluation.risks}</p>
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-5">
                  <button onClick={closeEvaluation} className="px-4 py-2 text-sm text-text-secondary">关闭</button>
                  {evalTopicId && (
                    <button
                      onClick={() => {
                        const topic = topics.find((t) => t.id === evalTopicId);
                        if (topic) handleEvaluate(topic, true);
                      }}
                      disabled={evaluating !== null}
                      className="px-4 py-2 text-sm font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50"
                    >
                      {evaluating ? '评估中...' : '重新评估'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* 记录发布弹窗 */}
      {publishTopicId && (
        <div className="fixed inset-0 bg-black/30 z-20 flex items-center justify-center p-4" onClick={closePublish}>
          <div
            className="bg-surface rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-bold">记录发布结果</h2>
              <button onClick={closePublish} className="text-text-secondary hover:text-text text-sm">关闭</button>
            </div>
            <p className="text-xs text-text-secondary mb-4">
              粘贴 B站视频链接，直接取回真实播放 / 点赞 / 投币数据。数据来自 B站接口，不做任何估算。
            </p>

            <div className="flex gap-2">
              <input
                value={publishUrl}
                onChange={(e) => setPublishUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFetchStat();
                }}
                placeholder="https://www.bilibili.com/video/BV..."
                className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:border-primary"
              />
              <button
                onClick={handleFetchStat}
                disabled={publishing || !publishUrl.trim()}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {publishing ? '取数中...' : '取数'}
              </button>
            </div>

            {publishError && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">{publishError}</p>
            )}

            {publishStat && (
              <div className="mt-4 border border-border rounded-lg p-4">
                <p className="text-sm font-medium mb-1 break-all">{publishStat.title}</p>
                <p className="text-xs text-text-secondary mb-3">
                  {publishStat.bvid} · 时长 {formatDuration(publishStat.duration)} · 发布于{' '}
                  {new Date(publishStat.publishedAt).toLocaleDateString('zh-CN')}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: '播放', value: publishStat.views },
                    { label: '点赞', value: publishStat.likes },
                    { label: '投币', value: publishStat.coins },
                    { label: '收藏', value: publishStat.favorites },
                    { label: '分享', value: publishStat.shares },
                    { label: '评论', value: publishStat.comments },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-50 rounded-lg py-2">
                      <div className="text-sm font-semibold">{formatViews(item.value)}</div>
                      <div className="text-xs text-text-secondary">{item.label}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-secondary mt-3">
                  {publishPredicted === undefined
                    ? '该选题还没有数字化的预测播放量，本次只记录实际结果，不计算偏差。'
                    : `预测 ${formatViews(publishPredicted)} · 实际 ${formatViews(publishStat.views)} · 偏差 ${formatDeviation(publishPredicted, publishStat.views)}`}
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button onClick={closePublish} className="px-4 py-2 text-sm text-text-secondary">取消</button>
              <button
                onClick={handleConfirmPublish}
                disabled={!publishStat}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg disabled:opacity-50"
              >
                保存发布记录
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
