import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { api } from '../api/client';
import type { Topic, GameCategory, TopicStatus, TopicEvaluation, PublishedRecord, RetrospectiveTag } from '../types';
import type { VideoStat } from '../api/client';
import { formatDeviation, formatDuration, formatViews, parseEstimatedViews } from '../utils/prediction';
import { CATEGORIES, DEFAULT_CATEGORY, categoryBadge, categoryLabel, getCategory } from '../config/categories';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import {
  Clapperboard,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  FileChartColumn,
  Layers,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Send,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { SectionHeading } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';
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

const URGENCY_LABELS: Record<string, string> = {
  low: '不急',
  medium: '适中',
  high: '紧急',
};

const DIFFICULTY_STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];
const TOPIC_STAGES: TopicStatus[] = ['idea', 'researching', 'approved', 'scripting', 'done', 'published'];
const RETROSPECTIVE_TAGS: RetrospectiveTag[] = ['topic', 'title', 'cover', 'hook', 'pacing', 'duration', 'timing', 'distribution', 'production', 'other'];
const RETROSPECTIVE_LABELS: Record<RetrospectiveTag, string> = {
  topic: '选题方向', title: '标题包装', cover: '封面点击', hook: '开场钩子', pacing: '内容节奏',
  duration: '视频时长', timing: '发布时间', distribution: '流量分发', production: '制作质量', other: '其他',
};
const tagLabel = (tag: RetrospectiveTag) => RETROSPECTIVE_LABELS[tag];
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateInputValue = (timestamp?: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function TopicDashboard() {
  const { topics, loading, loadTopics, addTopic, updateTopic, deleteTopic } = useTopicStore();
  const { createScript } = useScriptStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const publishDeepLinkRef = useRef<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | GameCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TopicStatus>('all');
  const [calendarView, setCalendarView] = useState<'board' | 'schedule'>('board');
  const [schedulePresentation, setSchedulePresentation] = useState<'list' | 'month'>('list');
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => dateKey(new Date()));
  const [selectedCalendarTopicId, setSelectedCalendarTopicId] = useState('');
  const [scheduleWindow, setScheduleWindow] = useState<'all' | 'week' | 'overdue'>('all');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({
    title: '',
    category: DEFAULT_CATEGORY,
    difficulty: 3,
    urgency: 'medium' as 'low' | 'medium' | 'high',
    notes: '',
    productionIdea: '',
    gameDescription: '',
    plannedPublishAt: '',
    productionDueAt: '',
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
  const [manualPredictionInput, setManualPredictionInput] = useState('');
  const [savingPrediction, setSavingPrediction] = useState(false);
  const [retrospectiveTags, setRetrospectiveTags] = useState<RetrospectiveTag[]>([]);
  const [retrospectiveNote, setRetrospectiveNote] = useState('');
  const [refreshingPublished, setRefreshingPublished] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  const [refreshFailures, setRefreshFailures] = useState<Array<{ title: string; reason: string }>>([]);
  const [visibleCount, setVisibleCount] = useState(24);
  const [deleteTarget, setDeleteTarget] = useState<Topic | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [draggingTopicId, setDraggingTopicId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const filtered = useMemo(
    () => {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      return topics.filter((topic) => {
        const matchesCategory = filter === 'all' || topic.category === filter;
        const haystack = `${topic.title} ${topic.notes} ${topic.gameDescription} ${topic.productionIdea}`.toLocaleLowerCase();
        return matchesCategory && (!normalizedQuery || haystack.includes(normalizedQuery));
      });
    },
    [filter, query, topics],
  );
  const stageTopics = useMemo(
    () => TOPIC_STAGES.map((status) => ({ status, topics: filtered.filter((topic) => topic.status === status) })),
    [filtered],
  );
  const scheduledTopics = useMemo(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endWeek = startToday + 7 * 86400000;
    return filtered
      .filter((topic) => topic.status !== 'published' && (topic.plannedPublishAt || topic.productionDueAt))
      .filter((topic) => {
        const dates = [topic.productionDueAt, topic.plannedPublishAt].filter((value): value is number => typeof value === 'number');
        if (scheduleWindow === 'week') return dates.some((due) => due >= startToday && due < endWeek);
        if (scheduleWindow === 'overdue') return dates.some((due) => due < startToday);
        return true;
      })
      .sort((a, b) => Math.min(a.productionDueAt ?? Infinity, a.plannedPublishAt ?? Infinity) - Math.min(b.productionDueAt ?? Infinity, b.plannedPublishAt ?? Infinity));
  }, [filtered, scheduleWindow]);
  const upcomingSchedule = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const end = start + 3 * 86400000;
    return topics.flatMap((topic) => {
      if (topic.status === 'published') return [];
      return [
        ...(topic.productionDueAt && topic.productionDueAt < end ? [{ topic, kind: '制作截止' as const, date: topic.productionDueAt }] : []),
        ...(topic.plannedPublishAt && topic.plannedPublishAt < end ? [{ topic, kind: '计划发布' as const, date: topic.plannedPublishAt }] : []),
      ];
    }).sort((a, b) => a.date - b.date);
  }, [topics]);
  const monthCells = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(date);
      const entries = topics.flatMap((topic) => [
        ...(topic.productionDueAt && dateKey(new Date(topic.productionDueAt)) === key ? [{ topic, kind: 'due' as const }] : []),
        ...(topic.plannedPublishAt && dateKey(new Date(topic.plannedPublishAt)) === key ? [{ topic, kind: 'publish' as const }] : []),
      ]);
      return { date, key, inMonth: date.getMonth() === calendarMonth.getMonth(), entries };
    });
  }, [calendarMonth, topics]);
  const selectedDayTopics = useMemo(() => {
    const target = selectedCalendarDate;
    return topics.flatMap((topic) => [
      ...(topic.productionDueAt && dateKey(new Date(topic.productionDueAt)) === target ? [{ topic, kind: '制作截止' }] : []),
      ...(topic.plannedPublishAt && dateKey(new Date(topic.plannedPublishAt)) === target ? [{ topic, kind: '计划发布' }] : []),
    ]);
  }, [topics, selectedCalendarDate]);
  const selectedCalendarTopic = topics.find((topic) => topic.id === selectedCalendarTopicId);

  useEffect(() => {
    setVisibleCount(24);
  }, [filter, query]);

  const moveTopicToStage = (topic: Topic, nextStatus: TopicStatus) => {
    if (topic.status === nextStatus) return;
    updateTopic(topic.id, { status: nextStatus });
  };

  const handleTopicDrop = (event: React.DragEvent<HTMLElement>, status: TopicStatus) => {
    event.preventDefault();
    const topicId = event.dataTransfer.getData('text/topic-id') || draggingTopicId;
    const topic = topics.find((item) => item.id === topicId);
    if (topic) moveTopicToStage(topic, status);
    setDraggingTopicId(null);
  };

  const focusStage = (status: TopicStatus | 'all') => {
    setStatusFilter(status);
    if (status !== 'all') {
      document.getElementById(`topic-stage-${status}`)?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    } else {
      boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTopic(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const resetTopicForm = () => {
    setForm({ title: '', category: DEFAULT_CATEGORY, difficulty: 3, urgency: 'medium', notes: '', productionIdea: '', gameDescription: '', plannedPublishAt: '', productionDueAt: '' });
    setShowForm(false);
  };

  const openTopicForm = () => {
    setForm({ title: '', category: DEFAULT_CATEGORY, difficulty: 3, urgency: 'medium', notes: '', productionIdea: '', gameDescription: '', plannedPublishAt: '', productionDueAt: '' });
    setShowForm(true);
  };

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
      plannedPublishAt: form.plannedPublishAt ? new Date(`${form.plannedPublishAt}T12:00:00`).getTime() : undefined,
      productionDueAt: form.productionDueAt ? new Date(`${form.productionDueAt}T12:00:00`).getTime() : undefined,
    });
    setForm({ title: '', category: DEFAULT_CATEGORY, difficulty: 3, urgency: 'medium', notes: '', productionIdea: '', gameDescription: '', plannedPublishAt: '', productionDueAt: '' });
    setShowForm(false);
  };

  const handleStartScript = async (topic: Topic) => {
    const existing = useScriptStore.getState().scripts.find(
      (script) => script.topicId === topic.id && script.platform === 'bilibili' && script.version === 'long',
    );
    if (existing) {
      if (topic.status !== 'scripting') updateTopic(topic.id, { status: 'scripting' });
      navigate(`/scripts/${existing.id}`);
      return;
    }
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
        ...(parsedPrediction !== null && topic.prediction?.source !== 'manual' ? {
          estimatedViews: parsedPrediction,
          prediction: { value: parsedPrediction, source: 'ai' as const, updatedAt: Date.now() },
        } : {}),
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
    const predictionValue = topic.prediction?.value ?? topic.estimatedViews;
    setManualPredictionInput(topic.prediction?.source === 'manual' && predictionValue > 0 ? String(predictionValue) : '');
    setRetrospectiveTags(topic.retrospective?.tags ?? []);
    setRetrospectiveNote(topic.retrospective?.note ?? '');
  };

  const closePublish = () => {
    setPublishTopicId(null);
    setPublishUrl('');
    setPublishStat(null);
    setPublishError('');
    setManualPredictionInput('');
    setRetrospectiveTags([]);
    setRetrospectiveNote('');
  };

  // 成片任务详情 → 「去记录发布」深链：topics 就绪后打开对应选题的发布弹窗。
  // ref 防止 StrictMode 双执行重复打开；打开后清除 query，刷新不再弹窗。
  useEffect(() => {
    const topicId = searchParams.get('publish');
    if (!topicId || publishDeepLinkRef.current === topicId) return;
    const topic = topics.find((item) => item.id === topicId);
    if (!topic) return;
    publishDeepLinkRef.current = topicId;
    openPublish(topic);
    const next = new URLSearchParams(searchParams);
    next.delete('publish');
    setSearchParams(next, { replace: true });
    // openPublish 只读取传入的 topic，不需要进依赖；ref 已处理重复执行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, topics, setSearchParams]);

  const handleSaveManualPrediction = async () => {
    if (!publishTopicId) return;
    const value = Number(manualPredictionInput.replace(/[,_\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setPublishError('请输入大于 0 的预测播放量');
      return;
    }
    setSavingPrediction(true);
    try {
      await updateTopic(publishTopicId, {
        estimatedViews: Math.round(value),
        prediction: { value: Math.round(value), source: 'manual', updatedAt: Date.now() },
      });
      toast.success('人工预测值已保存');
      setPublishError('');
    } finally {
      setSavingPrediction(false);
    }
  };

  const toggleRetrospectiveTag = (tag: RetrospectiveTag) => {
    setRetrospectiveTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const handleSaveRetrospective = async () => {
    if (!publishTopicId) return;
    await updateTopic(publishTopicId, { retrospective: { tags: retrospectiveTags, note: retrospectiveNote.trim(), updatedAt: Date.now() } });
    toast.success('发布复盘已保存');
  };

  const handleUpdateTopicSchedule = async (topic: Topic, field: 'productionDueAt' | 'plannedPublishAt', value: string) => {
    await updateTopic(topic.id, { [field]: value ? new Date(`${value}T12:00:00`).getTime() : undefined });
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
    const manualPredictionValue = Number(manualPredictionInput.replace(/[,_\s]/g, ''));
    if (manualPredictionInput.trim() && (!Number.isFinite(manualPredictionValue) || manualPredictionValue <= 0)) {
      setPublishError('人工目标必须是大于 0 的有效数字，或清空该输入后继续');
      return;
    }
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
    await updateTopic(publishTopicId, {
      published: { ...record, snapshots: [{ fetchedAt: record.fetchedAt, views: record.views, likes: record.likes, coins: record.coins, favorites: record.favorites, shares: record.shares, comments: record.comments, danmaku: record.danmaku }] },
      status: 'published',
      ...(manualPredictionInput.trim() ? { estimatedViews: Math.round(manualPredictionValue), prediction: { value: Math.round(manualPredictionValue), source: 'manual' as const, updatedAt: Date.now() } } : {}),
      ...(retrospectiveTags.length || retrospectiveNote.trim() ? { retrospective: { tags: retrospectiveTags, note: retrospectiveNote.trim(), updatedAt: Date.now() } } : {}),
    });
    closePublish();
  };

  const refreshPublishedStats = async () => {
    const targets = useTopicStore.getState().topics.filter(
      (topic) => topic.published?.platform === 'bilibili' && (topic.published.url || topic.published.bvid),
    );
    if (!targets.length) return;
    setRefreshingPublished(true);
    setRefreshProgress({ done: 0, total: targets.length });
    setRefreshFailures([]);
    let refreshed = 0;
    const failed: Array<{ title: string; reason: string }> = [];
    try {
      // /api/video/stats currently caps each request at 20 URLs. Respect the
      // server's serial upstream pacing, but split large local collections safely.
      const batches: Topic[][] = [];
      for (let offset = 0; offset < targets.length; offset += 20) batches.push(targets.slice(offset, offset + 20));
      for (const batch of batches) {
        const response = await api.getVideoStats(batch.map((topic) => topic.published!.url || topic.published!.bvid!));
        for (let index = 0; index < batch.length; index += 1) {
          const topic = batch[index]!;
          const result = response.results[index];
          const previous = topic.published!;
          if (!result?.ok || !result.stat) {
            failed.push({ title: topic.title, reason: result?.error || '取数失败' });
            continue;
          }
          const stat = result.stat;
          const previousBvid = previous.bvid || previous.url?.match(/BV[0-9A-Za-z]+/i)?.[0];
          if (previousBvid && previousBvid.toLowerCase() !== stat.bvid.toLowerCase()) {
            failed.push({ title: topic.title, reason: `链接返回了不同视频（${stat.bvid}），为防止误写已跳过` });
            continue;
          }
          const snapshots = [...(previous.snapshots ?? [])];
          const lastSnapshot = snapshots[snapshots.length - 1];
          if (previous.fetchedAt && lastSnapshot?.fetchedAt !== previous.fetchedAt) snapshots.push({
            fetchedAt: previous.fetchedAt,
            views: previous.views,
            likes: previous.likes,
            coins: previous.coins,
            favorites: previous.favorites,
            shares: previous.shares,
            comments: previous.comments,
            danmaku: previous.danmaku,
          });
          // Keep a bounded refresh trail while preserving the previous current
          // record on any failed upstream lookup.
          const uniqueSnapshots = new Map<number, NonNullable<PublishedRecord['snapshots']>[number]>();
          for (const snapshot of snapshots) uniqueSnapshots.set(snapshot.fetchedAt, snapshot);
          const existingAt = [...uniqueSnapshots.keys()].find((fetchedAt) => Math.abs(fetchedAt - stat.fetchedAt) < 60_000);
          uniqueSnapshots.set(existingAt ?? stat.fetchedAt, {
            fetchedAt: stat.fetchedAt,
            views: stat.views,
            likes: stat.likes,
            coins: stat.coins,
            favorites: stat.favorites,
            shares: stat.shares,
            comments: stat.comments,
            danmaku: stat.danmaku,
          });
          updateTopic(topic.id, { published: {
            ...previous,
            bvid: stat.bvid,
            url: stat.url,
            title: stat.title,
            publishedAt: stat.publishedAt,
            duration: stat.duration,
            views: stat.views,
            likes: stat.likes,
            coins: stat.coins,
            favorites: stat.favorites,
            shares: stat.shares,
            comments: stat.comments,
            danmaku: stat.danmaku,
            fetchedAt: stat.fetchedAt,
            source: 'auto',
            snapshots: [...uniqueSnapshots.values()].sort((a, b) => a.fetchedAt - b.fetchedAt).slice(-30),
          } });
          refreshed += 1;
        }
        const done = Math.min(targets.indexOf(batch[batch.length - 1]!) + 1, targets.length);
        setRefreshProgress({ done, total: targets.length });
      }
      setRefreshFailures(failed);
      toast[failed.length ? 'info' : 'success'](`已刷新 ${refreshed}/${targets.length} 条发布数据${failed.length ? `，${failed.length} 条失败` : ''}`);
    } catch (err) {
      toast.error(`批量刷新中断：${(err as Error).message}。已完成的数据已保存，其余记录未改动。`);
      setRefreshFailures([...failed, ...targets.slice(refreshed + failed.length).map((topic) => ({ title: topic.title, reason: '本批请求中断，尚未处理' }))]);
    } finally {
      setRefreshingPublished(false);
      setTimeout(() => setRefreshProgress(null), 5000);
    }
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
        const predicted = t.prediction?.value ?? t.estimatedViews;
        return sum + Math.abs(((actual - predicted) / predicted) * 100);
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
      <section className="anim-rise relative mb-8 overflow-hidden rounded-2xl border border-border bg-surface px-6 py-7 shadow-card sm:px-8 sm:py-8">
        <div className="texture-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] xl:items-center">
          <div className="max-w-xl">
            <Badge
              variant="outline"
              size="md"
              className="gap-2 rounded-full bg-surface px-2.5 py-1"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              本地优先 · 数据不出本机
            </Badge>
            <h1 className="mt-5 text-[32px] font-semibold leading-[1.12] tracking-[-0.035em] text-text sm:text-[40px]">
              把灵感，变成<br className="hidden sm:block" /><span className="text-brand">下一条好内容。</span>
            </h1>
            <p className="mt-4 max-w-lg text-[14px] leading-7 text-text-secondary">
              从选题判断到脚本成稿，再到发布复盘。把创作流程整理成一张清晰的工作台，AI 只在你需要时加入。
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Button onClick={openTopicForm}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                新建选题
              </Button>
              <Button variant="secondary" onClick={() => navigate('/report')}>
                <FileChartColumn className="h-4 w-4" aria-hidden="true" />
                行业分析报告
              </Button>
              {publishedList.length > 0 && <Button variant="ghost" loading={refreshingPublished} onClick={() => void refreshPublishedStats()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                刷新发布数据
              </Button>}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              第一次来？<Link to="/about" className="font-medium text-primary hover:underline">3 分钟导读</Link>
              ，按策划 → 平台 → 数据的顺序了解这个工具。
            </p>
          </div>

          <div className="grid w-full grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-border bg-bg/70 p-2 sm:p-3">
            <Stat
              label="选题池"
              value={topics.length}
              unit="个"
              icon={Layers}
              hint={`本周新增 ${thisWeek}`}
              delta={weekDelta}
              deltaLabel="较上周"
              appearance="flat"
            />
            <Stat
              label="已发布"
              value={publishedList.length}
              unit="条"
              icon={Send}
              tone="success"
              appearance="flat"
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
              appearance="flat"
              hint={publishedList.length ? '含真实回填数据' : '发布后自动回填'}
            />
            <Stat
              label="平均预测偏差"
              value={avgDeviation === null ? '—' : `${avgDeviation.toFixed(0)}%`}
              icon={Target}
              tone="warning"
              appearance="flat"
              hint={avgDeviation === null ? '需要真实播放量' : `${deviationPairs.length} 条样本`}
            />
          </div>
        </div>
      </section>

      {upcomingSchedule.length > 0 && <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text">近期排期</h2><p className="mt-0.5 text-xs text-text-muted">包含已逾期和未来 3 天内的安排</p></div><button type="button" onClick={() => { setCalendarView('schedule'); setScheduleWindow('week'); }} className="text-xs font-medium text-primary hover:underline">查看全部排期</button></div>
        <div className="flex flex-wrap gap-2">{upcomingSchedule.slice(0, 5).map(({ topic, kind, date }) => {
          const overdue = date < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
          return <button key={`${topic.id}-${kind}`} type="button" onClick={() => { setCalendarView('schedule'); setSchedulePresentation('month'); setCalendarMonth(new Date(date)); setSelectedCalendarDate(dateKey(new Date(date))); }} className={cn('flex min-w-44 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-surface-hover', overdue ? 'border-danger/30 bg-danger-soft/40' : 'border-border bg-surface-muted/40')}><span className={cn('h-2 w-2 shrink-0 rounded-full', overdue ? 'bg-danger' : kind === '制作截止' ? 'bg-warning' : 'bg-info')}/><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-text">{topic.title}</span><span className="mt-0.5 block text-[10px] text-text-muted">{kind} · {new Date(date).toLocaleDateString('zh-CN')}</span></span></button>;
        })}</div>
      </section>}

      {(refreshProgress || refreshFailures.length > 0) && <div className="mb-5 rounded-xl border border-border bg-surface px-4 py-3">
        {refreshProgress && <p className="text-xs font-medium text-text-secondary">正在刷新发布数据：{refreshProgress.done}/{refreshProgress.total}</p>}
        {refreshFailures.length > 0 && <details className="mt-1 text-xs text-warning">
          <summary className="cursor-pointer font-medium">{refreshFailures.length} 条未刷新，保留了原有数据</summary>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-text-secondary">{refreshFailures.map((item, index) => <li key={`${item.title}-${index}`}><span className="font-medium">{item.title}</span>：{item.reason}</li>)}</ul>
        </details>}
      </div>}

      <section aria-label="创作流程阶段" className="mb-7 overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-text">创作进度</h2>
            <p className="mt-0.5 text-xs text-text-muted">按阶段聚焦下一步</p>
          </div>
          <button type="button" onClick={() => focusStage('all')} className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === 'all' ? 'bg-primary-soft text-primary-contrast' : 'text-text-secondary hover:bg-surface-hover'}`}>全部 {topics.length}</button>
        </div>
        <div className="grid grid-cols-3 divide-x divide-y divide-border sm:grid-cols-6 sm:divide-y-0">
          {(['idea', 'researching', 'approved', 'scripting', 'done', 'published'] as TopicStatus[]).map((status, index) => {
            const count = topics.filter((topic) => topic.status === status).length;
            const active = statusFilter === status;
            return (
              <button key={status} type="button" aria-pressed={active} onClick={() => focusStage(active ? 'all' : status)} className={`group relative flex min-h-[78px] flex-col items-start justify-center gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-hover ${active ? 'bg-primary-soft/70' : ''}`}>
                <span className="flex items-center gap-2 text-[11px] font-medium text-text-secondary"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${active ? 'bg-primary text-white' : 'bg-surface-muted text-text-muted'}`}>{index + 1}</span>{STATUS_LABELS[status]}</span>
                <span className={`num pl-7 text-lg font-semibold leading-none ${active ? 'text-primary-contrast' : 'text-text'}`}>{count}</span>
                {index < 5 && <span className="absolute -right-1 top-1/2 z-10 hidden -translate-y-1/2 text-text-muted sm:block" aria-hidden="true">›</span>}
              </button>
            );
          })}
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border bg-surface p-1">
          <button type="button" aria-pressed={calendarView === 'board'} onClick={() => setCalendarView('board')} className={cn('rounded-md px-3 py-1.5 text-xs font-medium', calendarView === 'board' ? 'bg-primary-soft text-primary-contrast' : 'text-text-secondary hover:bg-surface-hover')}>流程看板</button>
          <button type="button" aria-pressed={calendarView === 'schedule'} onClick={() => setCalendarView('schedule')} className={cn('rounded-md px-3 py-1.5 text-xs font-medium', calendarView === 'schedule' ? 'bg-primary-soft text-primary-contrast' : 'text-text-secondary hover:bg-surface-hover')}>排期列表</button>
        </div>
        {calendarView === 'schedule' && <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex gap-1">{(['all', 'week', 'overdue'] as const).map((window) => <button key={window} type="button" aria-pressed={scheduleWindow === window} onClick={() => setScheduleWindow(window)} className={cn('rounded-full px-2.5 py-1 text-[11px]', scheduleWindow === window ? 'bg-surface-muted font-medium text-text' : 'text-text-muted hover:text-text')}>{window === 'all' ? '全部排期' : window === 'week' ? '未来 7 天' : '已逾期'}</button>)}</div>
          <div className="flex rounded-lg border border-border bg-surface p-0.5"><button type="button" aria-pressed={schedulePresentation === 'list'} onClick={() => setSchedulePresentation('list')} className={cn('rounded-md px-2 py-1 text-[11px]', schedulePresentation === 'list' ? 'bg-primary-soft text-primary-contrast' : 'text-text-muted')}>列表</button><button type="button" aria-pressed={schedulePresentation === 'month'} onClick={() => setSchedulePresentation('month')} className={cn('rounded-md px-2 py-1 text-[11px]', schedulePresentation === 'month' ? 'bg-primary-soft text-primary-contrast' : 'text-text-muted')}>月历</button></div>
        </div>}
      </div>

      <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="mr-1">
          <SectionHeading title="选题池" hint={`${filtered.length} / ${topics.length} 个`} className="mb-0" />
        </div>
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
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" /> {c.short}
          </button>
        ))}
      </div>
      <label className="relative block w-full sm:max-w-xs">
        <span className="sr-only">搜索选题</span>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、备注或思路…"
          className="h-9 bg-surface"
        />
          {query && (
          <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text">
            清除
          </button>
        )}
      </label>
      </div>

      <Modal
        open={showForm}
        onClose={resetTopicForm}
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="制作截止日期" hint="选填，用于提醒制作进度">
              <Input type="date" value={form.productionDueAt} onChange={(event) => setForm({ ...form, productionDueAt: event.target.value })} />
            </Field>
            <Field label="计划发布日期" hint="选填，排期视图会按此日期显示">
              <Input type="date" value={form.plannedPublishAt} onChange={(event) => setForm({ ...form, plannedPublishAt: event.target.value })} />
            </Field>
          </div>

          <Field label="制作思路" hint="视频怎么做、切入角度、结构设想等">
            <Textarea
              value={form.productionIdea}
              onChange={(e) => setForm({ ...form, productionIdea: e.target.value })}
              rows={3}
              placeholder="比如：从新手视角体验，设定一个挑战规则，穿插专业背景解读..."
            />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={resetTopicForm}>
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
          title={topics.length ? '没有匹配的选题' : '看板还是空的'}
          description={topics.length ? '试试调整搜索词或品类筛选。' : '先记下一个灵感，之后可以在看板里逐阶段推进。'}
          action={topics.length ? <Button variant="secondary" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</Button> : <Button onClick={openTopicForm}><Plus className="h-4 w-4" />新建第一个选题</Button>}
        />
      ) : calendarView === 'schedule' ? (
        schedulePresentation === 'month' ? (
          <div className="space-y-4">
            <Card padding="lg">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-text">{calendarMonth.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}</h2>
                  <div className="flex items-center gap-3 text-[11px] text-text-muted"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-warning"/>制作截止</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-info"/>计划发布日期</span></div>
                </div>
                <p className="mt-1 text-xs text-text-muted">点击日期查看排期；选中日期后可直接新建关联选题。</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))} aria-label="上个月"><ChevronLeft className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { const today = new Date(); setCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedCalendarDate(dateKey(today)); }}>今天</Button>
                  <Button size="sm" variant="secondary" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))} aria-label="下个月"><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-text-muted">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <div key={day} className="py-2">周{day}</div>)}</div>
              <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border">
                {monthCells.map(({ date, key, inMonth, entries }) => {
                  const active = selectedCalendarDate === key;
                  const today = key === dateKey(new Date());
                  return <button key={key} type="button" onClick={() => setSelectedCalendarDate(key)} className={cn('min-h-24 border-b border-r border-border p-1.5 text-left transition-colors last:border-r-0 hover:bg-surface-hover sm:min-h-28 sm:p-2', !inMonth && 'bg-surface-muted/35 text-text-muted', active && 'bg-primary-soft/50 ring-1 ring-inset ring-primary/50')}>
                    <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full text-xs', today && 'bg-primary font-semibold text-white', !today && inMonth && 'text-text', !inMonth && 'text-text-muted')}>{date.getDate()}</span>
                    <span className="mt-1 block space-y-1">
                      {entries.slice(0, 2).map(({ topic, kind }) => <span key={`${topic.id}-${kind}`} className={cn('block truncate rounded px-1 py-0.5 text-[9px] leading-tight sm:text-[10px]', kind === 'due' ? 'bg-warning-soft text-warning' : 'bg-info-soft text-info')}>{kind === 'due' ? '截' : '发'} {topic.title}</span>)}
                      {entries.length > 2 && <span className="block px-1 text-[9px] text-text-muted">+{entries.length - 2} 项</span>}
                    </span>
                  </button>;
                })}
              </div>
            </Card>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
              <CalendarDays className="h-4 w-4 text-text-muted"/>
              <span className="mr-1 text-xs text-text-secondary">直接改排期</span>
              <Select className="h-8 min-w-44 text-xs" value={selectedCalendarTopicId} onChange={(event) => setSelectedCalendarTopicId(event.target.value)}><option value="">选择一个选题…</option>{topics.filter((topic) => topic.status !== 'published').map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</Select>
              <label className="text-[10px] text-text-muted">制作截止<Input type="date" className="mt-1 h-8 w-36 text-[11px]" value={dateInputValue(selectedCalendarTopic?.productionDueAt)} onChange={(event) => selectedCalendarTopic && void handleUpdateTopicSchedule(selectedCalendarTopic, 'productionDueAt', event.target.value)} disabled={!selectedCalendarTopic}/></label>
              <label className="text-[10px] text-text-muted">计划发布日期<Input type="date" className="mt-1 h-8 w-36 text-[11px]" value={dateInputValue(selectedCalendarTopic?.plannedPublishAt)} onChange={(event) => selectedCalendarTopic && void handleUpdateTopicSchedule(selectedCalendarTopic, 'plannedPublishAt', event.target.value)} disabled={!selectedCalendarTopic}/></label>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-text">{new Date(`${selectedCalendarDate}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</h3><p className="mt-0.5 text-xs text-text-muted">{selectedDayTopics.length} 项安排</p></div>
              <Button size="sm" onClick={() => { openTopicForm(); const date = new Date(`${selectedCalendarDate}T12:00:00`); setForm((current) => ({ ...current, plannedPublishAt: dateKey(date) })); }}><Plus className="h-3.5 w-3.5" />在此日期新建选题</Button>
            </div>
            {selectedDayTopics.length === 0 ? <EmptyState compact title="这一天还没有排期" description="使用「在此日期新建选题」快速安排一条内容。" /> : <div className="space-y-2">{selectedDayTopics.map(({ topic, kind }) => <article key={`${topic.id}-${kind}`} className="card flex flex-wrap items-center justify-between gap-3 p-3.5"><div className="min-w-0"><div className="flex items-center gap-2"><Badge variant={kind === '制作截止' ? 'warning' : 'info'} size="sm">{kind}</Badge><Badge variant="neutral" size="sm">{STATUS_LABELS[topic.status]}</Badge></div><h4 className="mt-1 truncate text-sm font-semibold text-text">{topic.title}</h4><p className="mt-0.5 text-xs text-text-muted">{categoryLabel(topic.category)}</p></div><Button size="sm" variant="secondary" onClick={() => openPublish(topic)}>管理选题</Button></article>)}</div>}
          </div>
        ) : (
        <div className="space-y-3">
          {scheduledTopics.length === 0 ? <EmptyState title="当前没有符合条件的排期" description="给选题设置制作截止日期或计划发布日期后，这里会按时间列出任务。" action={<Button variant="secondary" onClick={() => { setScheduleWindow('all'); setCalendarView('board'); }}>回到创作看板</Button>} /> : scheduledTopics.map((topic) => {
            const dueAt = Math.min(topic.productionDueAt ?? Infinity, topic.plannedPublishAt ?? Infinity);
            const startToday = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
            const overdue = [topic.productionDueAt, topic.plannedPublishAt].some((date) => typeof date === 'number' && date < startToday);
            return <article key={topic.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={overdue ? 'danger' : 'info'} size="sm">{topic.productionDueAt ? '制作截止' : '计划发布'}</Badge><Badge variant="neutral" size="sm">{STATUS_LABELS[topic.status]}</Badge><span className={cn('text-xs font-medium', overdue ? 'text-danger' : 'text-text-secondary')}>{new Date(dueAt).toLocaleDateString('zh-CN')}</span></div>
                <h3 className="mt-1.5 truncate text-sm font-semibold text-text">{topic.title}</h3>
                <p className="mt-1 text-xs text-text-muted">{categoryLabel(topic.category)} · 难度 {DIFFICULTY_STARS[topic.difficulty]}{topic.productionDueAt ? ` · 截止 ${new Date(topic.productionDueAt).toLocaleDateString('zh-CN')}` : ''}{topic.plannedPublishAt ? ` · 发布 ${new Date(topic.plannedPublishAt).toLocaleDateString('zh-CN')}` : ''}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <label className="text-[10px] text-text-muted">截止 <Input type="date" className="mt-1 h-8 w-36 text-[11px]" value={dateInputValue(topic.productionDueAt)} onChange={(event) => void handleUpdateTopicSchedule(topic, 'productionDueAt', event.target.value)} /></label>
                <label className="text-[10px] text-text-muted">计划发布 <Input type="date" className="mt-1 h-8 w-36 text-[11px]" value={dateInputValue(topic.plannedPublishAt)} onChange={(event) => void handleUpdateTopicSchedule(topic, 'plannedPublishAt', event.target.value)} /></label>
                {topic.status !== 'published' && <Button size="sm" onClick={() => handleStartScript(topic)}>{topic.status === 'scripting' ? '继续脚本' : '开始写脚本'}</Button>}
              </div>
            </article>;
          })}
        </div>
        )
      ) : (
        <div ref={boardRef} className="grid min-w-0 grid-cols-1 gap-3 pb-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {stageTopics.map(({ status, topics: items }, stageIndex) => {
            const stageActive = statusFilter === status;
            const shown = items.slice(0, visibleCount);
            return (
              <section
                key={status}
                id={`topic-stage-${status}`}
                aria-label={`${STATUS_LABELS[status]}阶段`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleTopicDrop(event, status)}
                className={cn('min-w-0 rounded-xl border border-border bg-surface-muted/50 p-2.5 transition-colors', stageActive && 'border-primary/40 bg-primary-soft/25')}
              >
                <header className="sticky top-0 z-10 mb-2 flex items-center justify-between rounded-lg bg-surface/95 px-2 py-2 backdrop-blur">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-muted text-[10px] font-semibold text-text-muted">{String(stageIndex + 1).padStart(2, '0')}</span>
                    <h3 className="truncate text-xs font-semibold text-text">{STATUS_LABELS[status]}</h3>
                    <span className="num rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">{items.length}</span>
                  </div>
                  {stageActive && <span className="rounded-md bg-primary-soft px-2 py-1 text-[10px] font-medium text-primary-contrast">当前阶段</span>}
                </header>

                <div className="space-y-2">
                  {shown.map((topic) => {
                    const nextStage = TOPIC_STAGES[stageIndex + 1];
                    return (
                      <article
                        key={topic.id}
                        draggable
                        onDragStart={(event) => {
                          setDraggingTopicId(topic.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/topic-id', topic.id);
                        }}
                        onDragEnd={() => setDraggingTopicId(null)}
                        className={cn('group rounded-lg border border-border bg-surface p-3 shadow-xs transition-[opacity,border-color,box-shadow] hover:border-border-strong hover:shadow-sm', draggingTopicId === topic.id && 'opacity-40')}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Badge variant="outline" size="sm" className={categoryBadge(topic.category)}><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${getCategory(topic.category).dot}`} />{categoryLabel(topic.category)}</Badge>
                          <span className="flex items-center gap-1 text-[10px] text-text-muted"><GripVertical className="h-3.5 w-3.5" />拖动</span>
                        </div>
                        <h4 className="line-clamp-2 text-[13px] font-semibold leading-5 text-text">{topic.title}</h4>
                        {(topic.prediction?.value ?? topic.estimatedViews) > 0 && <p className="mt-1 text-[10px] text-text-muted">预测 {formatViews(topic.prediction?.value ?? topic.estimatedViews)} · {(topic.prediction?.source ?? 'ai') === 'ai' ? 'AI 预测' : '人工目标'}</p>}
                        {(topic.gameDescription || topic.notes || topic.productionIdea) && <p className="mt-1.5 line-clamp-3 text-[11px] leading-[1.65] text-text-secondary">{topic.productionIdea || topic.gameDescription || topic.notes}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {topic.urgency === 'high' && <Badge variant="danger" size="sm">紧急</Badge>}
                          <span className="text-[10px] text-text-muted">难度 {DIFFICULTY_STARS[topic.difficulty]}</span>
                          <span className="ml-auto text-[10px] text-text-muted">{new Date(topic.createdAt).toLocaleDateString('zh-CN')}</span>
                        </div>
                        {topic.published && <div className="mt-2 rounded-md bg-success-soft px-2 py-1.5 text-[10px] text-success">实际播放 <span className="num font-semibold">{formatViews(topic.published.views)}</span>{(topic.prediction?.value ?? topic.estimatedViews) > 0 && <> · 偏差 {formatDeviation(topic.prediction?.value ?? topic.estimatedViews, topic.published.views)}</>}</div>}
                        {topic.retrospective?.tags.length ? <div className="mt-2 flex flex-wrap gap-1">{topic.retrospective.tags.map((tag) => <Badge key={tag} variant="neutral" size="sm">{tagLabel(tag)}</Badge>)}</div> : null}
                        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2">
                          <Button size="sm" variant="primary" className="h-8 flex-1 text-[11px]" onClick={() => handleStartScript(topic)}>{topic.status === 'scripting' ? '继续写脚本' : '开始写脚本'}</Button>
                          <details className="group/more relative">
                            <summary className="flex h-8 cursor-pointer list-none items-center rounded-lg border border-border px-2 text-[11px] text-text-secondary hover:bg-surface-hover">更多</summary>
                            <div className="absolute right-0 top-9 z-30 flex min-w-40 flex-col rounded-xl border border-border bg-surface p-1.5 shadow-lg">
                              {nextStage && <button type="button" className="rounded-lg px-3 py-2 text-left text-xs font-medium text-primary hover:bg-primary-soft" onClick={() => moveTopicToStage(topic, nextStage)}>推进到「{STATUS_LABELS[nextStage]}」</button>}
                              {stageIndex > 0 && <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-hover" onClick={() => moveTopicToStage(topic, TOPIC_STAGES[stageIndex - 1]!)}>退回到「{STATUS_LABELS[TOPIC_STAGES[stageIndex - 1]!]}」</button>}
                              <button type="button" disabled={evaluating === topic.id} className="rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50" onClick={() => handleEvaluate(topic)}>{evaluating === topic.id ? 'AI 评估中…' : topic.evaluation ? `AI 评估 · ${topic.evaluation.score}分` : 'AI 评估'}</button>
                              <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-hover" onClick={() => handleViewScripts(topic)}>查看关联脚本</button>
                              <details className="border-t border-border px-2 py-1.5">
                                <summary className="cursor-pointer list-none py-1 text-xs text-text-secondary hover:text-text">设置排期日期</summary>
                                <div className="space-y-2 py-2">
                                  <label className="block text-[10px] text-text-muted">制作截止<Input type="date" className="mt-1 h-8 text-[11px]" value={dateInputValue(topic.productionDueAt)} onChange={(event) => void handleUpdateTopicSchedule(topic, 'productionDueAt', event.target.value)} /></label>
                                  <label className="block text-[10px] text-text-muted">计划发布<Input type="date" className="mt-1 h-8 text-[11px]" value={dateInputValue(topic.plannedPublishAt)} onChange={(event) => void handleUpdateTopicSchedule(topic, 'plannedPublishAt', event.target.value)} /></label>
                                </div>
                              </details>
                              <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-hover" onClick={() => openPublish(topic)}>{topic.published ? '更新发布数据' : '记录发布'}</button>
                              <button type="button" className="rounded-lg px-3 py-2 text-left text-xs text-danger hover:bg-danger-soft" onClick={() => setDeleteTarget(topic)}>删除选题</button>
                            </div>
                          </details>
                        </div>
                      </article>
                    );
                  })}
                  {items.length === 0 && <div className="flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-[11px] text-text-muted"><span className="mb-1 text-base">＋</span>拖入选题，或从卡片菜单推进</div>}
                  {items.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 24)} className="w-full rounded-lg border border-dashed border-border py-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface hover:text-text-secondary">显示更多 · 还有 {items.length - visibleCount} 个</button>}
                </div>
              </section>
            );
          })}
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
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除这个选题？"
        description={deleteTarget ? `「${deleteTarget.title}」将从本机选题库移除。` : ''}
        confirmLabel="删除选题"
        pending={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onClose={() => setDeleteTarget(null)}
      />
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
                {manualPredictionInput.trim() && Number(manualPredictionInput) > 0
                  ? `人工目标 ${formatViews(Number(manualPredictionInput))} · 实际 ${formatViews(publishStat.views)} · 偏差 ${formatDeviation(Number(manualPredictionInput), publishStat.views)}`
                  : publishPredicted === undefined
                  ? '该选题还没有数字化的预测播放量，本次只记录实际结果，不计算偏差。'
                  : `${publishTarget?.prediction?.source === 'manual' ? '人工目标' : 'AI 预测'} ${formatViews(publishPredicted)} · 实际 ${formatViews(publishStat.views)} · 偏差 ${formatDeviation(publishPredicted, publishStat.views)}`}
              </p>
            </div>
          )}

          <Card padding="md" className="space-y-3">
            <div>
              <SectionHeading title="播放预测 / 目标" hint="AI 预测与人工目标都会参与校准，并保留来源标记" className="mb-1" />
              {publishTarget?.prediction && <p className="text-[11px] text-text-muted">当前来源：{publishTarget.prediction.source === 'ai' ? 'AI 预测' : '人工目标'} · 更新于 {new Date(publishTarget.prediction.updatedAt).toLocaleString('zh-CN')}</p>}
            </div>
            <div className="flex items-end gap-2">
              <Field label="人工播放目标" hint="填写后会作为人工预测参与校准；留空不会改写现有 AI 预测" className="min-w-0 flex-1">
                <Input type="number" min={1} value={manualPredictionInput} onChange={(event) => setManualPredictionInput(event.target.value)} placeholder={publishTarget?.prediction?.source === 'ai' ? `AI 预测 ${formatViews(publishTarget.prediction.value)}` : '例如：50000'} />
              </Field>
              <Button variant="secondary" size="sm" loading={savingPrediction} disabled={!manualPredictionInput.trim()} onClick={() => void handleSaveManualPrediction()}>保存人工目标</Button>
            </div>
          </Card>

          <Card padding="md" className="space-y-3">
            <div>
              <SectionHeading title="发布复盘" hint="选择可能的影响因素，记下下次可验证的调整" className="mb-1" />
              <p className="text-[11px] text-text-muted">这是人工复盘记录，不代表系统判断了因果关系。</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RETROSPECTIVE_TAGS.map((tag) => {
                const active = retrospectiveTags.includes(tag);
                return <button key={tag} type="button" aria-pressed={active} onClick={() => toggleRetrospectiveTag(tag)} className={cn('rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors', active ? 'border-primary/30 bg-primary-soft text-primary-contrast' : 'border-border text-text-secondary hover:bg-surface-hover')}>{tagLabel(tag)}</button>;
              })}
            </div>
            <Field label="复盘结论 / 下次行动" hint="例如：开头 3 秒直接展示最终卡组，删掉背景铺垫">
              <Textarea rows={3} value={retrospectiveNote} onChange={(event) => setRetrospectiveNote(event.target.value)} placeholder="记录观察到的结果和下一次要验证的具体改动…" />
            </Field>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" disabled={!retrospectiveTags.length && !retrospectiveNote.trim()} onClick={() => void handleSaveRetrospective()}>保存复盘记录</Button>
            </div>
          </Card>

        </div>
      </Modal>
    </div>
  );
}
