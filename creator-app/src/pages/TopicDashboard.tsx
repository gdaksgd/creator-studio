import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { api } from '../api/client';
import type { Topic, GameCategory, TopicStatus, TopicEvaluation, PublishedRecord } from '../types';
import type { VideoStat } from '../api/client';
import { formatDeviation, formatDuration, formatViews, parseEstimatedViews } from '../utils/prediction';
import { CATEGORIES, DEFAULT_CATEGORY, categoryBadge, categoryEmoji, categoryLabel, getCategory } from '../config/categories';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  ArrowRight,
  Clapperboard,
  FileChartColumn,
  Layers,
  LoaderCircle,
  Play,
  Plus,
  Send,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Stat } from '../components/ui/Stat';
import { SectionHeading } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { SourceNote } from '../components/ui/SourceNote';
import { cn } from '../utils/cn';

const STATUS_LABELS: Record<TopicStatus, string> = {
  idea: '灵感',
  researching: '调研中',
  approved: '已通过',
  scripting: '写脚本',
  done: '已完成',
  published: '已发布',
};

/** 状态徽标语义色 → Badge variant（改造前是一串手写 bg-*-soft/text-* 类名） */
const STATUS_VARIANTS: Record<TopicStatus, 'neutral' | 'info' | 'success' | 'warning' | 'primary'> = {
  idea: 'neutral',
  researching: 'info',
  approved: 'success',
  scripting: 'warning',
  done: 'primary',
  published: 'success',
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
  // 列表增删/筛选时自动做位移动画（<5 KB，纯 DOM）
  const [listRef] = useAutoAnimate();
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

  // ── 首屏指标：全部由本地选题现算，不额外发请求 ──
  const publishedList = topics.filter((t) => t.published);
  const totalViews = publishedList.reduce((sum, t) => sum + (t.published?.views ?? 0), 0);
  const deviationPairs = publishedList.filter((t) => t.published && t.estimatedViews > 0);
  const avgDeviation = deviationPairs.length
    ? deviationPairs.reduce((sum, t) => {
        const actual = t.published?.views ?? 0;
        return sum + Math.abs(((actual - t.estimatedViews) / t.estimatedViews) * 100);
      }, 0) / deviationPairs.length
    : null;
  const WEEK_MS = 7 * 86400000;
  const nowMs = Date.now();
  const thisWeek = topics.filter((t) => nowMs - t.createdAt < WEEK_MS).length;
  const lastWeek = topics.filter(
    (t) => nowMs - t.createdAt >= WEEK_MS && nowMs - t.createdAt < 2 * WEEK_MS,
  ).length;
  const weekDelta = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : null;

  return (
    <div>
      {/* ── 首屏：品牌 Hero + 本地指标，第一眼就要有"产品感" ── */}
      <section className="anim-rise relative mb-7 overflow-hidden rounded-2xl border border-border bg-surface px-6 py-7 shadow-card sm:px-8">
        <div className="texture-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div
          className="glow-spot -left-16 -top-24 h-60 w-60"
          style={{ background: 'var(--glow-1)' }}
          aria-hidden="true"
        />
        <div
          className="glow-spot -right-20 top-2 h-52 w-52"
          style={{ background: 'var(--glow-2)' }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <Badge
              variant="outline"
              size="md"
              className="gap-2 rounded-full bg-surface/70 px-2.5 py-1 backdrop-blur"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              本地优先 · 数据不出本机
            </Badge>
            <h1 className="mt-4 text-[30px] font-semibold leading-[1.18] tracking-tight text-text sm:text-[34px]">
              从热点到成片，<span className="text-brand">一条流水线</span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">
              选题评分、脚本逐段写作、多平台体检、发布后预测偏差复盘——全流程离线可用，
              AI 只在你按下按钮时介入。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建选题
              </Button>
              <Button variant="secondary" onClick={() => navigate('/report')}>
                <FileChartColumn className="h-4 w-4" aria-hidden="true" />
                行业分析报告
              </Button>
            </div>
          </div>

          <div className="grid w-full shrink-0 grid-cols-2 gap-3 lg:w-[430px]">
            <Stat
              label="选题池"
              value={topics.length}
              unit="个"
              icon={Layers}
              hint={`本周新增 ${thisWeek}`}
              delta={weekDelta}
              deltaLabel="较上周"
            />
            <Stat
              label="已发布"
              value={publishedList.length}
              unit="条"
              icon={Send}
              tone="success"
              hint={
                topics.length
                  ? `完成率 ${Math.round((publishedList.length / topics.length) * 100)}%`
                  : '还没有选题'
              }
            />
            <Stat
              label="累计播放"
              value={formatViews(totalViews)}
              icon={Play}
              tone="info"
              hint={publishedList.length ? '含真实回填数据' : '发布后自动回填'}
            />
            <Stat
              label="平均预测偏差"
              value={avgDeviation === null ? '—' : `${avgDeviation.toFixed(0)}%`}
              icon={Target}
              tone="warning"
              hint={avgDeviation === null ? '需要真实播放量' : `${deviationPairs.length} 条样本`}
            />
          </div>
        </div>
      </section>

      <SectionHeading
        title="选题池"
        hint={`${filtered.length} / ${topics.length} 个`}
        action={
          <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            新选题
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
            filter === 'all'
              ? 'border-transparent bg-primary text-white shadow-xs'
              : 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text',
          )}
        >
          全部
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            aria-pressed={filter === c.id}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
              filter === c.id
                ? 'border-transparent bg-primary text-white shadow-xs'
                : 'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text',
            )}
          >
            {c.emoji} {c.short}
          </button>
        ))}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        size="md"
        title="添加新选题"
        description="记下想法就行；AI 评估、脚本和发布记录都能之后从这里继续。"
      >
        <form onSubmit={handleSubmit} className="w-full space-y-3">
          <Field label={getCategory(form.category).titleLabel} required>
            <Input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={getCategory(form.category).titlePlaceholder}
              autoFocus
            />
          </Field>

          <Field label={getCategory(form.category).descriptionLabel}>
            <Textarea
              value={form.gameDescription}
              onChange={(e) => setForm({ ...form, gameDescription: e.target.value })}
              rows={3}
              placeholder={getCategory(form.category).descriptionPlaceholder}
            />
          </Field>

          <Field label="备注" hint="选题原因、预期效果等">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="分类">
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as GameCategory })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="制作难度">
              <Select
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {DIFFICULTY_STARS[d]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="紧急程度">
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setForm({ ...form, urgency: u })}
                  aria-pressed={form.urgency === u}
                  className={cn(
                    'flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    form.urgency === u
                      ? u === 'high'
                        ? 'border-danger/30 bg-danger-soft text-danger'
                        : u === 'medium'
                          ? 'border-warning/30 bg-warning-soft text-warning'
                          : 'border-border bg-surface-muted text-text'
                      : 'border-border bg-surface text-text-secondary hover:text-text',
                  )}
                >
                  {URGENCY_LABELS[u]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="制作思路" hint="视频怎么做、切入角度、结构设想等">
            <Textarea
              value={form.productionIdea}
              onChange={(e) => setForm({ ...form, productionIdea: e.target.value })}
              rows={3}
              placeholder="比如：从新手视角体验，设定一个挑战规则，穿插专业背景解读..."
            />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary">
              添加选题
            </Button>
          </div>
        </form>
      </Modal>

      {loading ? (
        <LoadingBlock label="正在读取本地选题…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="h-5 w-5" />}
          title="还没有选题"
          description="点右上角「新建选题」记下第一个想法；有选题之后才能生成脚本和素材方案。"
        />
      ) : (
        <div ref={listRef} className="stagger-children grid gap-3">
          {filtered.map((topic) => (
            <div key={topic.id} className="card card-hover p-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" size="md" className={categoryBadge(topic.category)}>
                      {categoryEmoji(topic.category)} {categoryLabel(topic.category)}
                    </Badge>
                    <Badge variant={STATUS_VARIANTS[topic.status]} size="md">
                      {STATUS_LABELS[topic.status]}
                    </Badge>
                    {topic.urgency === 'high' && (
                      <Badge variant="danger" size="md">
                        紧急
                      </Badge>
                    )}
                  </div>
                  <h3 className="min-w-0 truncate font-medium text-text">{topic.title}</h3>
                  {topic.gameDescription && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                      <span className="font-medium">{getCategory(topic.category).descriptionLabel}：</span>
                      {topic.gameDescription}
                    </p>
                  )}
                  {topic.notes && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                      {topic.notes}
                    </p>
                  )}
                  {topic.productionIdea && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-relaxed text-primary">
                      <ArrowRight className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 line-clamp-2">
                        <span className="font-medium">制作思路：</span>
                        {topic.productionIdea}
                      </span>
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                    <Badge variant="outline" size="md">
                      难度 {DIFFICULTY_STARS[topic.difficulty]}
                    </Badge>
                    <span aria-hidden="true">·</span>
                    <span className="num">{new Date(topic.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  {topic.published && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                      <Badge variant="success" size="md">
                        实际播放 <span className="num">{formatViews(topic.published.views)}</span>
                      </Badge>
                      <span className="text-text-secondary">
                        {topic.estimatedViews > 0 ? (
                          <>
                            预测 <span className="num">{formatViews(topic.estimatedViews)}</span>
                            {' · 偏差 '}
                            <span className="num">
                              {formatDeviation(topic.estimatedViews, topic.published.views)}
                            </span>
                          </>
                        ) : (
                          '没有数字化的预测值，无法计算偏差'
                        )}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                  <Button
                    size="sm"
                    variant={
                      topic.evaluation && Date.now() - topic.evaluation.evaluatedAt < 86400000
                        ? 'soft'
                        : 'secondary'
                    }
                    onClick={() => handleEvaluate(topic)}
                    disabled={evaluating === topic.id}
                  >
                    {evaluating === topic.id
                      ? '评估中...'
                      : topic.evaluation && Date.now() - topic.evaluation.evaluatedAt < 86400000
                      ? `已评估 (${topic.evaluation.score}分)`
                      : 'AI评估'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleViewScripts(topic)}>
                    查看脚本
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => handleStartScript(topic)}>
                    开始写脚本
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => openPublish(topic)}>
                    {topic.published ? '更新数据' : '记录发布'}
                  </Button>
                  <Button
                    size="sm"
                    variant="dangerGhost"
                    onClick={() => {
                      if (confirm('确定删除这个选题吗？')) deleteTopic(topic.id);
                    }}
                    title="删除"
                  >
                    删除
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI 评估弹窗 */}
      <Modal
        open={!!(evaluation || evalError || evaluating)}
        onClose={closeEvaluation}
        size="md"
        title={evalError ? '评估失败' : 'AI 选题评估'}
        description={
          evaluation?.evaluatedAt
            ? `评估于 ${new Date(evaluation.evaluatedAt).toLocaleString('zh-CN')}`
            : undefined
        }
      >
        <div className="w-full">
          {evaluating && (
            <div className="flex flex-col items-center gap-2.5 py-10 text-center">
              <LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <p className="text-sm text-text-secondary">AI 正在分析选题可行性...</p>
            </div>
          )}

          {evalError && (
            <div>
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-danger">{evalError}</p>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button variant="primary" onClick={() => setEvalError('')}>
                  关闭
                </Button>
              </div>
            </div>
          )}

          {evaluation && (
            <div>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="综合评分"
                  value={evaluation.score}
                  tone="primary"
                  interactive={false}
                  hint="/100"
                />
                <Stat
                  label="话题热度"
                  value={evaluation.heatLevel}
                  tone="warning"
                  interactive={false}
                  hint="/10"
                />
              </div>

              <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface-muted/50 p-3.5 text-xs sm:grid-cols-2">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-text-muted">竞争程度</span>
                  <span className="num min-w-0 flex-1 font-medium text-text">
                    {evaluation.competitionLevel}/10
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-text-muted">制作难度</span>
                  <span className="min-w-0 flex-1 font-medium text-text">{evaluation.difficulty}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-text-muted">预估播放</span>
                  <span className="min-w-0 flex-1 font-medium text-text">{evaluation.estimatedViews}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-text-muted">推荐平台</span>
                  <span className="min-w-0 flex-1 font-medium text-text">{evaluation.bestPlatform}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-text-muted">最佳发布时间</span>
                  <span className="min-w-0 flex-1 font-medium text-text">{evaluation.bestTime}</span>
                </div>
              </div>

              {/* ★ 数据诚实原则：必须让用户分清这个数字是「有样本算出来的」还是「模型猜的」 */}
              {evaluation.basis &&
                (evaluation.basis.source === 'benchmark' ? (
                  <SourceNote
                    tier="C"
                    label="数据依据"
                    note={[
                      evaluation.basis.sampleSize != null ? `${evaluation.basis.sampleSize} 条` : '',
                      evaluation.basis.windowDays != null
                        ? `近 ${evaluation.basis.windowDays} 天`
                        : '榜单快照',
                      evaluation.basis.percentile != null
                        ? evaluation.basis.percentile <= 0
                          ? '该预估低于样本最低值'
                          : evaluation.basis.percentile >= 100
                            ? '该预估高于样本最高值'
                            : `该预估约处于 P${evaluation.basis.percentile} 水位`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    {evaluation.basis.label ?? '同品类'}真实样本
                  </SourceNote>
                ) : (
                  <div className="mt-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-warning">
                    暂无该品类的真实基准数据，本条预估为 AI 推断，未经数据校验
                  </div>
                ))}

              {evaluation.titleSuggestions.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-text-secondary">标题建议</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {evaluation.titleSuggestions.map((t, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-text"
                      >
                        <span className="num mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold text-text-secondary">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3">
                <p className="text-xs font-medium text-text-secondary">具体建议</p>
                <p className="mt-1.5 rounded-xl border border-border bg-surface-muted/50 p-3.5 text-xs leading-relaxed text-text-secondary">
                  {evaluation.suggestions}
                </p>
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium text-text-secondary">风险提示</p>
                <p className="mt-1.5 rounded-xl border border-danger/30 bg-danger-soft p-3.5 text-xs leading-relaxed text-danger">
                  {evaluation.risks}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" onClick={closeEvaluation}>
                  关闭
                </Button>
                {evalTopicId && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const topic = topics.find((t) => t.id === evalTopicId);
                      if (topic) handleEvaluate(topic, true);
                    }}
                    disabled={evaluating !== null}
                  >
                    {evaluating ? '评估中...' : '重新评估'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
      {/* 记录发布弹窗 */}
      <Modal
        open={!!(publishTopicId)}
        onClose={closePublish}
        size="md"
        title="记录发布结果"
        description="粘贴 B站视频链接，直接取回真实播放 / 点赞 / 投币数据。数据来自 B站接口，不做任何估算。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closePublish}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmPublish}
              disabled={!publishStat}
            >
              保存发布记录
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <Field label="B站视频链接" className="min-w-0 flex-1">
              <Input
                value={publishUrl}
                onChange={(e) => setPublishUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFetchStat();
                }}
                placeholder="https://www.bilibili.com/video/BV..."
              />
            </Field>
            <Button
              variant="primary"
              size="md"
              loading={publishing}
              disabled={!publishUrl.trim()}
              onClick={handleFetchStat}
            >
              取数
            </Button>
          </div>

          {publishError && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 leading-relaxed">{publishError}</span>
            </div>
          )}

          {publishStat && (
            <div className="space-y-3 rounded-xl border border-border bg-surface-muted/50 p-4">
              <div>
                <p className="break-all text-sm font-medium text-text">{publishStat.title}</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {publishStat.bvid} · 时长 {formatDuration(publishStat.duration)} · 发布于{' '}
                  {new Date(publishStat.publishedAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '播放', value: publishStat.views },
                  { label: '点赞', value: publishStat.likes },
                  { label: '投币', value: publishStat.coins },
                  { label: '收藏', value: publishStat.favorites },
                  { label: '分享', value: publishStat.shares },
                  { label: '评论', value: publishStat.comments },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-border bg-surface px-2 py-2 text-center"
                  >
                    <div className="num text-sm font-semibold text-text">
                      {formatViews(item.value)}
                    </div>
                    <div className="text-xs text-text-muted">{item.label}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-text-secondary">
                {publishPredicted === undefined
                  ? '该选题还没有数字化的预测播放量，本次只记录实际结果，不计算偏差。'
                  : `预测 ${formatViews(publishPredicted)} · 实际 ${formatViews(publishStat.views)} · 偏差 ${formatDeviation(publishPredicted, publishStat.views)}`}
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
