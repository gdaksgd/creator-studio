import { useEffect, useState } from 'react';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { useAssetStore } from '../store/assetStore';
import { api } from '../api/client';
import type { Script, MaterialPlan, SceneMaterialAnalysis, SceneMaterialCategory, MaterialRecommendation, MaterialType, LibraryAssetType, Topic } from '../types';
import { categoryBadge, categoryEmoji, categoryLabel } from '../config/categories';
import { cn } from '../utils/cn';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, Select } from '../components/ui/Input';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { LoadingBlock } from '../components/ui/Spinner';
import { ArrowLeft, Images, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import { useToast } from '../components/ui/Toast';

function inferLibraryType(url: string): LibraryAssetType {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image';
  if (/\.(mp4|mov|webm|m3u8)$/.test(path) || /bilibili\.com|youtube\.com|youtu\.be|douyin\.com/.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(path)) return 'audio';
  return 'link';
}

const MATERIAL_META: Record<MaterialType, { label: string; icon: string; color: string; bg: string; border: string; text: string }> = {
  bgm: { label: 'BGM', icon: '🎵', color: 'emerald', bg: 'bg-success-soft', border: 'border-success/30', text: 'text-success' },
  sfx: { label: '音效', icon: '🔊', color: 'blue', bg: 'bg-info-soft', border: 'border-info/30', text: 'text-info' },
  meme: { label: '表情包', icon: '😂', color: 'orange', bg: 'bg-warning-soft', border: 'border-warning/30', text: 'text-warning' },
  animation: { label: '动画素材', icon: '✨', color: 'purple', bg: 'bg-primary-soft', border: 'border-primary/30', text: 'text-primary' },
};

/**
 * 入场动效只给列表前 8 项。
 *
 * 依据：`stagger-children` 给每个子元素都挂上 `ui-rise`（opacity + translateY，0.5s），
 * 每个动画元素都要占一层合成，选题数量没有上限（用户数据），几十上百张卡片同时
 * 起跑会让首屏绘制掉帧。前 8 项保留错落入场（延迟 0.02 + i*0.04，与旧
 * `stagger-children` 的节奏一致），第 9 项起静态渲染，观感几乎无差别。
 * `.card-hover` 只声明 transition、不动画，指针不悬停就没有开销，保持原样。
 */
const STAGGER_LIMIT = 8;

const entranceClass = (i: number) => (i < STAGGER_LIMIT ? 'anim-rise' : undefined);
const entranceDelay = (i: number) =>
  i < STAGGER_LIMIT ? { animationDelay: `${(0.02 + i * 0.04).toFixed(2)}s` } : undefined;

export default function Materials() {
  const { topics, loading, loadTopics, updateTopic } = useTopicStore();
  const { scripts, loadScripts } = useScriptStore();
  const { loadAssets, addAsset, findDuplicate } = useAssetStore();
  const toast = useToast();
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTopics();
    loadScripts();
    loadAssets();
  }, [loadTopics, loadScripts, loadAssets]);

  const topicsWithScripts = topics.filter((t) => {
    const topicScripts = scripts.filter((s) => s.topicId === t.id);
    return topicScripts.some((s) => s.storyboards.length > 0);
  });

  const selectedTopic = topics.find((t) => t.id === selectedTopicId) || null;
  const selectedTopicScripts = selectedTopic
    ? scripts.filter((s) => s.topicId === selectedTopic.id && s.storyboards.length > 0)
    : [];
  const selectedScript = selectedTopicScripts.find((s) => s.id === selectedScriptId) || selectedTopicScripts[0] || null;

  // ===== 分析素材 =====
  const handleAnalyze = async () => {
    if (!selectedTopic || !selectedScript) return;
    setAnalyzing(true);
    setError('');
    try {
      const result = await api.analyzeMaterials({
        topicTitle: selectedTopic.title,
        category: selectedTopic.category,
        productionIdea: selectedTopic.productionIdea,
        gameDescription: selectedTopic.gameDescription,
        scriptTitle: selectedScript.title,
        hook: selectedScript.hook,
        storyboards: selectedScript.storyboards,
      });

      if (!result.scenes || result.scenes.length === 0) {
        setError('AI 分析返回了空结果，可能是分镜过多导致响应被截断。请尝试减少分镜数量或重新分析。');
        return;
      }

      const plan: MaterialPlan = {
        scenes: result.scenes,
        analyzedAt: Date.now(),
        scriptId: selectedScript.id,
      };
      await updateTopic(selectedTopic.id, { materialPlan: plan });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  // ===== 切换素材选用状态 =====
  const toggleMaterial = async (
    sceneNumber: number,
    materialType: MaterialType,
    recIndex: number
  ) => {
    if (!selectedTopic || !selectedTopic.materialPlan) return;
    const newPlan: MaterialPlan = {
      ...selectedTopic.materialPlan,
      scenes: selectedTopic.materialPlan.scenes.map((scene) => {
        if (scene.sceneNumber !== sceneNumber) return scene;
        const category = scene[materialType];
        const newRecs = category.recommendations.map((rec, i) =>
          i === recIndex ? { ...rec, selected: !rec.selected } : rec
        );
        return { ...scene, [materialType]: { ...category, recommendations: newRecs } };
      }),
    };
    await updateTopic(selectedTopic.id, { materialPlan: newPlan });
  };

  const saveRecommendation = async (topic: Topic, rec: MaterialRecommendation, type: MaterialType) => {
    const link = rec.searchLinks[0];
    if (!link) {
      toast.info('这条建议没有来源链接；可在素材库手动添加可用 URL。');
      return;
    }
    try {
      await addAsset({
        title: rec.title,
        type: inferLibraryType(link.url),
        url: link.url,
        category: topic.category,
        tags: [MATERIAL_META[type].label],
        note: [rec.description, rec.reason, `场景素材建议：${rec.source}`].filter(Boolean).join(' · '),
      });
      toast.success('已收藏到素材库');
    } catch (err) {
      toast.info((err as Error).message || '该链接已收藏');
    }
  };

  // ===== 统计已选素材 =====
  const getSelectedCount = (plan: MaterialPlan) => {
    let count = 0;
    plan.scenes.forEach((scene) => {
      (['bgm', 'sfx', 'meme', 'animation'] as MaterialType[]).forEach((type) => {
        count += scene[type].recommendations.filter((r) => r.selected).length;
      });
    });
    return count;
  };

  // ===== 渲染 =====
  // 页面头在加载 / 列表 / 详情三种视图之间共用，避免标题与说明重复书写
  const pageHeader = (
    <PageHeader
      eyebrow="创作台 / MATERIALS"
      title="素材工坊"
      description="选择已有脚本的选题，AI 帮你分析每个分镜需要的 BGM、音效、表情包和动画素材"
    />
  );

  if (loading) {
    return (
      <div>
        {pageHeader}
        <LoadingBlock label="正在读取本地选题…" />
      </div>
    );
  }

  // --- 列表视图 ---
  if (!selectedTopic) {
    return (
      <div>
        {pageHeader}

        <SectionHeading title="可分析的选题" hint={`${topicsWithScripts.length} 个`} />

        {topicsWithScripts.length === 0 ? (
          <EmptyState
            icon={<Images className="h-5 w-5" />}
            title="暂无可用选题"
            description="需要先在选题看板创建选题，并在脚本编辑里加上分镜，这里才能生成素材方案。"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {topicsWithScripts.map((topic, index) => {
              const topicScripts = scripts.filter((s) => s.topicId === topic.id && s.storyboards.length > 0);
              const hasPlan = !!topic.materialPlan;
              const selectedCount = topic.materialPlan ? getSelectedCount(topic.materialPlan) : 0;
              const storyboardCount = topicScripts.reduce((sum, s) => sum + s.storyboards.length, 0);
              return (
                <button
                  key={topic.id}
                  onClick={() => {
                    setSelectedTopicId(topic.id);
                    const firstScript = topicScripts[0];
                    setSelectedScriptId(firstScript?.id || '');
                  }}
                  className={cn(
                    'card card-hover group flex flex-col overflow-hidden p-0 text-left',
                    entranceClass(index),
                  )}
                  style={entranceDelay(index)}
                >
                  {/* 封面位：数据里没有图片字段，用品牌柔光底 + 品类符号做视觉区分，不编造素材图 */}
                  <div className="relative aspect-video overflow-hidden bg-brand-soft">
                    <div className="texture-grid absolute inset-0" aria-hidden="true" />
                    <span
                      className="absolute inset-0 flex items-center justify-center text-4xl transition-transform duration-300 group-hover:scale-[1.03]"
                      aria-hidden="true"
                    >
                      {categoryEmoji(topic.category)}
                    </span>
                    {hasPlan && (
                      <Badge variant="success" size="sm" className="absolute right-3 top-3 shadow-xs">
                        已分析
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <span className={`mb-2 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs ${categoryBadge(topic.category)}`}>
                      {categoryEmoji(topic.category)} {categoryLabel(topic.category)}
                    </span>
                    <h3 className="truncate text-sm font-medium tracking-tight text-text">{topic.title}</h3>
                    <p className="mt-1.5 text-xs text-text-muted">
                      <span className="num">{topicScripts.length}</span> 个脚本 ·{' '}
                      <span className="num">{storyboardCount}</span> 个分镜
                    </p>
                    {hasPlan && (
                      <p className="mt-auto pt-2 text-xs font-medium text-success">
                        已选用 <span className="num">{selectedCount}</span> 个素材
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // --- 详情视图 ---
  return (
    <div>
      {pageHeader}

      {/* 顶部导航 */}
      <div className="mb-4 flex items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelectedTopicId(null);
            setSelectedScriptId('');
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          返回列表
        </Button>
      </div>

      <SectionHeading title="分析素材需求" hint="按分镜逐条给出 BGM / 音效 / 表情包 / 动画建议" />

      {/* 选题标题 + 脚本选择 */}
      <Card padding="lg" className="mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${categoryBadge(selectedTopic.category)}`}>
              {categoryEmoji(selectedTopic.category)} {categoryLabel(selectedTopic.category)}
            </span>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-text">{selectedTopic.title}</h2>
          </div>
          <Button
            onClick={handleAnalyze}
            disabled={!selectedScript}
            loading={analyzing}
            className="shrink-0"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {analyzing ? 'AI 分析中...' : selectedTopic.materialPlan ? '重新分析素材' : 'AI 分析素材需求'}
          </Button>
        </div>

        {/* 脚本选择器 */}
        {selectedTopicScripts.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Field label="选择脚本" htmlFor="materials-script" className="w-full min-w-0 sm:w-72">
              <Select
                id="materials-script"
                value={selectedScriptId}
                onChange={(e) => setSelectedScriptId(e.target.value)}
              >
                {selectedTopicScripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.platform === 'bilibili' ? 'B站' : '抖音'} - {s.version === 'long' ? '长版' : '短版'}
                    {s.title ? ` · ${s.title}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedScript && (
              <span className="text-xs text-text-muted">
                <span className="num">{selectedScript.storyboards.length}</span> 个分镜
              </span>
            )}
          </div>
        )}
      </Card>

      {/* 错误提示 */}
      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-xs text-danger">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 leading-relaxed">{error}</span>
        </div>
      )}

      {/* 分析中提示 */}
      {analyzing && (
        <LoadingBlock label="AI 正在分析每个分镜的素材需求，可能需要 10-20 秒..." />
      )}

      {/* 素材方案展示 */}
      {!analyzing && selectedTopic.materialPlan && selectedScript && (
        <MaterialPlanView
          plan={selectedTopic.materialPlan}
          script={selectedScript}
          onToggle={toggleMaterial}
          onSave={(rec, type) => saveRecommendation(selectedTopic, rec, type)}
          isSaved={(rec, _type) => rec.searchLinks.some((link) => !!findDuplicate(link.url, inferLibraryType(link.url)))}
        />
      )}

      {/* 空状态 */}
      {!analyzing && !selectedTopic.materialPlan && !error && (
        <EmptyState
          icon={<Wand2 className="h-5 w-5" />}
          title="还没有素材方案"
          description="点击右上角「AI 分析素材需求」开始"
          action={
            <Button onClick={handleAnalyze} disabled={!selectedScript}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              AI 分析素材需求
            </Button>
          }
        />
      )}
    </div>
  );
}

// ===== 素材方案展示组件 =====
function MaterialPlanView({
  plan,
  script,
  onToggle,
  onSave,
  isSaved,
}: {
  plan: MaterialPlan;
  script: Script;
  onToggle: (sceneNumber: number, materialType: MaterialType, recIndex: number) => void;
  onSave: (rec: MaterialRecommendation, type: MaterialType) => void;
  isSaved: (rec: MaterialRecommendation, type: MaterialType) => boolean;
}) {
  // 将AI分析的场景与实际分镜对应
  const storyboards = script.storyboards;

  return (
    <div>
      <SectionHeading
        title="素材方案"
        hint={`分析于 ${new Date(plan.analyzedAt).toLocaleString('zh-CN')}`}
        action={
          <Badge variant="success" size="lg">
            已选用 <span className="num">{getSelectedCountInPlan(plan)}</span> 个素材
          </Badge>
        }
      />

      {/* 场景列表 */}
      <div className="stagger-children space-y-5">
        {plan.scenes.map((scene) => {
          const storyboard = storyboards.find((sb) => sb.sceneNumber === scene.sceneNumber);
          return (
            <SceneCard
              key={scene.sceneNumber}
              scene={scene}
              duration={storyboard?.duration}
              onToggle={onToggle}
              onSave={onSave}
              isSaved={isSaved}
            />
          );
        })}
      </div>
    </div>
  );
}

function getSelectedCountInPlan(plan: MaterialPlan): number {
  let count = 0;
  plan.scenes.forEach((scene) => {
    (['bgm', 'sfx', 'meme', 'animation'] as MaterialType[]).forEach((type) => {
      count += scene[type].recommendations.filter((r) => r.selected).length;
    });
  });
  return count;
}

// ===== 单个场景卡片 =====
function SceneCard({
  scene,
  duration,
  onToggle,
  onSave,
  isSaved,
}: {
  scene: SceneMaterialAnalysis;
  duration?: number;
  onToggle: (sceneNumber: number, materialType: MaterialType, recIndex: number) => void;
  onSave: (rec: MaterialRecommendation, type: MaterialType) => void;
  isSaved: (rec: MaterialRecommendation, type: MaterialType) => boolean;
}) {
  return (
    <div className="card overflow-hidden">
      {/* 场景标题 */}
      <div className="border-b border-border bg-surface-muted px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
            {scene.sceneNumber}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text line-clamp-1">{scene.sceneDescription}</p>
            {scene.dialogue && (
              <p className="text-xs text-text-secondary line-clamp-1 mt-0.5">💬 {scene.dialogue}</p>
            )}
          </div>
          {duration && (
            <Badge variant="neutral" size="sm" className="num shrink-0">
              {duration}s
            </Badge>
          )}
        </div>
      </div>

      {/* 四种素材类型 */}
      <div className="divide-y divide-border">
        {(['bgm', 'sfx', 'meme', 'animation'] as MaterialType[]).map((type) => {
          const category = scene[type];
          if (!category.needed) {
            return (
              <div key={type} className="flex items-center gap-2.5 px-4 py-3 text-xs text-text-muted">
                <span className="text-base opacity-40" aria-hidden="true">{MATERIAL_META[type].icon}</span>
                <span>{MATERIAL_META[type].label}</span>
                <span>— 不需要</span>
              </div>
            );
          }
          return (
            <MaterialCategorySection
              key={type}
              type={type}
              category={category}
              sceneNumber={scene.sceneNumber}
              onToggle={onToggle}
              onSave={onSave}
              isSaved={isSaved}
            />
          );
        })}
      </div>
    </div>
  );
}

// ===== 素材分类区块 =====
function MaterialCategorySection({
  type,
  category,
  sceneNumber,
  onToggle,
  onSave,
  isSaved,
}: {
  type: MaterialType;
  category: SceneMaterialCategory;
  sceneNumber: number;
  onToggle: (sceneNumber: number, materialType: MaterialType, recIndex: number) => void;
  onSave: (rec: MaterialRecommendation, type: MaterialType) => void;
  isSaved: (rec: MaterialRecommendation, type: MaterialType) => boolean;
}) {
  const meta = MATERIAL_META[type];
  return (
    <div className="px-4 py-4">
      {/* 类型标题 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-base" aria-hidden="true">{meta.icon}</span>
        <span className={`text-sm font-medium ${meta.text}`}>{meta.label}</span>
        {category.mood && (
          <Badge variant="neutral" size="sm" className={`${meta.bg} ${meta.text} border-transparent`}>
            {category.mood}
          </Badge>
        )}
        {category.keywords && (
          <span className="text-xs text-text-muted">搜索：{category.keywords}</span>
        )}
      </div>

      {/* 推荐素材列表 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {category.recommendations
          .map((rec, originalIndex) => ({ rec, originalIndex }))
          .sort((a, b) => (b.rec.isOfficial ? 1 : 0) - (a.rec.isOfficial ? 1 : 0))
          .map(({ rec, originalIndex }, sortedIndex) => (
          <RecommendationCard
            key={sortedIndex}
            rec={rec}
            meta={meta}
            selected={rec.selected}
            onToggle={() => onToggle(sceneNumber, type, originalIndex)}
            onSave={() => onSave(rec, type)}
            isSaved={isSaved(rec, type)}
          />
        ))}
      </div>
    </div>
  );
}

// ===== 推荐素材卡片 =====
function RecommendationCard({
  rec,
  meta,
  selected,
  onToggle,
  onSave,
  isSaved,
}: {
  rec: MaterialRecommendation;
  meta: typeof MATERIAL_META[MaterialType];
  selected: boolean;
  onToggle: () => void;
  onSave: () => void;
  isSaved: boolean;
}) {
  const isOfficial = rec.isOfficial === true;
  const animeSrc = rec.animeSource;

  return (
    <div
      className={`rounded-xl border p-3.5 transition-colors ${
        selected
          ? `${meta.border} ${meta.bg} ring-1 ring-current`
          : isOfficial
            ? 'border-warning/30 bg-warning-soft/50 hover:border-warning'
            : 'border-border bg-surface hover:border-border-strong'
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isOfficial && (
            <Badge variant="warning" size="sm" className="shrink-0">
              官方动画
            </Badge>
          )}
          <h4 className={`truncate text-sm font-medium tracking-tight ${selected ? meta.text : isOfficial ? 'text-warning' : 'text-text'}`}>
            {rec.title}
          </h4>
        </div>
        <Button
          variant={selected ? 'soft' : 'secondary'}
          size="xs"
          aria-pressed={selected}
          onClick={onToggle}
          className={`shrink-0 rounded-full ${
            selected ? `border ${meta.border} ${meta.bg} ${meta.text}` : ''
          }`}
        >
          {selected ? '✓ 已选用' : '选用'}
        </Button>
      </div>

      {/* 动画出处信息 */}
      {isOfficial && animeSrc && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-xs leading-relaxed">
          <span className="text-warning" aria-hidden="true">🎬</span>
          <span className="font-medium text-warning">{animeSrc.series}</span>
          <span className="text-warning">·</span>
          <span className="text-warning">{animeSrc.episode}</span>
          {animeSrc.timestamp && (
            <>
              <span className="text-warning">·</span>
              <span className="num text-warning">{animeSrc.timestamp}</span>
            </>
          )}
        </div>
      )}

      {rec.description && (
        <p className="mb-1.5 text-xs leading-relaxed text-text-secondary">{rec.description}</p>
      )}
      {rec.reason && (
        <p className="mb-2 text-xs italic leading-relaxed text-text-secondary">💡 {rec.reason}</p>
      )}

      {/* 搜索链接 */}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant={isSaved ? 'soft' : 'ghost'} size="xs" disabled={isSaved} onClick={onSave}>{isSaved ? '已收藏' : '收藏到素材库'}</Button>
        {rec.searchLinks.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
              isOfficial
                ? 'border-warning/30 bg-warning-soft text-warning hover:border-warning'
                : 'border-border bg-surface text-text hover:border-primary/40 hover:text-primary'
            }`}
          >
            🔗 {link.platform}
          </a>
        ))}
      </div>
    </div>
  );
}
