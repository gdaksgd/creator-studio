import { useEffect, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useMarketingStore } from '../store/marketingStore';
import { useToast } from '../components/ui/Toast';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useTopicStore } from '../store/topicStore';
import { downloadMarketingBrief } from '../services/marketingExport';
import { useAssetStore } from '../store/assetStore';
import type { CampaignPhase, CampaignPlanItem, GameMarketingBrief } from '../types';

const PHASES: Array<[CampaignPhase, string]> = [['teaser', '预热期'], ['launch', '上线期'], ['sustain', '长尾期']];
const PHASE_COLORS: Record<CampaignPhase, string> = { teaser: 'bg-info-soft text-info', launch: 'bg-primary-soft text-primary-contrast', sustain: 'bg-success-soft text-success' };
const blankPlan = (): CampaignPlanItem => ({ id: crypto.randomUUID(), phase: 'teaser', channel: '', contentAngle: '', targetMetric: '', status: 'planned' });
interface MarketingBriefForm {
  id: string;
  title: string;
  gameTitle: string;
  versionName: string;
  objective: string;
  targetAudience: string;
  audienceInsight: string;
  sellingPointsText: string;
  evidenceNotes: string;
  budgetNote: string;
  successDefinition: string;
  retrospective: string;
  dataMode: GameMarketingBrief['dataMode'];
  plan: CampaignPlanItem[];
  linkedExperimentId?: string;
}

const blankForm = (): MarketingBriefForm => ({
  id: '', title: '', gameTitle: '', versionName: '', objective: '', targetAudience: '', audienceInsight: '',
  sellingPointsText: '', evidenceNotes: '', budgetNote: '', successDefinition: '', retrospective: '',
  dataMode: 'planning', plan: [blankPlan()], linkedExperimentId: undefined,
});

export default function MarketingBriefs() {
  const { briefs, loading, attachments, load, saveBrief, deleteBrief, attachAsset, detachAsset } = useMarketingStore();
  const assets = useAssetStore((state) => state.assets);
  const loadAssets = useAssetStore((state) => state.loadAssets);
  const topics = useTopicStore((state) => state.topics);
  const loadTopics = useTopicStore((state) => state.loadTopics);
  const experiments = useMarketingStore((state) => state.experiments);
  const toast = useToast();
  const [form, setForm] = useState(blankForm);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [attachmentAssetId, setAttachmentAssetId] = useState('');
  const [attachmentNote, setAttachmentNote] = useState('');

  useEffect(() => { void load(); void loadTopics(); void loadAssets(); }, [load, loadTopics, loadAssets]);

  const startNew = () => { setForm(blankForm()); setEditing(true); };
  const editBrief = (brief: GameMarketingBrief) => {
    setForm({
      id: brief.id, title: brief.title, gameTitle: brief.gameTitle, versionName: brief.versionName,
      objective: brief.objective, targetAudience: brief.targetAudience, audienceInsight: brief.audienceInsight,
      sellingPointsText: brief.keySellingPoints.join('\n'), evidenceNotes: brief.evidenceNotes,
      budgetNote: brief.budgetNote, successDefinition: brief.successDefinition, retrospective: brief.retrospective,
      dataMode: brief.dataMode, plan: brief.plan.length ? brief.plan.map((item) => ({ ...item })) : [blankPlan()],
      linkedExperimentId: brief.linkedExperimentId,
    });
    setEditing(true);
  };

  const updatePlanItem = (id: string, patch: Partial<CampaignPlanItem>) => setForm((current) => ({ ...current, plan: current.plan.map((item) => item.id === id ? { ...item, ...patch } : item) }));

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.objective.trim()) return;
    const existing = briefs.find((brief) => brief.id === form.id);
    const now = Date.now();
    const brief: GameMarketingBrief = {
      id: form.id || crypto.randomUUID(), title: form.title.trim(), gameTitle: form.gameTitle.trim(), versionName: form.versionName.trim(),
      objective: form.objective.trim(), targetAudience: form.targetAudience.trim(), audienceInsight: form.audienceInsight.trim(),
      keySellingPoints: form.sellingPointsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      evidenceNotes: form.evidenceNotes.trim(), budgetNote: form.budgetNote.trim(), successDefinition: form.successDefinition.trim(),
          retrospective: form.retrospective.trim(), dataMode: form.dataMode,
          ...(form.linkedExperimentId ? { linkedExperimentId: form.linkedExperimentId } : {}),
      plan: form.plan.filter((item) => item.channel.trim() || item.contentAngle.trim() || item.targetMetric.trim()).map((item) => ({
        ...item,
        publishAt: item.publishAt || undefined,
        targetValue: item.targetValue && item.targetValue > 0 ? item.targetValue : undefined,
        linkedTopicId: item.linkedTopicId || undefined,
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    setSaving(true);
    try {
      await saveBrief(brief);
      setEditing(false);
      toast.success('版本营销简报已保存到本机');
    } catch (error) { toast.error(`保存简报失败：${(error as Error).message}`); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5">
    <PageHeader eyebrow="游戏营销策划 / 版本传播" title="版本营销简报" description="把版本目标、玩家受众、核心卖点、传播节奏和评估指标写进一份可复核的策划简报。" actions={<Button onClick={startNew}><Plus className="h-4 w-4"/>新建简报</Button>} />
    <Card padding="md" className="border-info/30 bg-info-soft/40"><p className="text-xs leading-relaxed text-info">简报中的目标值是预设目标，不是预测或实际效果。选择「真实项目」仅表示简报来自真实项目背景，不会自动证明目标达成；方案仍需用发布后数据复盘。</p></Card>
    {loading ? <Card padding="lg"><p className="text-sm text-text-muted">正在读取简报…</p></Card> : briefs.length === 0 ? <EmptyState title="还没有版本营销简报" description="从一个明确的版本目标开始，拆解目标玩家、卖点证据和分阶段传播计划。" action={<Button onClick={startNew}><Plus className="h-4 w-4"/>创建第一份简报</Button>}/> : <div className="space-y-4">
      {briefs.map((brief) => <Card key={brief.id} padding="lg" className="space-y-4">
       <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant={brief.dataMode === 'real' ? 'success' : brief.dataMode === 'demo' ? 'warning' : 'neutral'}>{brief.dataMode === 'real' ? '真实项目背景' : brief.dataMode === 'demo' ? '演示案例 · 非实绩' : '策划中 · 未验证'}</Badge><span className="text-[11px] text-text-muted">更新于 {new Date(brief.updatedAt).toLocaleDateString('zh-CN')}</span></div><h2 className="mt-2 text-lg font-semibold text-text">{brief.title}</h2><p className="mt-1 text-xs text-text-secondary">{brief.gameTitle || '未填写游戏'} · {brief.versionName || '未填写版本'}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { const experiment = experiments.find((item) => item.id === brief.linkedExperimentId); const samples = experiment ? topics.filter((topic) => experiment.topicIds.includes(topic.id) && !!topic.published && (experiment.evidenceMode === 'demo' ? topic.id.startsWith('demo-') : !topic.id.startsWith('demo-')) && typeof topic.published?.[experiment.metric] === 'number').length : 0; downloadMarketingBrief(brief, experiment, samples); }}><Download className="h-3.5 w-3.5"/>导出 Markdown</Button><Button size="sm" variant="secondary" onClick={() => editBrief(brief)}>编辑</Button><Button size="sm" variant="dangerGhost" onClick={() => setDeleteId(brief.id)}><Trash2 className="h-3.5 w-3.5"/></Button></div></div>
         {brief.linkedExperimentId && (() => { const experiment = experiments.find((item) => item.id === brief.linkedExperimentId); const samples = experiment ? topics.filter((topic) => experiment.topicIds.includes(topic.id) && !!topic.published && (experiment.evidenceMode === 'demo' ? topic.id.startsWith('demo-') : !topic.id.startsWith('demo-')) && typeof topic.published?.[experiment.metric] === 'number').length : 0; return <div className="rounded-xl border border-border bg-surface-muted/35 p-3.5"><p className="eyebrow">关联内容实验</p><p className="mt-1 text-sm font-medium text-text">{experiment?.title ?? '关联实验记录不存在'}</p><p className="mt-1 text-xs text-text-secondary">符合实验口径的已发布样本：{samples} 条{experiment ? ` · ${experiment.evidenceMode === 'demo' ? '演示数据' : '真实发布记录'}` : ''}。样本数只描述当前记录，不表示实验成功。</p></div>; })()}
         <div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-border bg-surface-muted/35 p-3.5"><p className="eyebrow">营销目标</p><p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text">{brief.objective}</p><p className="mt-3 text-[11px] text-text-muted">成功定义：{brief.successDefinition || '未填写'}</p></div><div className="rounded-xl border border-border bg-surface-muted/35 p-3.5"><p className="eyebrow">目标受众与洞察</p><p className="mt-1.5 text-sm leading-relaxed text-text">{brief.targetAudience || '未填写目标受众'}</p><p className="mt-1 text-xs leading-relaxed text-text-secondary">{brief.audienceInsight || '尚未记录玩家洞察'}</p></div></div>
        <div><SectionHeading title="核心卖点" hint="卖点是待验证的传播主张，需注明证据来源"/><div className="flex flex-wrap gap-2">{brief.keySellingPoints.length ? brief.keySellingPoints.map((point, index) => <Badge key={`${index}-${point}`} variant="primary" size="md">{index + 1}. {point}</Badge>) : <p className="text-xs text-text-muted">暂无卖点</p>}</div>{brief.evidenceNotes && <p className="mt-2 text-[11px] text-text-muted">依据备注：{brief.evidenceNotes}</p>}</div>
        <div><SectionHeading title="传播节奏" hint={`${brief.plan.length} 个触点`}/><div className="grid gap-2 md:grid-cols-3">{PHASES.map(([phase, label]) => { const items = brief.plan.filter((item) => item.phase === phase); return <div key={phase} className="rounded-xl border border-border p-3"><div className="mb-2 flex items-center justify-between"><Badge variant="neutral" size="sm" className={PHASE_COLORS[phase]}>{label}</Badge><span className="text-[10px] text-text-muted">{items.length} 个触点</span></div>{items.length ? <ul className="space-y-2">{items.map((item) => <li key={item.id} className="border-t border-border pt-2"><p className="text-xs font-medium text-text">{item.contentAngle || '未填写内容角度'}</p><p className="mt-0.5 text-[10px] text-text-muted">{item.channel || '渠道待定'} · {item.publishAt ? new Date(item.publishAt).toLocaleDateString('zh-CN') : '日期待定'}</p><p className="mt-0.5 text-[10px] text-text-secondary">指标：{item.targetMetric || '未设'}{item.targetValue ? ` · 目标 ${item.targetValue}` : ' · 未设数值目标'}</p></li>)}</ul> : <p className="text-[11px] text-text-muted">尚未安排</p>}</div>; })}</div></div>
        {brief.retrospective && <div className="rounded-xl border border-border bg-surface-muted/35 p-3.5"><p className="eyebrow">复盘补记</p><p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{brief.retrospective}</p></div>}
        <div className="border-t border-border pt-3">
          <SectionHeading title="本地证据附件" hint="素材收藏仅作为参考链接，不自动证明营销效果" className="mb-2"/>
          {attachments.filter((attachment) => attachment.briefId === brief.id).map((attachment) => {
            const asset = assets.find((item) => item.id === attachment.assetId);
            if (!asset) return null;
            return <div key={attachment.id} className="mb-2 flex items-center gap-2 rounded-lg bg-surface-muted/40 px-3 py-2 text-xs"><a href={asset.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">{asset.title}</a><span className="text-text-muted">{attachment.note || asset.folder || '引用素材'}</span><button type="button" onClick={() => void detachAsset(attachment.id)} className="text-text-muted hover:text-danger" aria-label="移除简报附件关联">×</button></div>;
          })}
          <div className="flex flex-wrap gap-2"><Select className="min-w-48 flex-1" value={attachmentAssetId} onChange={(event) => setAttachmentAssetId(event.target.value)}><option value="">选择本地素材引用…</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</Select><Input className="min-w-32 flex-1" value={attachmentNote} onChange={(event) => setAttachmentNote(event.target.value)} placeholder="用途或出处说明"/><Button size="sm" variant="secondary" disabled={!attachmentAssetId} onClick={() => void attachAsset(brief.id, attachmentAssetId, attachmentNote.trim()).then(() => { setAttachmentAssetId(''); setAttachmentNote(''); toast.success('已关联素材引用'); }).catch((error: unknown) => toast.error(`关联素材失败：${(error as Error).message}`))}>关联素材</Button></div>
        </div>
      </Card>)}
    </div>}

    <Modal open={editing} onClose={() => { if (!saving) setEditing(false); }} title={form.id ? '编辑版本营销简报' : '新建版本营销简报'} description="保存的是策划记录；实际效果需发布后回填验证。" size="xl">
      <form className="space-y-5" onSubmit={(event) => void handleSave(event)}>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="简报名称" required><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：夏日版本 · 回流与新手内容计划"/></Field><Field label="数据模式"><Select value={form.dataMode} onChange={(event) => setForm({ ...form, dataMode: event.target.value as GameMarketingBrief['dataMode'] })}><option value="planning">策划中 / 未验证</option><option value="demo">演示案例 / 非实绩</option><option value="real">真实项目背景 / 效果仍需验证</option></Select></Field><Field label="游戏名称"><Input value={form.gameTitle} onChange={(event) => setForm({ ...form, gameTitle: event.target.value })} placeholder="游戏 / 产品名"/></Field><Field label="版本 / 活动名称"><Input value={form.versionName} onChange={(event) => setForm({ ...form, versionName: event.target.value })} placeholder="版本号或活动主题"/></Field></div>
        <Field label="营销目标" required hint="尽量描述业务目标，不要只写内容产量"><Textarea required rows={2} value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} placeholder="例如：让回流玩家理解新赛季核心变化，并引导查看回归活动页。"/></Field>
        <div className="grid gap-3 md:grid-cols-2"><Field label="目标受众"><Textarea rows={2} value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} placeholder="玩家阶段、兴趣、行为或核心困扰"/></Field><Field label="受众洞察"><Textarea rows={2} value={form.audienceInsight} onChange={(event) => setForm({ ...form, audienceInsight: event.target.value })} placeholder="洞察来源和待验证问题；注明是研究、数据还是假设"/></Field></div>
        <Field label="核心卖点" hint="每行一个传播主张"><Textarea rows={3} value={form.sellingPointsText} onChange={(event) => setForm({ ...form, sellingPointsText: event.target.value })} placeholder={'新地图带来的探索体验\n新角色解决的战斗痛点\n需要玩家进一步验证的内容主张'}/></Field>
        <div className="grid gap-3 md:grid-cols-2"><Field label="卖点依据 / 来源"><Textarea rows={2} value={form.evidenceNotes} onChange={(event) => setForm({ ...form, evidenceNotes: event.target.value })} placeholder="公告、访谈、调研、版本资料；没有依据请写“待验证假设”"/></Field><Field label="预算与资源限制"><Textarea rows={2} value={form.budgetNote} onChange={(event) => setForm({ ...form, budgetNote: event.target.value })} placeholder="达人资源、制作周期、平台限制等"/></Field></div>
        <Field label="成功定义"><Input value={form.successDefinition} onChange={(event) => setForm({ ...form, successDefinition: event.target.value })} placeholder="例如：上线后 7 天统计活动页点击，目标值待业务确认"/></Field>
        <div className="space-y-3"><div className="flex items-center justify-between"><SectionHeading title="分阶段传播计划" hint="预热 → 上线 → 长尾" className="mb-0"/><Button type="button" size="sm" variant="secondary" onClick={() => setForm((current) => ({ ...current, plan: [...current.plan, blankPlan()] }))}><Plus className="h-3.5 w-3.5"/>增加触点</Button></div>{form.plan.map((item, index) => <div key={item.id} className="rounded-xl border border-border bg-surface-muted/30 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-text">触点 {index + 1}</span><button type="button" disabled={form.plan.length === 1} onClick={() => setForm((current) => ({ ...current, plan: current.plan.filter((row) => row.id !== item.id) }))} className="text-xs text-text-muted hover:text-danger">移除</button></div><div className="grid gap-3 md:grid-cols-3"><Field label="阶段"><Select value={item.phase} onChange={(event) => updatePlanItem(item.id, { phase: event.target.value as CampaignPhase })}>{PHASES.map(([phase, label]) => <option key={phase} value={phase}>{label}</option>)}</Select></Field><Field label="日期"><Input type="date" value={item.publishAt ? dateToLocalInput(item.publishAt) : ''} onChange={(event) => updatePlanItem(item.id, { publishAt: event.target.value ? new Date(`${event.target.value}T12:00:00`).getTime() : undefined })}/></Field><Field label="渠道"><Input value={item.channel} onChange={(event) => updatePlanItem(item.id, { channel: event.target.value })} placeholder="B站 / 抖音 / 社群"/></Field><Field className="md:col-span-2" label="内容角度 / 行动"><Input value={item.contentAngle} onChange={(event) => updatePlanItem(item.id, { contentAngle: event.target.value })} placeholder="要讲什么、引导用户做什么"/></Field><Field label="目标指标"><Input value={item.targetMetric} onChange={(event) => updatePlanItem(item.id, { targetMetric: event.target.value })} placeholder="点击 / 预约 / 互动"/></Field><Field label="目标值（可选）"><Input type="number" min={0} value={item.targetValue ?? ''} onChange={(event) => updatePlanItem(item.id, { targetValue: event.target.value ? Number(event.target.value) : undefined })} placeholder="不确定可留空"/></Field><Field label="执行状态"><Select value={item.status} onChange={(event) => updatePlanItem(item.id, { status: event.target.value as CampaignPlanItem['status'] })}><option value="planned">计划中</option><option value="in-progress">进行中</option><option value="published">已发布</option><option value="reviewed">已复盘</option></Select></Field></div></div>)}</div>
        <Field label="复盘补记"><Textarea rows={2} value={form.retrospective} onChange={(event) => setForm({ ...form, retrospective: event.target.value })} placeholder="实施后记录实际结果、偏差与下一次行动；未执行时留空。"/></Field>
        <Field label="关联内容实验" hint="选填，用于把传播假设和实际内容测试对应起来"><Select value={form.linkedExperimentId ?? ''} onChange={(event) => setForm({ ...form, linkedExperimentId: event.target.value || undefined })}><option value="">不关联实验</option>{experiments.map((experiment) => <option key={experiment.id} value={experiment.id}>{experiment.title}</option>)}</Select></Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={() => setEditing(false)}>取消</Button><Button type="submit" loading={saving}>保存简报</Button></div>
      </form>
    </Modal>
    <ConfirmDialog open={!!deleteId} title="删除这份简报？" description="只删除本机简报记录，不会影响选题和脚本。" confirmLabel="删除简报" onConfirm={() => { if (deleteId) void deleteBrief(deleteId).then(() => { setDeleteId(null); toast.success('简报已删除'); }); }} onClose={() => setDeleteId(null)}/>
  </div>;
}

function dateToLocalInput(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
