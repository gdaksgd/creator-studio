import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useScriptStore } from '../store/scriptStore';
import { useTopicStore } from '../store/topicStore';
import { api, type ScriptSuggestion } from '../api/client';
import type { Platform, Storyboard, IdeaEvaluation, TitleEvaluation } from '../types';
import { categoryLabel } from '../config/categories';

const PLATFORM_LABELS: Record<Platform, string> = {
  bilibili: 'B站',
  douyin: '抖音',
};

const VERSION_LABELS: Record<string, string> = {
  long: '长版',
  short: '短版',
};

export default function ScriptEditor() {
  const { scriptId } = useParams<{ scriptId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { scripts, loadScripts, createScript, updateScript, addStoryboard, removeStoryboard, updateStoryboard, deleteScript } = useScriptStore();
  const { topics, loadTopics, updateTopic } = useTopicStore();

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

  const handleCreateNew = () => {
    if (topics.length === 0) return;
    setPairTopicId(topics[0].id);
    setShowPairDialog(true);
  };

  const handleConfirmPair = async () => {
    if (!pairTopicId) return;
    const script = await createScript(pairTopicId, 'bilibili', 'long');
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
    await addStoryboard(selectedScript.id);
  };

  const handleDeleteScript = async () => {
    if (!selectedScript) return;
    if (!confirm('确定删除这个脚本吗？')) return;
    await deleteScript(selectedScript.id);
    setSelectedScriptId(null);
    navigate('/scripts', { replace: true });
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

  const doGenerateScript = async () => {
    if (!selectedScript || !currentTopic) return;
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
      if (result.hook) {
        await updateScript(selectedScript.id, { hook: result.hook });
      }
      if (result.storyboards.length > 0) {
        for (const board of result.storyboards) {
          await addStoryboard(selectedScript.id);
          const script = useScriptStore.getState().scripts.find((s) => s.id === selectedScript.id);
          if (script) {
            const lastBoard = script.storyboards[script.storyboards.length - 1];
            if (lastBoard) {
              await updateStoryboard(selectedScript.id, lastBoard.id, {
                description: board.description,
                dialogue: board.dialogue,
                duration: board.duration,
                visualDirection: board.visualDirection,
                notes: board.notes,
              });
            }
          }
        }
        alert('AI 脚本框架已生成！');
      }
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

  if (scripts.length === 0 && topics.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3">📝</div>
        <p className="text-text-secondary mb-4">还没有脚本，先去选题看板添加选题再开始写脚本</p>
        <button
          onClick={() => navigate('/')}
          className="text-primary text-sm font-medium hover:underline"
        >
          前往选题看板
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-text">脚本编辑器</h1>
        <div className="flex gap-2">
          {selectedScript && currentTopic && (
            <>
              <button
                onClick={() => handleEvaluateTitle()}
                disabled={titleEvalLoading}
                className="px-3 py-1.5 text-xs font-medium text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors disabled:opacity-50"
              >
                {titleEvalLoading ? '分析标题...' : '标题评估'}
              </button>
              <button
                onClick={handleAiGenerate}
                disabled={genLoading}
                className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {genLoading ? '生成中...' : 'AI 生成脚本'}
              </button>
              <button
                onClick={handleAiSuggest}
                disabled={aiLoading}
                className="px-3 py-1.5 text-xs font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50"
              >
                {aiLoading ? '分析中...' : 'AI 建议'}
              </button>
              <button
                onClick={() => handleCreateVersion('short', 'douyin')}
                className="px-3 py-1.5 text-xs font-medium border border-primary/30 text-primary rounded-lg hover:bg-primary-light transition-colors"
              >
                + 抖音短版
              </button>
              <button
                onClick={() => handleCreateVersion('long', 'bilibili')}
                className="px-3 py-1.5 text-xs font-medium border border-primary/30 text-primary rounded-lg hover:bg-primary-light transition-colors"
              >
                + B站长版
              </button>
            </>
          )}
          <button
            onClick={handleCreateNew}
            className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            + 新建脚本
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="w-56 shrink-0">
          <div className="bg-surface border border-border rounded-xl p-3">
            <h2 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">脚本列表</h2>
            {topics.length === 0 ? (
              <p className="text-xs text-text-secondary">暂无选题</p>
            ) : (
              <div className="space-y-1">
                {scripts
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((script) => {
                    const topic = topics.find((t) => t.id === script.topicId);
                    return (
                      <button
                        key={script.id}
                        onClick={() => {
                          setSelectedScriptId(script.id);
                          navigate(`/scripts/${script.id}`, { replace: true });
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors ${
                          selectedScriptId === script.id
                            ? 'bg-primary-light text-primary-dark font-medium'
                            : 'text-text-secondary hover:bg-gray-50'
                        }`}
                      >
                        <div className="truncate font-medium">
                          {topic?.title || '未关联选题'}
                        </div>
                        <div className="flex gap-1 mt-0.5">
                          <span className="text-[10px] opacity-70">
                            {PLATFORM_LABELS[script.platform]} {VERSION_LABELS[script.version]}
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {!selectedScript ? (
            <div className="bg-surface border border-border rounded-xl p-12 text-center">
              <div className="text-4xl mb-3">✍️</div>
              <p className="text-text-secondary">选择一个脚本开始编辑，或创建新脚本</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary-light text-primary-dark">
                        {categoryLabel(currentTopic?.category)}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-text-secondary">
                        {PLATFORM_LABELS[selectedScript.platform]} · {VERSION_LABELS[selectedScript.version]}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-text mt-1.5">
                      {currentTopic?.title || '未关联选题'}
                    </h3>
                    {currentTopic?.productionIdea && (
                      <p className="text-xs text-blue-600/70 mt-1 line-clamp-2">
                        <span className="font-medium">制作思路：</span>{currentTopic.productionIdea}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleDeleteScript}
                    className="text-xs text-text-secondary hover:text-danger transition-colors"
                  >
                    删除脚本
                  </button>
                </div>

                <label className="block mb-3">
                  <span className="text-xs font-medium text-text">视频标题</span>
                  <input
                    type="text"
                    value={selectedScript.title}
                    onChange={(e) => updateScript(selectedScript.id, { title: e.target.value })}
                    placeholder="给视频起个吸引人的标题..."
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-text">开场钩子（前3-5秒）</span>
                  <textarea
                    value={selectedScript.hook}
                    onChange={(e) => updateScript(selectedScript.id, { hook: e.target.value })}
                    placeholder="观众凭什么不走？一句话抓住注意力..."
                    rows={2}
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>

              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-text">
                    分镜脚本
                    <span className="text-xs text-text-secondary font-normal ml-2">
                      {selectedScript.storyboards.length} 镜 · 总时长 {totalDuration}秒
                    </span>
                  </h3>
                  <button
                    onClick={handleAddBoard}
                    className="px-3 py-1 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                  >
                    + 加分镜
                  </button>
                </div>

                <div className="space-y-3">
                  {selectedScript.storyboards.map((board) => (
                    <StoryboardCard
                      key={board.id}
                      board={board}
                      onUpdate={(updates) => updateStoryboard(selectedScript.id, board.id, updates)}
                      onDelete={() => removeStoryboard(selectedScript.id, board.id)}
                    />
                  ))}
                  {selectedScript.storyboards.length === 0 && (
                    <p className="text-xs text-text-secondary text-center py-6">
                      还没有分镜，点击上方按钮添加
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-surface border border-border rounded-xl p-4">
                <label className="block">
                  <span className="text-xs font-medium text-text">备注</span>
                  <textarea
                    value={selectedScript.notes}
                    onChange={(e) => updateScript(selectedScript.id, { notes: e.target.value })}
                    placeholder="BGM选择、特效想法、注意事项..."
                    rows={2}
                    className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI 建议侧边面板 */}
      {aiPanel && (
        <div className="fixed inset-0 bg-black/30 z-20 flex items-center justify-center p-4" onClick={() => setAiPanel(false)}>
          <div className="bg-surface rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-purple-700">AI 脚本建议</h2>
              <button onClick={() => setAiPanel(false)} className="text-text-secondary hover:text-text text-sm">关闭</button>
            </div>

            {aiLoading && (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-text-secondary">AI 正在分析你的脚本...</p>
              </div>
            )}

            {aiError && (
              <div className="bg-red-50 p-4 rounded-lg">
                <p className="text-sm text-red-700">{aiError}</p>
              </div>
            )}

            {aiSuggestion && (
              <div className="space-y-4 text-sm">
                {aiSuggestion.hookSuggestions.length > 0 && (
                  <div>
                    <h3 className="font-bold text-text mb-2">钩子建议</h3>
                    <ul className="space-y-1">
                      {aiSuggestion.hookSuggestions.map((h, i) => (
                        <li key={i} className="bg-purple-50 text-purple-800 px-3 py-2 rounded-lg">{h}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiSuggestion.structureAdvice && (
                  <div>
                    <h3 className="font-bold text-text mb-1">结构建议</h3>
                    <p className="text-text-secondary bg-gray-50 p-3 rounded-lg">{aiSuggestion.structureAdvice}</p>
                  </div>
                )}

                {aiSuggestion.pacingAdvice && (
                  <div>
                    <h3 className="font-bold text-text mb-1">节奏控制</h3>
                    <p className="text-text-secondary bg-gray-50 p-3 rounded-lg">{aiSuggestion.pacingAdvice}</p>
                  </div>
                )}

                {aiSuggestion.dialogueTips.length > 0 && (
                  <div>
                    <h3 className="font-bold text-text mb-2">台词技巧</h3>
                    <ul className="space-y-1">
                      {aiSuggestion.dialogueTips.map((t, i) => (
                        <li key={i} className="text-text-secondary bg-gray-50 px-3 py-1.5 rounded-lg">{t}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiSuggestion.improvementPoints.length > 0 && (
                  <div>
                    <h3 className="font-bold text-text mb-2">改进建议</h3>
                    <ul className="space-y-1">
                      {aiSuggestion.improvementPoints.map((p, i) => (
                        <li key={i} className="text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg">{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiSuggestion['b-rollIdeas'].length > 0 && (
                  <div>
                    <h3 className="font-bold text-text mb-2">B-roll 画面建议</h3>
                    <ul className="space-y-1">
                      {aiSuggestion['b-rollIdeas'].map((b, i) => (
                        <li key={i} className="text-text-secondary bg-gray-50 px-3 py-1.5 rounded-lg">{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 制作思路评估弹窗 */}
      {showIdeaEval && (
        <div className="fixed inset-0 bg-black/30 z-30 flex items-center justify-center p-4" onClick={() => setShowIdeaEval(false)}>
          <div className="bg-surface rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            {ideaLoading && (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-text-secondary">AI 正在评估你的制作思路...</p>
              </div>
            )}

            {aiError && !ideaLoading && (
              <div>
                <h2 className="text-lg font-bold mb-2 text-red-600">评估失败</h2>
                <p className="text-sm text-text-secondary">{aiError}</p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setShowIdeaEval(false)} className="px-4 py-2 text-sm text-text-secondary">关闭</button>
                  <button onClick={() => doGenerateScript()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">跳过评估，直接生成</button>
                </div>
              </div>
            )}

            {ideaEval && !ideaLoading && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">
                    制作思路评估
                    {ideaEval.evaluatedAt && (
                      <span className="text-xs font-normal text-text-secondary ml-2">
                        (评估于 {new Date(ideaEval.evaluatedAt).toLocaleString('zh-CN')})
                      </span>
                    )}
                  </h2>
                  <button onClick={() => setShowIdeaEval(false)} className="text-text-secondary hover:text-text text-sm">关闭</button>
                </div>

                <div className="bg-purple-50 rounded-lg p-4 text-center mb-4">
                  <div className="text-3xl font-bold text-purple-700">{ideaEval.feasibilityScore}</div>
                  <div className="text-xs text-purple-600 mt-1">可行性评分 /100</div>
                </div>

                <div className="space-y-3 text-sm">
                  {ideaEval.strengths.length > 0 && (
                    <div>
                      <span className="font-medium text-green-700">亮点优势：</span>
                      <ul className="mt-1 space-y-1">
                        {ideaEval.strengths.map((s, i) => (
                          <li key={i} className="text-text-secondary bg-green-50 px-3 py-1.5 rounded-lg">{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {ideaEval.weaknesses.length > 0 && (
                    <div>
                      <span className="font-medium text-red-700">潜在问题：</span>
                      <ul className="mt-1 space-y-1">
                        {ideaEval.weaknesses.map((w, i) => (
                          <li key={i} className="text-text-secondary bg-red-50 px-3 py-1.5 rounded-lg">{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <span className="font-medium text-text">改进建议：</span>
                    <p className="text-text-secondary mt-1 bg-gray-50 p-3 rounded-lg">{ideaEval.suggestions}</p>
                  </div>

                  <div>
                    <span className="font-medium text-text">推荐方向：</span>
                    <p className="text-text-secondary mt-1 bg-blue-50 p-3 rounded-lg">{ideaEval.recommendedApproach}</p>
                  </div>

                  <div>
                    <span className="font-medium text-text">脚本重点：</span>
                    <p className="text-text-secondary mt-1 bg-amber-50 p-3 rounded-lg">{ideaEval.scriptFocus}</p>
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-5">
                  <button onClick={() => setShowIdeaEval(false)} className="px-4 py-2 text-sm text-text-secondary">关闭</button>
                  <button
                    onClick={() => doEvaluateIdea()}
                    disabled={ideaLoading}
                    className="px-4 py-2 text-sm font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-50"
                  >
                    {ideaLoading ? '评估中...' : '重新评估'}
                  </button>
                  <button
                    onClick={() => doGenerateScript()}
                    disabled={genLoading}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
                  >
                    {genLoading ? '生成中...' : '确认生成脚本'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 标题评估弹窗 */}
      {showTitleEval && (
        <div className="fixed inset-0 bg-black/30 z-30 flex items-center justify-center p-4" onClick={() => setShowTitleEval(false)}>
          <div className="bg-surface rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            {titleEvalLoading && (
              <div className="text-center py-8">
                <div className="inline-block w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-text-secondary">AI 正在分析你的视频标题...</p>
              </div>
            )}

            {aiError && !titleEvalLoading && (
              <div>
                <h2 className="text-lg font-bold mb-2 text-red-600">评估失败</h2>
                <p className="text-sm text-text-secondary">{aiError}</p>
                <button onClick={() => { setShowTitleEval(false); setAiError(''); }} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm">关闭</button>
              </div>
            )}

            {titleEval && !titleEvalLoading && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">
                    标题评估
                    {titleEval.evaluatedAt && (
                      <span className="text-xs font-normal text-text-secondary ml-2">
                        (评估于 {new Date(titleEval.evaluatedAt).toLocaleString('zh-CN')})
                      </span>
                    )}
                  </h2>
                  <button onClick={() => setShowTitleEval(false)} className="text-text-secondary hover:text-text text-sm">关闭</button>
                </div>

                <div className="bg-orange-50 rounded-lg p-4 text-center mb-4">
                  <div className="text-3xl font-bold text-orange-700">{titleEval.score}</div>
                  <div className="text-xs text-orange-600 mt-1">标题吸引力评分 /100</div>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <span className="font-medium text-text">标题分析：</span>
                    <p className="text-text-secondary mt-1 bg-gray-50 p-3 rounded-lg">{titleEval.analysis}</p>
                  </div>

                  {titleEval.strengths.length > 0 && (
                    <div>
                      <span className="font-medium text-green-700">标题优点：</span>
                      <ul className="mt-1 space-y-1">
                        {titleEval.strengths.map((s, i) => (
                          <li key={i} className="text-text-secondary bg-green-50 px-3 py-1.5 rounded-lg">{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {titleEval.weaknesses.length > 0 && (
                    <div>
                      <span className="font-medium text-red-700">标题不足：</span>
                      <ul className="mt-1 space-y-1">
                        {titleEval.weaknesses.map((w, i) => (
                          <li key={i} className="text-text-secondary bg-red-50 px-3 py-1.5 rounded-lg">{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {titleEval.alternativeTitles.length > 0 && (
                    <div>
                      <span className="font-medium text-orange-700">吸睛备选标题（点击可采用）：</span>
                      <ul className="mt-1 space-y-1">
                        {titleEval.alternativeTitles.map((t, i) => (
                          <li
                            key={i}
                            className="text-text bg-orange-50 px-3 py-2 rounded-lg cursor-pointer hover:bg-orange-100 transition-colors border border-orange-100"
                            onClick={() => {
                              if (selectedScript) {
                                updateScript(selectedScript.id, { title: t });
                              }
                            }}
                          >
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end mt-5">
                  <button onClick={() => setShowTitleEval(false)} className="px-4 py-2 text-sm text-text-secondary">关闭</button>
                  <button
                    onClick={() => {
                      if (currentTopic) handleEvaluateTitle(true);
                    }}
                    disabled={titleEvalLoading}
                    className="px-4 py-2 text-sm font-medium text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors disabled:opacity-50"
                  >
                    {titleEvalLoading ? '评估中...' : '重新评估'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showPairDialog && (
        <div className="fixed inset-0 bg-black/30 z-20 flex items-center justify-center" onClick={() => setShowPairDialog(false)}>
          <div
            className="bg-surface rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">关联选题</h2>
            <label className="block mb-4">
              <span className="text-sm font-medium text-text">选择这个脚本属于哪个选题</span>
              <select
                value={pairTopicId}
                onChange={(e) => setPairTopicId(e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPairDialog(false)} className="px-4 py-2 text-sm text-text-secondary">取消</button>
              <button onClick={handleConfirmPair} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">创建</button>
            </div>
          </div>
        </div>
      )}
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
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs font-bold text-primary bg-primary-light px-2 py-0.5 rounded w-12 text-center shrink-0">
          第{board.sceneNumber}镜
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <span className="text-xs text-text-secondary truncate">
            {board.dialogue || board.description || '点击编辑分镜内容'}
          </span>
          <span className="text-[10px] text-text-secondary bg-gray-200 px-1.5 py-0.5 rounded shrink-0">
            {board.duration}s
          </span>
        </div>
        <span className="text-xs text-text-secondary shrink-0">{expanded ? '收起' : '展开'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-xs text-text-secondary hover:text-danger transition-colors shrink-0"
        >
          删除
        </button>
      </div>

      {expanded && (
        <div className="p-3 space-y-3 border-t border-border">
          <label className="block">
            <span className="text-xs font-medium text-text">画面描述</span>
            <textarea
              value={board.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="这个镜头里发生什么？画面构图、动作..."
              rows={2}
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-text">台词 / 旁白</span>
            <textarea
              value={board.dialogue}
              onChange={(e) => onUpdate({ dialogue: e.target.value })}
              placeholder="这个镜头要说的话..."
              rows={2}
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-text">时长（秒）</span>
              <input
                type="number"
                value={board.duration}
                onChange={(e) => onUpdate({ duration: Number(e.target.value) || 0 })}
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                min={1}
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-text">视觉方向</span>
              <input
                type="text"
                value={board.visualDirection}
                onChange={(e) => onUpdate({ visualDirection: e.target.value })}
                placeholder="录屏 / 实拍 / 素材..."
                className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-text">备注</span>
            <input
              type="text"
              value={board.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="特效、BGM、注意事项..."
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      )}
    </div>
  );
}
