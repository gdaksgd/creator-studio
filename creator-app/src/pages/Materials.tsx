import { useEffect, useState } from 'react';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { api } from '../api/client';
import type { Script, MaterialPlan, SceneMaterialAnalysis, SceneMaterialCategory, MaterialRecommendation, MaterialType } from '../types';
import { categoryBadge, categoryEmoji, categoryLabel } from '../config/categories';

const MATERIAL_META: Record<MaterialType, { label: string; icon: string; color: string; bg: string; border: string; text: string }> = {
  bgm: { label: 'BGM', icon: '🎵', color: 'emerald', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  sfx: { label: '音效', icon: '🔊', color: 'blue', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
  meme: { label: '表情包', icon: '😂', color: 'orange', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
  animation: { label: '动画素材', icon: '✨', color: 'purple', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
};

export default function Materials() {
  const { topics, loading, loadTopics, updateTopic } = useTopicStore();
  const { scripts, loadScripts } = useScriptStore();
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTopics();
    loadScripts();
  }, [loadTopics, loadScripts]);

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
  if (loading) {
    return <div className="text-center py-20 text-text-secondary">加载中...</div>;
  }

  // --- 列表视图 ---
  if (!selectedTopic) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">素材工坊</h1>
          <p className="text-text-secondary text-sm">
            选择已有脚本的选题，AI 帮你分析每个分镜需要的 BGM、音效、表情包和动画素材
          </p>
        </div>

        {topicsWithScripts.length === 0 ? (
          <div className="text-center py-20 text-text-secondary">
            <p className="text-lg mb-2">暂无可用选题</p>
            <p className="text-sm">需要先在选题看板创建选题，并在脚本编辑中添加分镜</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topicsWithScripts.map((topic) => {
              const topicScripts = scripts.filter((s) => s.topicId === topic.id && s.storyboards.length > 0);
              const hasPlan = !!topic.materialPlan;
              const selectedCount = topic.materialPlan ? getSelectedCount(topic.materialPlan) : 0;
              return (
                <button
                  key={topic.id}
                  onClick={() => {
                    setSelectedTopicId(topic.id);
                    const firstScript = topicScripts[0];
                    setSelectedScriptId(firstScript?.id || '');
                  }}
                  className="text-left bg-surface border border-border rounded-xl p-5 hover:border-primary hover:shadow-md transition-all"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${categoryBadge(topic.category)}`}>
                      {categoryEmoji(topic.category)} {categoryLabel(topic.category)}
                    </span>
                    {hasPlan && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                        已分析
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-base mb-1 line-clamp-2">{topic.title}</h3>
                  <p className="text-sm text-text-secondary mb-3">
                    {topicScripts.length} 个脚本 · {topicScripts.reduce((sum, s) => sum + s.storyboards.length, 0)} 个分镜
                  </p>
                  {hasPlan && (
                    <p className="text-xs text-green-600 font-medium">
                      已选用 {selectedCount} 个素材
                    </p>
                  )}
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
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => {
            setSelectedTopicId(null);
            setSelectedScriptId('');
          }}
          className="text-text-secondary hover:text-text text-sm flex items-center gap-1"
        >
          ← 返回列表
        </button>
      </div>

      {/* 选题标题 + 脚本选择 */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full border ${categoryBadge(selectedTopic.category)}`}>
                {categoryEmoji(selectedTopic.category)} {categoryLabel(selectedTopic.category)}
              </span>
            </div>
            <h2 className="text-xl font-bold">{selectedTopic.title}</h2>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !selectedScript}
            className="px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {analyzing ? 'AI 分析中...' : selectedTopic.materialPlan ? '重新分析素材' : 'AI 分析素材需求'}
          </button>
        </div>

        {/* 脚本选择器 */}
        {selectedTopicScripts.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-secondary">选择脚本：</span>
            <select
              value={selectedScriptId}
              onChange={(e) => setSelectedScriptId(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-surface"
            >
              {selectedTopicScripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.platform === 'bilibili' ? 'B站' : '抖音'} - {s.version === 'long' ? '长版' : '短版'}
                  {s.title ? ` · ${s.title}` : ''}
                </option>
              ))}
            </select>
            {selectedScript && (
              <span className="text-xs text-text-secondary">
                {selectedScript.storyboards.length} 个分镜
              </span>
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-5 text-sm">
          {error}
        </div>
      )}

      {/* 分析中提示 */}
      {analyzing && (
        <div className="text-center py-16">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mb-4"></div>
          <p className="text-text-secondary">AI 正在分析每个分镜的素材需求，可能需要 10-20 秒...</p>
        </div>
      )}

      {/* 素材方案展示 */}
      {!analyzing && selectedTopic.materialPlan && selectedScript && (
        <MaterialPlanView
          plan={selectedTopic.materialPlan}
          script={selectedScript}
          onToggle={toggleMaterial}
        />
      )}

      {/* 空状态 */}
      {!analyzing && !selectedTopic.materialPlan && !error && (
        <div className="text-center py-20 text-text-secondary">
          <p className="text-lg mb-2">还没有素材方案</p>
          <p className="text-sm">点击右上角"AI 分析素材需求"开始</p>
        </div>
      )}
    </div>
  );
}

// ===== 素材方案展示组件 =====
function MaterialPlanView({
  plan,
  script,
  onToggle,
}: {
  plan: MaterialPlan;
  script: Script;
  onToggle: (sceneNumber: number, materialType: MaterialType, recIndex: number) => void;
}) {
  // 将AI分析的场景与实际分镜对应
  const storyboards = script.storyboards;

  return (
    <div>
      {/* 统计栏 */}
      <div className="flex items-center gap-4 mb-5 text-sm">
        <span className="text-text-secondary">
          分析于 {new Date(plan.analyzedAt).toLocaleString('zh-CN')}
        </span>
        <span className="text-text-secondary">|</span>
        <span className="font-medium text-green-600">
          已选用 {getSelectedCountInPlan(plan)} 个素材
        </span>
      </div>

      {/* 场景列表 */}
      <div className="space-y-5">
        {plan.scenes.map((scene) => {
          const storyboard = storyboards.find((sb) => sb.sceneNumber === scene.sceneNumber);
          return (
            <SceneCard
              key={scene.sceneNumber}
              scene={scene}
              duration={storyboard?.duration}
              onToggle={onToggle}
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
}: {
  scene: SceneMaterialAnalysis;
  duration?: number;
  onToggle: (sceneNumber: number, materialType: MaterialType, recIndex: number) => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* 场景标题 */}
      <div className="bg-gray-50 border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-white text-sm font-bold">
            {scene.sceneNumber}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium text-text line-clamp-1">{scene.sceneDescription}</p>
            {scene.dialogue && (
              <p className="text-xs text-text-secondary line-clamp-1 mt-0.5">💬 {scene.dialogue}</p>
            )}
          </div>
          {duration && (
            <span className="text-xs text-text-secondary bg-gray-100 px-2 py-0.5 rounded">
              {duration}s
            </span>
          )}
        </div>
      </div>

      {/* 四种素材类型 */}
      <div className="divide-y divide-border">
        {(['bgm', 'sfx', 'meme', 'animation'] as MaterialType[]).map((type) => {
          const category = scene[type];
          if (!category.needed) {
            return (
              <div key={type} className="px-5 py-3 flex items-center gap-3 text-text-secondary text-sm">
                <span className="text-lg opacity-40">{MATERIAL_META[type].icon}</span>
                <span className="opacity-60">{MATERIAL_META[type].label}</span>
                <span className="text-xs">— 不需要</span>
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
}: {
  type: MaterialType;
  category: SceneMaterialCategory;
  sceneNumber: number;
  onToggle: (sceneNumber: number, materialType: MaterialType, recIndex: number) => void;
}) {
  const meta = MATERIAL_META[type];
  return (
    <div className="px-5 py-4">
      {/* 类型标题 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{meta.icon}</span>
        <span className={`text-sm font-medium ${meta.text}`}>{meta.label}</span>
        {category.mood && (
          <span className={`text-xs ${meta.bg} ${meta.text} px-2 py-0.5 rounded-full`}>
            {category.mood}
          </span>
        )}
        {category.keywords && (
          <span className="text-xs text-text-secondary">搜索: {category.keywords}</span>
        )}
      </div>

      {/* 推荐素材列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
}: {
  rec: MaterialRecommendation;
  meta: typeof MATERIAL_META[MaterialType];
  selected: boolean;
  onToggle: () => void;
}) {
  const isOfficial = rec.isOfficial === true;
  const animeSrc = rec.animeSource;

  return (
    <div
      className={`border rounded-lg p-3 transition-all ${
        selected
          ? `${meta.border} ${meta.bg} ring-1 ring-current`
          : isOfficial
            ? 'border-amber-300 bg-amber-50/50 hover:border-amber-400'
            : 'border-border bg-surface hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isOfficial && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 font-medium whitespace-nowrap flex-shrink-0">
              官方动画
            </span>
          )}
          <h4 className={`text-sm font-medium ${selected ? meta.text : isOfficial ? 'text-amber-800' : 'text-text'}`}>
            {rec.title}
          </h4>
        </div>
        <button
          onClick={onToggle}
          className={`text-xs px-2 py-1 rounded-full border transition-colors whitespace-nowrap flex-shrink-0 ${
            selected
              ? `${meta.bg} ${meta.text} ${meta.border}`
              : 'bg-gray-50 text-text-secondary border-gray-200 hover:bg-gray-100'
          }`}
        >
          {selected ? '✓ 已选用' : '选用'}
        </button>
      </div>

      {/* 动画出处信息 */}
      {isOfficial && animeSrc && (
        <div className="flex items-center gap-2 mb-2 text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          <span className="text-amber-600">🎬</span>
          <span className="text-amber-800 font-medium">{animeSrc.series}</span>
          <span className="text-amber-600">·</span>
          <span className="text-amber-700">{animeSrc.episode}</span>
          {animeSrc.timestamp && (
            <>
              <span className="text-amber-600">·</span>
              <span className="text-amber-700">{animeSrc.timestamp}</span>
            </>
          )}
        </div>
      )}

      {rec.description && (
        <p className="text-xs text-text-secondary mb-1.5">{rec.description}</p>
      )}
      {rec.reason && (
        <p className="text-xs text-text-secondary italic mb-2">💡 {rec.reason}</p>
      )}

      {/* 搜索链接 */}
      <div className="flex flex-wrap gap-1.5">
        {rec.searchLinks.map((link, i) => (
          <a
            key={i}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              isOfficial
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:border-amber-300'
                : 'bg-gray-50 text-blue-600 border-gray-200 hover:bg-blue-50 hover:border-blue-200'
            }`}
          >
            🔗 {link.platform}
          </a>
        ))}
      </div>
    </div>
  );
}
