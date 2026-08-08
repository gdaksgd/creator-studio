import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { api } from '../api/client';
import type { Topic, GameCategory, TopicStatus, TopicEvaluation, IdeaEvaluation, TitleEvaluation } from '../types';

const CATEGORY_LABELS: Record<GameCategory, string> = {
  card: '卡牌游戏',
  horror: '恐怖游戏',
};

const CATEGORY_COLORS: Record<GameCategory, string> = {
  card: 'bg-amber-50 text-amber-800 border-amber-200',
  horror: 'bg-purple-50 text-purple-800 border-purple-200',
};

const STATUS_LABELS: Record<TopicStatus, string> = {
  idea: '灵感',
  researching: '调研中',
  approved: '已通过',
  scripting: '写脚本',
  done: '已完成',
};

const STATUS_COLORS: Record<TopicStatus, string> = {
  idea: 'bg-gray-100 text-gray-700',
  researching: 'bg-blue-50 text-blue-700',
  approved: 'bg-green-50 text-green-700',
  scripting: 'bg-amber-50 text-amber-700',
  done: 'bg-purple-50 text-purple-700',
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
    category: 'card' as GameCategory,
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
    setForm({ title: '', category: 'card', difficulty: 3, urgency: 'medium', notes: '', productionIdea: '', gameDescription: '' });
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
      // Persist evaluation to IndexedDB
      await updateTopic(topic.id, { evaluation: evalWithTime });
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

      <div className="flex items-center gap-2 mb-5">
        {(['all', 'card', 'horror'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary text-white'
                : 'bg-surface border border-border text-text-secondary hover:text-text'
            }`}
          >
            {f === 'all' ? '全部' : CATEGORY_LABELS[f]}
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
                {form.category === 'horror' ? '游戏标题' : '选题标题'}
              </span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder={form.category === 'horror' ? '比如：青鬼、寂静岭、生化危机...' : '比如：炉石新版本卡组评测...'}
                autoFocus
              />
            </label>

            {form.category === 'horror' ? (
              <label className="block mb-3">
                <span className="text-sm font-medium text-text">游戏简介（故事背景、玩法特色、恐怖元素等）</span>
                <textarea
                  value={form.gameDescription}
                  onChange={(e) => setForm({ ...form, gameDescription: e.target.value })}
                  rows={4}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="比如：日本经典恐怖解谜游戏，玩家在被困的废弃学校中寻找出口，途中需要躲避青鬼的追杀。以Jump Scare和心理恐怖著称..."
                />
              </label>
            ) : (
              <label className="block mb-3">
                <span className="text-sm font-medium text-text">备注（选题原因、预期效果等）</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="block">
                <span className="text-sm font-medium text-text">分类</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as GameCategory })}
                  className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="card">卡牌游戏</option>
                  <option value="horror">恐怖游戏</option>
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
                placeholder={form.category === 'horror'
                  ? '比如：从新手视角体验，设定不尖叫挑战，穿插心理学解读...'
                  : '比如：从新手视角出发，先展示卡组构筑思路，再逐步拆解对局关键回合...'}
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
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[topic.category]}`}>
                      {CATEGORY_LABELS[topic.category]}
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
                  {topic.category === 'horror' && topic.gameDescription ? (
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                      <span className="font-medium">游戏简介：</span>{topic.gameDescription}
                    </p>
                  ) : topic.notes ? (
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{topic.notes}</p>
                  ) : null}
                  {topic.productionIdea && (
                    <p className="text-xs text-blue-600/70 mt-1 line-clamp-2">
                      <span className="font-medium">制作思路：</span>{topic.productionIdea}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-secondary">
                    <span>难度 {DIFFICULTY_STARS[topic.difficulty]}</span>
                    <span>{new Date(topic.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
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
    </div>
  );
}
