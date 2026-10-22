import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useScriptStore } from '../store/scriptStore';
import { useTopicStore } from '../store/topicStore';
import { api, type ScriptSuggestion } from '../api/client';
import type { Platform, Script, Storyboard, IdeaEvaluation, TitleEvaluation } from '../types';
import { categoryLabel } from '../config/categories';
import PlatformCheckPanel from '../components/PlatformCheckPanel';
import { EmptyState } from '../components/ui/EmptyState';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  ArrowRight,
  ChevronDown,
  Clapperboard,
  Clock,
  FileText,
  ListChecks,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/Toast';

const PLATFORM_LABELS: Record<Platform, string> = {
  bilibili: 'B站',
  douyin: '抖音',
};

const VERSION_LABELS: Record<string, string> = {
  long: '长版',
  short: '短版',
};

/** 页面头文案：两处渲染（空态 / 正常态）共用，避免出现两套说法 */
const PAGE_EYEBROW = '创作台 / SCRIPT';
const PAGE_TITLE = '脚本编辑';
const PAGE_DESCRIPTION =
  '逐段写脚本、按平台跑适配体检、让 AI 给出可执行建议；所有改动自动保存在本机。';

/** 稿子写到哪一步 —— 只看脚本自身的字段，不引入新的数据 */
function scriptProgress(script: Script): {
  label: string;
  variant: 'success' | 'info' | 'warning';
} {
  const hasTitle = script.title.trim().length > 0;
  const hasHook = script.hook.trim().length > 0;
  if (!hasTitle && !hasHook && script.storyboards.length === 0) {
    return { label: '未开始', variant: 'warning' };
  }
  if (hasTitle && hasHook && script.storyboards.length > 0) {
    return { label: '已成稿', variant: 'success' };
  }
  return { label: '撰写中', variant: 'info' };
}

/** 一条脚本的总时长（秒） */
function scriptDuration(script: Script): number {
  return script.storyboards.reduce((sum, b) => sum + b.duration, 0);
}

/** 一条脚本的正文字数（口播台词 + 画面描述） */
function scriptChars(script: Script): number {
  return script.storyboards.reduce(
    (sum, b) => sum + b.dialogue.length + b.description.length,
    0,
  );
}

/** 药丸式切换（与选题看板的筛选器同一套观感） */
const PILL_BASE = 'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors';
const PILL_ON = 'border-transparent bg-primary text-white shadow-xs';
const PILL_OFF =
  'border-border bg-surface text-text-secondary hover:border-border-strong hover:text-text';

export default function ScriptEditor() {
  const { scriptId } = useParams<{ scriptId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // 分镜增删时自动做位移动画
  const [boardListRef] = useAutoAnimate();
  const { scripts, loading: scriptsLoading, loadScripts, createScript, updateScript, addStoryboard, removeStoryboard, updateStoryboard, replaceStoryboards, deleteScript, saveRevision, restoreRevision } = useScriptStore();
  const { topics, loading: topicsLoading, loadTopics, updateTopic } = useTopicStore();

  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(scriptId || null);
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [pairTopicId, setPairTopicId] = useState('');
  const [aiPanel, setAiPanel] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<ScriptSuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [ideaEval, setIdeaEval] = useState<IdeaEvaluation | null>(null);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [showIdeaEval, setShowIdeaEval] = useState(false);
  const [titleEval, setTitleEval] = useState<TitleEvaluation | null>(null);
  const [titleEvalLoading, setTitleEvalLoading] = useState(false);
  const [showTitleEval, setShowTitleEval] = useState(false);

  useEffect(() => {
    loadScripts();
    loadTopics();
  }, [loadScripts, loadTopics]);

  useEffect(() => {
    const topicFilter = searchParams.get('topic');
    if (topicFilter && scripts.length > 0) {
      const firstMatch = scripts.find((s) => s.topicId === topicFilter);
      if (firstMatch) setSelectedScriptId(firstMatch.id);
    }
  }, [searchParams, scripts]);

  useEffect(() => {
    if (scriptId) setSelectedScriptId(scriptId);
  }, [scriptId]);

  const selectedScript = scripts.find((s) => s.id === selectedScriptId);
  const topicScripts = selectedScript
    ? scripts.filter((s) => s.topicId === selectedScript.topicId)
    : [];
  const currentTopic = selectedScript
    ? topics.find((t) => t.id === selectedScript.topicId)
    : null;

  const totalDuration = selectedScript?.storyboards.reduce((sum, b) => sum + b.duration, 0) || 0;

  // 列表 / 切换器共用的排序（与原实现一致：按创建时间倒序）
  // Store already returns newest-first. Copy before sorting to avoid mutating Zustand state
  // during render and doing unnecessary work on each editor keystroke.
  const sortedScripts = useMemo(
    () => [...scripts].sort((a, b) => b.createdAt - a.createdAt),
    [scripts],
  );
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const [visibleScriptCount, setVisibleScriptCount] = useState(24);
  const [scriptQuery, setScriptQuery] = useState('');
  const visibleScripts = useMemo(() => {
    const normalizedQuery = scriptQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sortedScripts;
    return sortedScripts.filter((script) => {
      const topicTitle = topicById.get(script.topicId)?.title ?? '';
      return `${topicTitle} ${script.title} ${script.hook} ${PLATFORM_LABELS[script.platform]} ${VERSION_LABELS[script.version]}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [scriptQuery, sortedScripts, topicById]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingScript, setDeletingScript] = useState(false);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);
  const toast = useToast();

  const handleCreateNew = () => {
    if (topics.length === 0) return;
    setPairTopicId(topics[0].id);
    setShowPairDialog(true);
  };

  const handleConfirmPair = async () => {
    if (!pairTopicId) return;
    const existing = useScriptStore.getState().scripts.find(
      (script) => script.topicId === pairTopicId && script.platform === 'bilibili' && script.version === 'long',
    );
    const script = existing ?? await createScript(pairTopicId, 'bilibili', 'long');
    if (existing) toast.info('该选题已有长版 B 站脚本，已打开现有脚本');
    setSelectedScriptId(script.id);
    setShowPairDialog(false);
    navigate(`/scripts/${script.id}`, { replace: true });
  };

  const handleCreateVersion = async (version: 'long' | 'short', platform: Platform) => {
    if (!selectedScript) return;
    const existing = topicScripts.find((s) => s.version === version && s.platform === platform);
    if (existing) {
      setSelectedScriptId(existing.id);
      navigate(`/scripts/${existing.id}`, { replace: true });
      return;
    }
    const script = await createScript(selectedScript.topicId, platform, version);
    setSelectedScriptId(script.id);
    navigate(`/scripts/${script.id}`, { replace: true });
  };

  const handleAddBoard = async () => {
    if (!selectedScript) return;
    await saveRevision(selectedScript.id, '添加分镜前快照');
    await addStoryboard(selectedScript.id);
  };

  const handleSaveScriptRevision = async () => {
    if (!selectedScript) return;
    await saveRevision(selectedScript.id);
    toast.success('脚本版本已保存');
  };

  const handleDeleteScript = async () => {
    if (!selectedScript) return;
    setDeletingScript(true);
    try {
      await deleteScript(selectedScript.id);
      setSelectedScriptId(null);
      setDeleteConfirmOpen(false);
      navigate('/scripts', { replace: true });
      toast.success('脚本已删除');
    } finally {
      setDeletingScript(false);
    }
  };

  const handleAiSuggest = async () => {
    if (!selectedScript || !currentTopic) return;
    setAiLoading(true);
    setAiError('');
    setAiSuggestion(null);
    setAiPanel(true);
    try {
      const result = await api.suggestScript({
        topicTitle: currentTopic.title,
        category: currentTopic.category,
        platform: selectedScript.platform,
        version: selectedScript.version,
        scriptTitle: selectedScript.title,
        hook: selectedScript.hook,
        storyboards: selectedScript.storyboards,
      });
      setAiSuggestion(result);
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!selectedScript || !currentTopic) return;

    // If topic has a production idea, evaluate it first
    if (currentTopic.productionIdea && currentTopic.productionIdea.trim()) {
      // Check cache (within 24h)
      if (currentTopic.ideaEvaluation && (Date.now() - currentTopic.ideaEvaluation.evaluatedAt < 86400000)) {
        setIdeaEval(currentTopic.ideaEvaluation);
        setShowIdeaEval(true);
        return;
      }

      // Evaluate fresh
      await doEvaluateIdea();
      return;
    }

    // No production idea → generate directly
    await doGenerateScript();
  };

  const doEvaluateIdea = async () => {
    if (!currentTopic) return;
    setIdeaLoading(true);
    setIdeaEval(null);
    setShowIdeaEval(true);
    setAiError('');
    try {
      const result = await api.evaluateIdea({
        topicTitle: currentTopic.title,
        category: currentTopic.category,
        productionIdea: currentTopic.productionIdea,
        gameDescription: currentTopic.gameDescription,
      });
      const evalWithTime: IdeaEvaluation = { ...result, evaluatedAt: Date.now() };
      setIdeaEval(evalWithTime);
      await updateTopic(currentTopic.id, { ideaEvaluation: evalWithTime });
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setIdeaLoading(false);
    }
  };

  const doGenerateScript = async (replaceExisting = false) => {
    if (!selectedScript || !currentTopic) return;
    if (!replaceExisting && (selectedScript.hook.trim() || selectedScript.storyboards.length > 0)) {
      setOverwriteConfirmOpen(true);
      return;
    }
    setGenLoading(true);
    setAiError('');
    setShowIdeaEval(false);
    try {
      const result = await api.generateScript({
        topicTitle: currentTopic.title,
        category: currentTopic.category,
        platform: selectedScript.platform,
        version: selectedScript.version,
        productionIdea: currentTopic.productionIdea,
        gameDescription: currentTopic.gameDescription,
      });
      await saveRevision(selectedScript.id, 'AI 重新生成前自动快照');
      const boards: Storyboard[] = result.storyboards.map((board, index) => ({
        id: crypto.randomUUID(),
        sceneNumber: index + 1,
        description: board.description,
        dialogue: board.dialogue,
        duration: board.duration,
        visualDirection: board.visualDirection,
        notes: board.notes,
      }));
      await updateScript(selectedScript.id, { hook: result.hook || selectedScript.hook });
      await replaceStoryboards(selectedScript.id, boards);
      setOverwriteConfirmOpen(false);
      setShowIdeaEval(false);
      toast.success(`AI 脚本框架已生成，替换了 ${selectedScript.storyboards.length} 个旧分镜`);
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleEvaluateTitle = async (forceRefresh = false) => {
    if (!selectedScript || !currentTopic) return;
    if (!selectedScript.title.trim()) {
      setAiError('请先输入视频标题');
      return;
    }

    // Check cache (within 24h) unless force refresh
    if (!forceRefresh && currentTopic.titleEvaluation && (Date.now() - currentTopic.titleEvaluation.evaluatedAt < 86400000)) {
      setTitleEval(currentTopic.titleEvaluation);
      setShowTitleEval(true);
      return;
    }

    setTitleEvalLoading(true);
    setTitleEval(null);
    setShowTitleEval(true);
    setAiError('');
    try {
      const result = await api.evaluateScriptTitle({
        gameTitle: currentTopic.title,
        gameDescription: currentTopic.gameDescription || '',
        scriptTitle: selectedScript.title,
        category: currentTopic.category,
      });
      const evalWithTime: TitleEvaluation = { ...result, evaluatedAt: Date.now() };
      setTitleEval(evalWithTime);
      await updateTopic(currentTopic.id, { titleEvaluation: evalWithTime });
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setTitleEvalLoading(false);
    }
  };

  if ((scriptsLoading || topicsLoading) && scripts.length === 0 && topics.length === 0) {
    return <div><PageHeader eyebrow={PAGE_EYEBROW} title={PAGE_TITLE} description={PAGE_DESCRIPTION} /><div className="card flex items-center justify-center py-14"><Spinner label="正在读取本地创作数据…" /></div></div>;
  }

  if (scripts.length === 0 && topics.length === 0) {
    return (
      <div>
        <PageHeader
          eyebrow={PAGE_EYEBROW}
          title={PAGE_TITLE}
          description={PAGE_DESCRIPTION}
        />
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="还没有脚本"
          description="先去选题看板建一个选题，再回来把它写成脚本；写过的内容会自动保存。"
          action={
            <Button variant="link" size="sm" onClick={() => navigate('/')}>
              前往选题看板
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={PAGE_EYEBROW}
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={
          <>
            {selectedScript && currentTopic && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleEvaluateTitle()}
                  loading={titleEvalLoading}
                >
                  {titleEvalLoading ? '分析标题...' : '标题评估'}
                </Button>
                <Button
                  variant="soft"
                  size="sm"
                  onClick={handleAiSuggest}
                  loading={aiLoading}
                >
                  {aiLoading ? '分析中...' : 'AI 建议'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAiGenerate}
                  loading={genLoading}
                >
                  {genLoading ? '生成中...' : 'AI 生成脚本'}
                </Button>
              </>
            )}
            <Button
              variant={selectedScript ? 'secondary' : 'primary'}
              size="sm"
              onClick={handleCreateNew}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              新建脚本
            </Button>
          </>
        }
      />

  {!selectedScript ? (
    <div className="space-y-4">
      <SectionHeading
        title="脚本列表"
        hint={`${visibleScripts.length} / ${scripts.length} 条 · 按创建时间倒序`}
        action={
          <Button variant="secondary" size="sm" onClick={handleCreateNew}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            新建脚本
          </Button>
        }
      />

      {scripts.length > 0 && (
        <label className="relative mb-4 block w-full sm:max-w-sm">
          <span className="sr-only">搜索脚本</span>
          <Input type="search" value={scriptQuery} onChange={(event) => setScriptQuery(event.target.value)} placeholder="搜索选题、标题、平台…" />
        </label>
      )}

      {scriptsLoading ? (
        <div className="card flex items-center justify-center py-14"><Spinner label="正在读取本地脚本…" /></div>
      ) : visibleScripts.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="h-5 w-5" />}
          title={scripts.length ? '没有匹配的脚本' : '选择一个脚本开始编辑'}
          description={scripts.length ? '换个关键词试试，或清空搜索条件。' : '这里还没有可编辑的脚本，先新建一条；写过的内容会自动保存在本机，重开页面还在。'}
          action={
            scripts.length ? <Button size="sm" variant="secondary" onClick={() => setScriptQuery('')}>清空搜索</Button> : <Button size="sm" onClick={handleCreateNew} disabled={topics.length === 0}><Plus className="h-3.5 w-3.5" aria-hidden="true" />新建脚本</Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleScripts.slice(0, visibleScriptCount).map((script, index) => {
            const topic = topicById.get(script.topicId);
            const progress = scriptProgress(script);
            return (
              <button
                key={script.id}
                type="button"
                onClick={() => {
                  setSelectedScriptId(script.id);
                  navigate(`/scripts/${script.id}`, { replace: true });
                }}
                className={`card card-hover w-full p-4 text-left ${index < 8 ? 'anim-rise' : ''}`}
                style={index < 8 ? { animationDelay: `${(0.02 + index * 0.04).toFixed(2)}s` } : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-text">
                    {topic?.title || '未关联选题'}
                  </h3>
                  <Badge variant={progress.variant} size="sm">
                    {progress.label}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="primary" size="sm">
                    {PLATFORM_LABELS[script.platform]} · {VERSION_LABELS[script.version]}
                  </Badge>
                  {script.title.trim() !== '' && (
                    <Badge variant="outline" size="sm">
                      {script.title}
                    </Badge>
                  )}
                </div>

                {(script.hook.trim() !== '' || script.notes.trim() !== '') && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                    {script.hook.trim() !== '' ? script.hook : script.notes}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    总时长 <span className="num">{scriptDuration(script)}</span> 秒
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="num">{script.storyboards.length}</span> 镜
                  </span>
                  <span className="inline-flex items-center gap-1">
                    更新 <span className="num">{new Date(script.updatedAt).toLocaleDateString('zh-CN')}</span>
                  </span>
                </div>
              </button>
            );
          })}
          {visibleScripts.length > visibleScriptCount && (
            <div className="flex justify-center pt-1 sm:col-span-2 xl:col-span-3">
              <Button variant="secondary" onClick={() => setVisibleScriptCount((count) => count + 24)}>
                显示更多（还有 {visibleScripts.length - visibleScriptCount} 条）
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  ) : (
    <div className="space-y-4">
      {/* 切换脚本：药丸式，与选题看板的筛选器同一套观感 */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="eyebrow mr-1">切换脚本</span>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
        {sortedScripts.slice(0, 12).map((script) => {
          const topic = topicById.get(script.topicId);
          const on = script.id === selectedScriptId;
          return (
            <button
              key={script.id}
              type="button"
              onClick={() => {
                setSelectedScriptId(script.id);
                navigate(`/scripts/${script.id}`, { replace: true });
              }}
              className={`${PILL_BASE} ${on ? PILL_ON : PILL_OFF}`}
            >
              {topic?.title || '未关联选题'}
              <span className="num ml-1.5 opacity-70">
                {PLATFORM_LABELS[script.platform]}{VERSION_LABELS[script.version]}
              </span>
            </button>
          );
        })}
        {sortedScripts.length > 12 && <span className="shrink-0 self-center text-xs text-text-muted">还有 {sortedScripts.length - 12} 条，请从列表搜索切换</span>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="min-w-0 space-y-4">
          {/* 脚本信息条：标题 + 平台/时长/镜数药丸 + 操作；lg 以上吸顶（移动端顶栏是 z-30，这里不抢） */}
          <Card padding="md" className="lg:sticky lg:top-4 lg:z-10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="neutral" size="sm">
                    {categoryLabel(currentTopic?.category)}
                  </Badge>
                  <Badge variant="primary" size="sm">
                    {PLATFORM_LABELS[selectedScript.platform]} · {VERSION_LABELS[selectedScript.version]}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    总时长 <span className="num">{totalDuration}</span> 秒
                  </Badge>
                  <Badge variant="outline" size="sm">
                    <ListChecks className="h-3 w-3" aria-hidden="true" />
                    <span className="num">{selectedScript.storyboards.length}</span> 镜
                  </Badge>
                </div>
                <h2 className="mt-2 truncate text-base font-semibold tracking-tight text-text">
                  {currentTopic?.title || '未关联选题'}
                </h2>
                <p className="mt-1 text-xs text-text-muted">
                  正文 <span className="num">{scriptChars(selectedScript)}</span> 字 · 更新于{' '}
                  <span className="num">
                    {new Date(selectedScript.updatedAt).toLocaleDateString('zh-CN')}
                  </span>
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCreateVersion('short', 'douyin')}
                >
                  + 抖音短版
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCreateVersion('long', 'bilibili')}
                >
                  + B站长版
                </Button>
                <Button variant="dangerGhost" size="sm" onClick={() => setDeleteConfirmOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  删除脚本
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
                  版本历史{selectedScript.history?.length ? ` · ${selectedScript.history.length}` : ''}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate(`/runs?create=1&scriptId=${encodeURIComponent(selectedScript.id)}`)}>
                  <Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />
                  开始成片
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void handleSaveScriptRevision()}>保存版本</Button>
              </div>
              {selectedScript.history?.length ? <p className="mt-2 text-[11px] text-text-muted">已保存 {selectedScript.history.length} 个版本 · 最近快照 {new Date(selectedScript.history[selectedScript.history.length - 1]!.savedAt).toLocaleString('zh-CN')}</p> : null}
            </div>

            {currentTopic?.productionIdea && (
              <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                <span className="font-medium text-text-muted">制作思路：</span>
                {currentTopic.productionIdea}
              </p>
            )}
          </Card>

          <Card padding="md">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                  标题与开场钩子
                </span>
              }
              description="标题决定点击，前 3-5 秒决定留存"
            />

            <div className="space-y-3">
              <Field label="视频标题">
                <Input
                  type="text"
                  value={selectedScript.title}
                  onChange={(e) => updateScript(selectedScript.id, { title: e.target.value })}
                  placeholder="给视频起个吸引人的标题..."
                />
              </Field>

              <Field label="开场钩子（前3-5秒）">
                <Textarea
                  value={selectedScript.hook}
                  onChange={(e) => updateScript(selectedScript.id, { hook: e.target.value })}
                  placeholder="观众凭什么不走？一句话抓住注意力..."
                  rows={2}
                  className="leading-relaxed"
                />
              </Field>
            </div>
          </Card>

          <Card padding="md">
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Clapperboard className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                  分镜脚本
                </span>
              }
              description={
                <>
                  <span className="num">{selectedScript.storyboards.length}</span> 镜 · 总时长{' '}
                  <span className="num">{totalDuration}</span> 秒
                </>
              }
              action={
                <Button variant="primary" size="sm" onClick={handleAddBoard}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  加分镜
                </Button>
              }
            />

            <div ref={boardListRef} className="space-y-3">
              {selectedScript.storyboards.map((board) => (
                <StoryboardCard
                  key={board.id}
                  board={board}
                  onUpdate={(updates) => updateStoryboard(selectedScript.id, board.id, updates)}
                  onDelete={() => removeStoryboard(selectedScript.id, board.id)}
                />
              ))}
              {selectedScript.storyboards.length === 0 && (
                <EmptyState
                  compact
                  icon={<Clapperboard className="h-4 w-4" />}
                  title="还没有分镜"
                  description="点上方「+ 加分镜」，先把开头三秒定下来。"
                />
              )}
            </div>
          </Card>

          <Card padding="md">
            <Field label="备注" hint="BGM、特效想法、注意事项 —— 只有你自己看">
              <Textarea
                value={selectedScript.notes}
                onChange={(e) => updateScript(selectedScript.id, { notes: e.target.value })}
                placeholder="BGM选择、特效想法、注意事项..."
                rows={2}
                className="leading-relaxed"
              />
            </Field>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {/* AI 建议：原来是一个居中弹窗，现在作为右栏的常驻面板（状态与请求逻辑不变） */}
          {aiPanel && (
            <Card padding="md">
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    AI 脚本建议
                  </span>
                }
                action={
                  <Button variant="ghost" size="xs" onClick={() => setAiPanel(false)}>
                    关闭
                  </Button>
                }
              />

              {aiLoading && (
                <div className="flex items-center gap-2.5 py-6 text-sm text-text-secondary">
                  <Spinner size="md" className="text-primary" />
                  AI 正在分析你的脚本...
                </div>
              )}

              {aiError && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
                  <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-danger">{aiError}</p>
                </div>
              )}

              {aiSuggestion && (
                <div className="space-y-4">
                  {aiSuggestion.hookSuggestions.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-text">钩子建议</h3>
                      <ul className="space-y-2">
                        {aiSuggestion.hookSuggestions.map((h, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft/60 px-3 py-2 text-sm leading-relaxed text-primary-contrast"
                          >
                            <span className="num mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface text-xs font-semibold text-primary-contrast">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1">{h}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiSuggestion.structureAdvice && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-text">结构建议</h3>
                      <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm leading-relaxed text-text-secondary">
                        {aiSuggestion.structureAdvice}
                      </p>
                    </div>
                  )}

                  {aiSuggestion.pacingAdvice && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-text">节奏控制</h3>
                      <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm leading-relaxed text-text-secondary">
                        {aiSuggestion.pacingAdvice}
                      </p>
                    </div>
                  )}

                  {aiSuggestion.dialogueTips.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-text">台词技巧</h3>
                      <ul className="space-y-1.5">
                        {aiSuggestion.dialogueTips.map((t, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm leading-relaxed text-text-secondary"
                          >
                            <span
                              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiSuggestion.improvementPoints.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-text">改进建议</h3>
                      <ul className="space-y-1.5">
                        {aiSuggestion.improvementPoints.map((p, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-sm leading-relaxed text-warning"
                          >
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1">{p}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiSuggestion['b-rollIdeas'].length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-text">B-roll 画面建议</h3>
                      <ul className="space-y-1.5">
                        {aiSuggestion['b-rollIdeas'].map((b, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm leading-relaxed text-text-secondary"
                          >
                            <span
                              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted"
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* M4：平台适配检查（纯规则引擎；同一份脚本在 B站/抖音 的结论不同） */}
          {/* key=脚本 id：切换脚本时重建面板，避免上一条脚本的封面文案串到新脚本 */}
          {/* saved/onSave：面板里手填的内容跟着脚本一起落库 + 云同步，关掉页面重开不丢 */}
          <PlatformCheckPanel
            key={selectedScript.id}
            platform={selectedScript.platform}
            title={selectedScript.title}
            durationSec={totalDuration}
            saved={selectedScript.platformCheck}
            onSave={(patch) =>
              updateScript(selectedScript.id, {
                platformCheck: {
                  ...(selectedScript.platformCheck ?? { coverText: '' }),
                  ...patch,
                  updatedAt: Date.now(),
                },
              })
            }
          />
        </div>
      </div>
    </div>
  )}

      {/* 制作思路评估弹窗 */}
      <Modal
        open={!!(showIdeaEval)}
        onClose={() => setShowIdeaEval(false)}
        size="md"
        title="制作思路评估"
        description={
          ideaEval?.evaluatedAt
            ? `评估于 ${new Date(ideaEval.evaluatedAt).toLocaleString('zh-CN')}`
            : undefined
        }
        footer={
          ideaEval && !ideaLoading ? (
            <>
              <Button variant="ghost" size="md" onClick={() => setShowIdeaEval(false)}>
                关闭
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => doEvaluateIdea()}
                loading={ideaLoading}
              >
                {ideaLoading ? '评估中...' : '重新评估'}
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => doGenerateScript()}
                loading={genLoading}
                disabled={genLoading || ideaLoading}
              >
                {genLoading ? '生成中...' : selectedScript?.storyboards.length || selectedScript?.hook.trim() ? '替换并重新生成' : '生成脚本框架'}
              </Button>
            </>
          ) : undefined
        }
      >
        {ideaLoading && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Spinner size="lg" className="text-primary" />
            <p className="text-sm text-text-secondary">AI 正在评估你的制作思路...</p>
          </div>
        )}

        {aiError && !ideaLoading && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-danger">评估失败</p>
                <p className="mt-0.5 text-xs leading-relaxed text-danger">{aiError}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowIdeaEval(false)}>
                关闭
              </Button>
              <Button variant="primary" size="sm" onClick={() => doGenerateScript()}>
                跳过评估，直接生成
              </Button>
            </div>
          </div>
        )}

        {ideaEval && !ideaLoading && (
          <div className="space-y-4">
            <Stat
              label="可行性评分"
              value={ideaEval.feasibilityScore}
              unit="/ 100"
              tone="primary"
              interactive={false}
            />

            {ideaEval.strengths.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-text">亮点优势</h3>
                <ul className="space-y-1.5">
                  {ideaEval.strengths.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-success-soft px-3 py-2 text-sm leading-relaxed text-text-secondary"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ideaEval.weaknesses.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-text">潜在问题</h3>
                <ul className="space-y-1.5">
                  {ideaEval.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-danger-soft px-3 py-2 text-sm leading-relaxed text-text-secondary"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-text">改进建议</h3>
              <p className="rounded-lg bg-surface-muted p-3 text-sm leading-relaxed text-text-secondary">
                {ideaEval.suggestions}
              </p>
            </div>

            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-text">推荐方向</h3>
              <p className="rounded-lg bg-info-soft p-3 text-sm leading-relaxed text-text-secondary">
                {ideaEval.recommendedApproach}
              </p>
            </div>

            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-text">脚本重点</h3>
              <p className="rounded-lg bg-warning-soft p-3 text-sm leading-relaxed text-text-secondary">
                {ideaEval.scriptFocus}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* 标题评估弹窗 */}
      <Modal
        open={!!(showTitleEval)}
        onClose={() => setShowTitleEval(false)}
        size="md"
        title="标题评估"
        description={
          titleEval?.evaluatedAt
            ? `评估于 ${new Date(titleEval.evaluatedAt).toLocaleString('zh-CN')}`
            : undefined
        }
        footer={
          titleEval && !titleEvalLoading ? (
            <>
              <Button variant="ghost" size="md" onClick={() => setShowTitleEval(false)}>
                关闭
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  if (currentTopic) handleEvaluateTitle(true);
                }}
                loading={titleEvalLoading}
              >
                {titleEvalLoading ? '评估中...' : '重新评估'}
              </Button>
            </>
          ) : undefined
        }
      >
        {titleEvalLoading && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Spinner size="lg" className="text-warning" />
            <p className="text-sm text-text-secondary">AI 正在分析你的视频标题...</p>
          </div>
        )}

        {aiError && !titleEvalLoading && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5">
              <TriangleAlert className="mt-px h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-danger">评估失败</p>
                <p className="mt-0.5 text-xs leading-relaxed text-danger">{aiError}</p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setShowTitleEval(false);
                setAiError('');
              }}
            >
              关闭
            </Button>
          </div>
        )}

        {titleEval && !titleEvalLoading && (
          <div className="space-y-4">
            <Stat
              label="标题吸引力评分"
              value={titleEval.score}
              unit="/ 100"
              tone="warning"
              interactive={false}
            />

            <div>
              <h3 className="mb-1.5 text-sm font-semibold text-text">标题分析</h3>
              <p className="rounded-lg bg-surface-muted p-3 text-sm leading-relaxed text-text-secondary">
                {titleEval.analysis}
              </p>
            </div>

            {titleEval.strengths.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-text">标题优点</h3>
                <ul className="space-y-1.5">
                  {titleEval.strengths.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-success-soft px-3 py-2 text-sm leading-relaxed text-text-secondary"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {titleEval.weaknesses.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-text">标题不足</h3>
                <ul className="space-y-1.5">
                  {titleEval.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-lg bg-danger-soft px-3 py-2 text-sm leading-relaxed text-text-secondary"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {titleEval.alternativeTitles.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-text">吸睛备选标题</h3>
                <p className="mb-2 text-xs text-text-muted">点一条即可用它替换当前脚本的标题</p>
                <ul className="space-y-1.5">
                  {titleEval.alternativeTitles.map((t, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="group flex w-full items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-left text-sm leading-relaxed text-text transition-colors hover:border-warning/60"
                        onClick={() => {
                          if (selectedScript) {
                            updateScript(selectedScript.id, { title: t });
                          }
                        }}
                      >
                        <span className="num inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface text-xs font-semibold text-text-secondary">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">{t}</span>
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 关联选题弹窗 */}
      <Modal
        open={!!(showPairDialog)}
        onClose={() => setShowPairDialog(false)}
        size="sm"
        title="关联选题"
        description="选好之后这条脚本会挂到该选题下，方便在选题看板里回看"
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setShowPairDialog(false)}>
              取消
            </Button>
            <Button variant="primary" size="md" onClick={handleConfirmPair}>
              创建
            </Button>
          </>
        }
      >
        <Field label="选择这个脚本属于哪个选题">
          <Select value={pairTopicId} onChange={(e) => setPairTopicId(e.target.value)}>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </Select>
        </Field>
      </Modal>
      <ConfirmDialog
        open={deleteConfirmOpen}
        title="删除这个脚本？"
        description={selectedScript ? `「${currentTopic?.title ?? '未关联选题'}」脚本将从本机移除。` : ''}
        confirmLabel="删除脚本"
        pending={deletingScript}
        onConfirm={() => void handleDeleteScript()}
        onClose={() => setDeleteConfirmOpen(false)}
      />
      <ConfirmDialog
        open={overwriteConfirmOpen}
        title="用 AI 生成内容替换当前分镜？"
        description={`当前脚本有 ${selectedScript?.storyboards.length ?? 0} 个分镜${selectedScript?.hook.trim() ? '及开场钩子' : ''}。重新生成会替换它们，无法自动撤销；如需保留，请先复制到备注或先导出备份。`}
        confirmLabel="确认替换并生成"
        pending={genLoading}
        onConfirm={() => void doGenerateScript(true)}
        onClose={() => { if (!genLoading) setOverwriteConfirmOpen(false); }}
      />
      <Modal
        open={historyOpen}
        onClose={() => { if (!restoringRevisionId) setHistoryOpen(false); }}
        size="lg"
        title="脚本版本历史"
        description="历史版本保存在本机并随账号云同步，最多保留 50 个；恢复前会自动保存当前内容。"
      >
        <div className="space-y-3">
          {!selectedScript?.history?.length ? (
            <EmptyState title="还没有脚本快照" description="点击脚本顶部的「保存版本」，或重新生成 AI 脚本前，系统会保存快照。" compact />
          ) : [...selectedScript.history].reverse().map((revision) => (
            <article key={revision.id} className="rounded-xl border border-border bg-surface-muted/40 p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><Badge variant="neutral" size="sm">{revision.label}</Badge><span className="text-[11px] text-text-muted">{new Date(revision.savedAt).toLocaleString('zh-CN')}</span></div>
                  <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-text">{revision.title || currentTopic?.title || '无标题脚本'}</h3>
                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{revision.hook || '没有开场钩子'} · {revision.storyboards.length} 个分镜</p>
                  <div className="mt-1 text-[11px] text-text-muted">{revision.storyboards.reduce((sum, board) => sum + board.duration, 0)} 秒 · {revision.storyboards.reduce((sum, board) => sum + board.dialogue.length + board.description.length, 0)} 字</div>
                </div>
                <Button size="sm" variant="secondary" loading={restoringRevisionId === revision.id} onClick={async () => {
                  if (!selectedScript) return;
                  setRestoringRevisionId(revision.id);
                  try {
                    await restoreRevision(selectedScript.id, revision.id);
                    toast.success('已恢复此脚本版本；恢复前内容也已自动保存为快照');
                    setHistoryOpen(false);
                  } catch (error) {
                    toast.error(`恢复版本失败：${(error as Error).message}`);
                  } finally {
                    setRestoringRevisionId(null);
                  }
                }}>恢复版本</Button>
              </div>
            </article>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function StoryboardCard({
  board,
  onUpdate,
  onDelete,
}: {
  board: Storyboard;
  onUpdate: (updates: Partial<Storyboard>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card overflow-hidden">
      <div
        className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-contrast">
          {board.sceneNumber}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="truncate text-xs text-text-secondary">
            {board.dialogue || board.description || '点击编辑分镜内容'}
          </span>
          <Badge variant="neutral" size="sm">
            <span className="num">{board.duration}</span>s
          </Badge>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
        <Button
          variant="dangerGhost"
          size="xs"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          删除
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border bg-surface-muted/40 p-3.5">
          <Field label="画面描述">
            <Textarea
              value={board.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="这个镜头里发生什么？画面构图、动作..."
              rows={2}
            />
          </Field>

          <Field label="台词 / 旁白">
            <Textarea
              value={board.dialogue}
              onChange={(e) => onUpdate({ dialogue: e.target.value })}
              placeholder="这个镜头要说的话..."
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="时长（秒）">
              <Input
                type="number"
                value={board.duration}
                onChange={(e) => onUpdate({ duration: Number(e.target.value) || 0 })}
                className="num"
                min={1}
              />
            </Field>

            <Field label="视觉方向">
              <Input
                type="text"
                value={board.visualDirection}
                onChange={(e) => onUpdate({ visualDirection: e.target.value })}
                placeholder="录屏 / 实拍 / 素材..."
              />
            </Field>
          </div>

          <Field label="备注">
            <Input
              type="text"
              value={board.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="特效、BGM、注意事项..."
            />
          </Field>
        </div>
      )}
    </div>
  );
}
