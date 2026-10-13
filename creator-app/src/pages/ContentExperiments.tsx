import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useTopicStore } from '../store/topicStore';
import { useMarketingStore } from '../store/marketingStore';
import { useToast } from '../components/ui/Toast';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import type { ContentExperiment, ExperimentMetric } from '../types';

const METRICS: Array<[ExperimentMetric, string]> = [
  ['views', '播放量'], ['likes', '点赞'], ['comments', '评论'], ['coins', '投币'], ['favorites', '收藏'], ['shares', '分享'],
];
const STATUS: Record<ContentExperiment['status'], string> = { planned: '计划中', running: '进行中', completed: '已完成', inconclusive: '样本不足' };
const MIN_SAMPLE = 3;
type ExperimentDraft = Pick<ContentExperiment, 'conclusion' | 'nextAction'>;

function metricValue(experiment: ContentExperiment, topics: ReturnType<typeof useTopicStore.getState>['topics']) {
  const records = experiment.topicIds.flatMap((id) => {
    const topic = topics.find((item) => item.id === id);
    const value = topic?.published?.[experiment.metric];
    return typeof value === 'number' ? [{ topic, value }] : [];
  });
  return { records, mean: records.length ? records.reduce((sum, row) => sum + row.value, 0) / records.length : null };
}

export default function ContentExperiments() {
  const { topics, loadTopics } = useTopicStore();
  const { experiments, loading, load, saveExperiment, deleteExperiment } = useMarketingStore();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', hypothesis: '', variable: '', metric: 'views' as ExperimentMetric, threshold: '', evidenceMode: 'real' as 'real' | 'demo', topicIds: [] as string[] });
  const [drafts, setDrafts] = useState<Record<string, ExperimentDraft>>({});

  useEffect(() => { void loadTopics(); void load(); }, [load, loadTopics]);

  const publishedTopics = useMemo(() => topics.filter((topic) => !!topic.published && (form.evidenceMode === 'demo' ? topic.id.startsWith('demo-') : !topic.id.startsWith('demo-'))), [topics, form.evidenceMode]);
  const openCreate = () => {
    setForm({ title: '', hypothesis: '', variable: '', metric: 'views', threshold: '', evidenceMode: 'real', topicIds: [] });
    setShowCreate(true);
  };
  const toggleTopic = (id: string) => setForm((current) => ({ ...current, topicIds: current.topicIds.includes(id) ? current.topicIds.filter((item) => item !== id) : [...current.topicIds, id] }));

  const createExperiment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.hypothesis.trim() || !form.variable.trim()) return;
    const now = Date.now();
    const record: ContentExperiment = {
      id: crypto.randomUUID(), title: form.title.trim(), hypothesis: form.hypothesis.trim(), variable: form.variable.trim(),
      metric: form.metric, ...(Number(form.threshold) > 0 ? { successThreshold: Number(form.threshold) } : {}),
      status: 'planned', topicIds: form.topicIds, assignments: form.topicIds.map((topicId) => ({ topicId, group: 'variant' as const })), conclusion: '', nextAction: '', evidenceMode: form.evidenceMode, minimumSampleSize: MIN_SAMPLE, startedAt: now, updatedAt: now,
    };
    setSaving(true);
    try { await saveExperiment(record); setShowCreate(false); toast.success('内容实验已创建'); }
    catch (error) { toast.error(`保存失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };

  const update = async (experiment: ContentExperiment, patch: Partial<ContentExperiment>) => {
    await saveExperiment({ ...experiment, ...patch, updatedAt: Date.now(), ...(patch.status === 'completed' || patch.status === 'inconclusive' ? { completedAt: Date.now() } : {}) });
  };

  const statusFor = (experiment: ContentExperiment) => {
    const records = metricValue(experiment, topics).records.filter((row) => experiment.evidenceMode === 'demo' ? row.topic?.id.startsWith('demo-') : !row.topic?.id.startsWith('demo-'));
    const groups = new Set(records.flatMap(({ topic }) => {
      const group = experiment.assignments?.find((assignment) => assignment.topicId === topic?.id)?.group;
      return group ? [group] : [];
    }));
    const sampleSize = records.length;
    if (experiment.evidenceMode === 'demo' && experiment.status === 'completed') return 'inconclusive' as const;
    if (sampleSize < experiment.minimumSampleSize) return 'inconclusive' as const;
    if (experiment.status === 'completed' && (experiment.evidenceMode !== 'real' || !groups.has('control') || !groups.has('variant'))) return 'inconclusive' as const;
    return experiment.status === 'planned' ? 'running' as const : experiment.status;
  };

  return <div className="space-y-5">
    <PageHeader eyebrow="内容运营 / 实验验证" title="内容实验" description="把内容判断变成可复核的假设验证。工具只汇总观察值，不把相关性自动解释成因果。" actions={<Button onClick={openCreate}><Plus className="h-4 w-4"/>新建实验</Button>} />
    <Card padding="md" className="border-info/30 bg-info-soft/40"><p className="text-xs leading-relaxed text-info">设计提醒：一次尽量只改一个变量；不同平台、品类或发布时间可能造成混杂。样本少于 {MIN_SAMPLE} 条时标为「样本不足」，不会显示“实验成功”。</p></Card>
    {loading ? <Card padding="lg"><p className="text-sm text-text-muted">读取实验记录…</p></Card> : experiments.length === 0 ? <EmptyState icon={<FlaskConical className="h-5 w-5"/>} title="还没有内容实验" description="例如：对比“开头直接展示结果”与“先交代背景”两种钩子，观察发布后同口径指标。" action={<Button onClick={openCreate}><Plus className="h-4 w-4"/>设计一个假设</Button>}/> : <div className="space-y-4">
      {experiments.map((experiment) => {
        const guardedExperiment = experiment.evidenceMode ? experiment : { ...experiment, evidenceMode: 'real' as const };
        const { records: allRecords } = metricValue(guardedExperiment, topics);
        const records = allRecords.filter((row) => guardedExperiment.evidenceMode === 'demo' ? row.topic?.id.startsWith('demo-') : !row.topic?.id.startsWith('demo-'));
        const mean = records.length ? records.reduce((sum, row) => sum + row.value, 0) / records.length : null;
        const currentStatus = statusFor(guardedExperiment);
        const related = records.map((row) => row.topic).filter((topic): topic is NonNullable<typeof topic> => !!topic);
        const platformSet = new Set(related.map((topic) => topic.published?.platform).filter(Boolean));
        const categorySet = new Set(related.map((topic) => topic.category));
        const assignmentMap = new Map((experiment.assignments ?? []).map((assignment) => [assignment.topicId, assignment.group]));
        const controlValues = records.filter((row) => row.topic && assignmentMap.get(row.topic.id) === 'control').map((row) => row.value);
        const variantValues = records.filter((row) => row.topic && assignmentMap.get(row.topic.id) === 'variant').map((row) => row.value);
        const canComplete = guardedExperiment.evidenceMode === 'real' && records.length >= guardedExperiment.minimumSampleSize && controlValues.length > 0 && variantValues.length > 0;
        const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        return <Card key={experiment.id} padding="lg" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant={currentStatus === 'completed' ? 'success' : currentStatus === 'inconclusive' ? 'warning' : currentStatus === 'running' ? 'info' : 'neutral'}>{guardedExperiment.evidenceMode === 'demo' ? '演示实验 · 非实绩' : STATUS[currentStatus]}</Badge><span className="text-[11px] text-text-muted">更新于 {new Date(experiment.updatedAt).toLocaleDateString('zh-CN')}</span></div><h2 className="mt-2 text-base font-semibold text-text">{experiment.title}</h2></div><button type="button" onClick={() => setDeleteId(experiment.id)} className="rounded-lg p-2 text-text-muted hover:bg-danger-soft hover:text-danger" aria-label="删除实验"><Trash2 className="h-4 w-4"/></button>
          </div>
          <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-border bg-surface-muted/35 p-3.5"><p className="eyebrow">假设</p><p className="mt-1.5 text-sm leading-relaxed text-text">{experiment.hypothesis}</p></div><div className="rounded-xl border border-border bg-surface-muted/35 p-3.5"><p className="eyebrow">单一变量</p><p className="mt-1.5 text-sm leading-relaxed text-text">{experiment.variable}</p></div></div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary"><Badge variant="outline">观察指标：{METRICS.find(([metric]) => metric === experiment.metric)?.[1]}</Badge><Badge variant="outline">样本 {records.length} / 最低 {experiment.minimumSampleSize}</Badge><Badge variant="outline">平台：{platformSet.size ? [...platformSet].join('、') : '未回填'}</Badge><Badge variant="outline">品类：{categorySet.size ? [...categorySet].join('、') : '未关联'}</Badge>{experiment.successThreshold ? <Badge variant="outline">预设阈值 ≥ {experiment.successThreshold.toLocaleString()}</Badge> : null}</div>
          <div className="rounded-xl border border-border px-3.5 py-3"><p className="text-xs font-medium text-text">观察结果</p><p className="mt-1 text-sm text-text-secondary">{mean === null ? '暂无符合样本模式的发布记录。' : records.length < experiment.minimumSampleSize ? `当前均值 ${Math.round(mean).toLocaleString()}，样本不足，不判定成功或失败。` : `当前均值 ${Math.round(mean).toLocaleString()}（n=${records.length}）。仅为观察结果，不代表假设已成立。`}</p>{records.length > 0 && <div className="mt-2 space-y-1.5">{records.map(({ topic, value }) => { if (!topic) return null; return <div key={topic.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-2 py-1.5 text-[10px] text-text-muted"><span className="min-w-0 flex-1 truncate">{topic.title} · {value.toLocaleString()}</span><Select aria-label={`${topic.title}实验分组`} className="h-7 w-24 px-1.5 text-[10px]" value={assignmentMap.get(topic.id) ?? ''} onChange={(event) => { const group = event.target.value as '' | 'control' | 'variant'; const assignments = (experiment.assignments ?? []).filter((item) => item.topicId !== topic.id); if (group) assignments.push({ topicId: topic.id, group }); void update(experiment, { assignments }); }}><option value="">未分组</option><option value="control">对照组</option><option value="variant">实验组</option></Select></div>; })}</div>}<div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-surface-muted/60 p-2 text-xs">对照组：{average(controlValues) === null ? '—' : Math.round(average(controlValues)!).toLocaleString()}（n={controlValues.length}）</div><div className="rounded-lg bg-primary-soft/50 p-2 text-xs">实验组：{average(variantValues) === null ? '—' : Math.round(average(variantValues)!).toLocaleString()}（n={variantValues.length}）</div></div>{(!controlValues.length || !variantValues.length) && <p className="mt-1 text-[10px] text-text-muted">需同时设置对照组与实验组，才能进行分组观察；观察差异不构成因果结论。</p>}{guardedExperiment.evidenceMode === 'demo' && <p className="mt-1 text-[10px] text-warning">演示数据仅用于展示流程，不可标记为真实实验完成或作为求职实绩。</p>}</div>
          <div className="grid gap-3 md:grid-cols-2"><Field label="人工结论" hint="说明结果是否支持假设，以及数据局限"><Textarea rows={2} value={experiment.conclusion} onChange={(event) => setDrafts((current) => ({ ...current, [experiment.id]: { ...(current[experiment.id] ?? { conclusion: experiment.conclusion, nextAction: experiment.nextAction }), conclusion: event.target.value } }))} placeholder="样本观察到什么？哪些因素仍无法排除？"/></Field><Field label="下一次行动" hint="写成能在下一条内容上验证的动作"><Textarea rows={2} value={experiment.nextAction} onChange={(event) => setDrafts((current) => ({ ...current, [experiment.id]: { ...(current[experiment.id] ?? { conclusion: experiment.conclusion, nextAction: experiment.nextAction }), nextAction: event.target.value } }))} placeholder="下一轮具体调整什么？保持哪些因素不变？"/></Field></div>
          {drafts[experiment.id] && (drafts[experiment.id]!.conclusion !== experiment.conclusion || drafts[experiment.id]!.nextAction !== experiment.nextAction) && <div className="flex justify-end"><Button size="sm" onClick={() => void update(experiment, drafts[experiment.id]!).then(() => { setDrafts((current) => { const next = { ...current }; delete next[experiment.id]; return next; }); toast.success('实验复盘已保存'); })}>保存复盘结论</Button></div>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3"><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={experiment.status === 'completed'} onClick={() => void update(experiment, { status: 'running' })}>标记进行中</Button><Button size="sm" variant="soft" disabled={!canComplete} title={!canComplete ? '仅真实数据且达到最低样本数、两组均有样本后才能完成复盘' : undefined} onClick={() => void update(experiment, { status: 'completed' })}>完成复盘</Button><Button size="sm" variant="ghost" onClick={() => void update(experiment, { status: 'inconclusive' })}>标记样本不足</Button></div><p className="self-center text-[10px] text-text-muted">数据范围：已关联且有发布记录的选题；不足 {experiment.minimumSampleSize} 条或缺少任一组时不作对照结论。</p></div>
        </Card>;
      })}
    </div>}
    {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}><Card padding="none" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"><form onSubmit={(event) => void createExperiment(event)}><div className="border-b border-border px-5 py-4"><h2 className="text-base font-semibold text-text">设计内容实验</h2><p className="mt-1 text-xs text-text-muted">先定义一个可证伪假设和一个主要变量，之后再关联实际发布内容。</p></div><div className="space-y-3 px-5 py-4"><Field label="实验名称" required><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：开头钩子先给结果"/></Field><Field label="可验证假设" required hint="说明预期方向与适用对象，不写成已知结论"><Textarea required rows={2} value={form.hypothesis} onChange={(event) => setForm({ ...form, hypothesis: event.target.value })} placeholder="对卡牌攻略视频，开头 3 秒先展示最终卡组，播放量可能高于背景铺垫式开头。"/></Field><Field label="本次只改变什么变量" required><Input required value={form.variable} onChange={(event) => setForm({ ...form, variable: event.target.value })} placeholder="开场钩子结构；其余尽量保持一致"/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="主要观察指标"><Select value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value as ExperimentMetric })}>{METRICS.map(([metric, label]) => <option key={metric} value={metric}>{label}</option>)}</Select></Field><Field label="样本模式"><Select value={form.evidenceMode} onChange={(event) => setForm({ ...form, evidenceMode: event.target.value as 'real' | 'demo' })}><option value="real">真实发布记录（排除演示）</option><option value="demo">演示记录（不作求职业绩）</option></Select></Field><Field label="预设成功阈值" hint="选填；是预先写下的目标，不是预测"><Input type="number" min={1} value={form.threshold} onChange={(event) => setForm({ ...form, threshold: event.target.value })} placeholder="例如：10000"/></Field></div><Field label="关联已发布内容" hint="根据上方样本模式，只允许关联对应类型的数据"><div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{publishedTopics.filter((topic) => form.evidenceMode === 'demo' ? topic.id.startsWith('demo-') : !topic.id.startsWith('demo-')).length ? publishedTopics.filter((topic) => form.evidenceMode === 'demo' ? topic.id.startsWith('demo-') : !topic.id.startsWith('demo-')).map((topic) => <label key={topic.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-surface-hover"><input type="checkbox" checked={form.topicIds.includes(topic.id)} onChange={() => toggleTopic(topic.id)}/><span className="min-w-0 flex-1 truncate">{topic.title}</span><span className="shrink-0 text-text-muted">{topic.published?.platform === 'bilibili' ? 'B站' : '抖音'}</span></label>) : <p className="px-2 py-3 text-xs text-text-muted">当前样本模式没有可关联的已发布内容。</p>}</div></Field></div><div className="flex justify-end gap-2 border-t border-border bg-surface-muted/40 px-5 py-3"><Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>取消</Button><Button type="submit" size="sm" loading={saving}>创建实验</Button></div></form></Card></div>}
    <ConfirmDialog open={!!deleteId} title="删除这条内容实验？" description="只删除实验计划，不会删除已发布的选题或统计数据。" confirmLabel="删除实验" onConfirm={() => { if (deleteId) void deleteExperiment(deleteId).then(() => { setDeleteId(null); toast.success('实验已删除'); }); }} onClose={() => setDeleteId(null)}/>
  </div>;
}
