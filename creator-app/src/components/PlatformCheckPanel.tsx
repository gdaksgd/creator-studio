import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Platform, PlatformCheck, RuleStatus, EvidenceLevel, CoverPolishResult } from '../types';

/**
 * M4 · 平台适配检查面板
 *
 * 关键设计（对应计划书 M4 验收）：
 *  - 同一份脚本同时查 B站 与 抖音，两个结论并排显示 —— 时长建议不同（B站 3–10 分钟 / 抖音 1–3 分钟或拆条）。
 *  - 每条规则都显示 evidence.source 与证据等级徽标（A/B/C），不显示出处的结论一律不出现。
 *  - 规则引擎不调 AI：本面板的自动检查只走 /api/ai/evaluate-cover（useAI 不传，不消耗 AI 配额）。
 *    AI 只用于「润色封面文案」，且结果单独标注为 AI 生成。
 *  - 没填的输入（封面文案 / CTR / 完播率 / 更新频率）不给结论，显示「不填就不会给结论」。
 */

const STATUS_STYLE: Record<RuleStatus, { label: string; cls: string }> = {
  pass: { label: '通过', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  warn: { label: '注意', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  fail: { label: '不建议', cls: 'bg-red-50 text-red-700 border-red-200' },
  info: { label: '参考', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const LEVEL_STYLE: Record<EvidenceLevel, string> = {
  A: 'bg-blue-600 text-white',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-slate-200 text-slate-600',
};

const LEVEL_TITLE: Record<EvidenceLevel, string> = {
  A: 'A 级证据：平台官方口径或同行评审论文',
  B: 'B 级证据：第三方大样本数据',
  C: 'C 级证据：经验帖或本工具自定义，不能当 KPI',
};

function StatusBadge({ status }: { status: RuleStatus }) {
  const s = STATUS_STYLE[status];
  return <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${s.cls}`}>{s.label}</span>;
}

function EvidenceLine({ evidence }: { evidence: { source: string; level: EvidenceLevel; note?: string } }) {
  return (
    <p className="mt-1 text-[11px] text-text-secondary leading-relaxed">
      <span
        title={LEVEL_TITLE[evidence.level]}
        className={`inline-block mr-1 px-1 rounded text-[10px] font-bold align-middle ${LEVEL_STYLE[evidence.level]}`}
      >
        {evidence.level}
      </span>
      出处：{evidence.source}
      {evidence.note ? `（${evidence.note}）` : ''}
    </p>
  );
}

interface PlatformCheckPanelProps {
  /** 脚本自身的平台，作为面板默认选中项 */
  platform: Platform;
  title: string;
  durationSec: number;
}

export default function PlatformCheckPanel({ platform, title, durationSec }: PlatformCheckPanelProps) {
  const [coverText, setCoverText] = useState('');
  const [ctr, setCtr] = useState('');
  const [completionRate, setCompletionRate] = useState('');
  const [postsPerWeek, setPostsPerWeek] = useState('');
  const [active, setActive] = useState<Platform>(platform);
  const [showMore, setShowMore] = useState(false);
  const [checks, setChecks] = useState<Partial<Record<Platform, PlatformCheck>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<CoverPolishResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    setActive(platform);
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    const toNum = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const payload = {
      title,
      coverText,
      durationSec: durationSec > 0 ? durationSec : undefined,
      ctr: toNum(ctr),
      completionRate: toNum(completionRate),
      postsPerWeek: toNum(postsPerWeek),
    };
    // 防抖：标题是逐字输入的，等停手 800ms 再查，避免打满 /api/ai 的分钟限流
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const [bili, douyin] = await Promise.all([
          api.evaluateCover({ platform: 'bilibili', ...payload }),
          api.evaluateCover({ platform: 'douyin', ...payload }),
        ]);
        if (!cancelled) setChecks({ bilibili: bili.check, douyin: douyin.check });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '检查失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title, coverText, durationSec, ctr, completionRate, postsPerWeek]);

  const current = checks[active];
  const other: Platform = active === 'bilibili' ? 'douyin' : 'bilibili';
  const otherCheck = checks[other];

  const handleAiPolish = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const res = await api.evaluateCover({
        platform: active,
        title,
        coverText,
        durationSec: durationSec > 0 ? durationSec : undefined,
        ctr: ctr.trim() === '' ? undefined : Number(ctr),
        completionRate: completionRate.trim() === '' ? undefined : Number(completionRate),
        postsPerWeek: postsPerWeek.trim() === '' ? undefined : Number(postsPerWeek),
        useAI: true,
      });
      if (res.aiUsed && res.ai) {
        setAi(res.ai);
      } else {
        setAi(null);
        setAiError(res.aiError || 'AI 没有返回结果');
      }
    } catch (e: any) {
      setAi(null);
      setAiError(e?.message || 'AI 润色失败');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-bold text-text">
          平台适配检查
          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-normal rounded bg-slate-100 text-slate-600 border border-slate-200">
            纯规则引擎 {current ? current.engine : 'pure-rules-v1'}
          </span>
        </h3>
        <div className="flex items-center gap-1">
          {(['bilibili', 'douyin'] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => setActive(p)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                active === p
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-text-secondary border-border hover:text-text'
              }`}
            >
              {p === 'bilibili' ? 'B站' : '抖音'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-text-secondary mb-3">
        同一份脚本，两个平台的结论不一样 —— 在这里切换对比。{loading ? ' 正在检查…' : ''}
      </p>

      <label className="block mb-3">
        <span className="text-xs font-medium text-text">封面文案（封面上要写的那几个字）</span>
        <input
          type="text"
          value={coverText}
          onChange={(e) => setCoverText(e.target.value)}
          placeholder="不填就不会给封面相关的结论"
          className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <button
        onClick={() => setShowMore((v) => !v)}
        className="text-[11px] text-text-secondary hover:text-text mb-2"
      >
        {showMore ? '− 收起可选项' : '+ 填更多（CTR / 完播率 / 更新频率，都不填也能检查）'}
      </button>
      {showMore && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <label className="block">
            <span className="text-xs font-medium text-text">封面点击率 CTR(%)</span>
            <input
              type="number"
              value={ctr}
              onChange={(e) => setCtr(e.target.value)}
              placeholder="如 4.5"
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text">完播率(%)（抖音）</span>
            <input
              type="number"
              value={completionRate}
              onChange={(e) => setCompletionRate(e.target.value)}
              placeholder="如 28"
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text">计划更新（条/周）</span>
            <input
              type="number"
              value={postsPerWeek}
              onChange={(e) => setPostsPerWeek(e.target.value)}
              placeholder="如 2"
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>
      )}

      {error && <p className="text-xs text-danger mb-3">检查失败：{error}</p>}

      {current && (
        <>
          <div className="bg-background border border-border rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-text">{current.platformLabel} · 建议时长 {current.durationAdvice.target}</span>
              <StatusBadge status={current.durationAdvice.status} />
            </div>
            <p className="text-xs text-text leading-relaxed">{current.durationAdvice.detail}</p>
            {current.durationAdvice.hint && (
              <p className="mt-1 text-xs text-primary">→ {current.durationAdvice.hint}</p>
            )}
            {current.durationAdvice.completionReference && (
              <p className="mt-1 text-[11px] text-text-secondary">
                完播率参考线：{current.durationAdvice.completionReference.text}
              </p>
            )}
            <EvidenceLine evidence={current.durationAdvice.evidence} />
          </div>

          <div className="space-y-2">
            {current.rules.map((rule) => (
              <div key={rule.id} className="border-t border-border pt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text">{rule.label}</span>
                  <StatusBadge status={rule.status} />
                </div>
                <p className="text-xs text-text-secondary leading-relaxed mt-0.5">{rule.detail}</p>
                {rule.hint && <p className="mt-0.5 text-xs text-primary">→ {rule.hint}</p>}
                <EvidenceLine evidence={rule.evidence} />
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2 border-t border-border">
            <p className="text-[11px] text-text-secondary">
              规则：{current.summary.total} 条，全部带出处（{current.summary.sourced}/{current.summary.total}）；
              通过 {current.summary.pass} · 注意 {current.summary.warn} · 不建议 {current.summary.fail} · 参考 {current.summary.info}
            </p>
          </div>

          {otherCheck && (
            <div className="mt-3 bg-background border border-border rounded-lg p-3">
              <p className="text-[11px] font-medium text-text mb-1">
                同一份脚本在 {otherCheck.platformLabel} 的结论（建议时长 {otherCheck.durationAdvice.target}）
              </p>
              <p className="text-xs text-text-secondary leading-relaxed">{otherCheck.durationAdvice.detail}</p>
              {otherCheck.durationAdvice.hint && (
                <p className="mt-1 text-xs text-primary">→ {otherCheck.durationAdvice.hint}</p>
              )}
            </div>
          )}

          <div className="mt-3 pt-2 border-t border-border">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleAiPolish}
                disabled={aiLoading}
                className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-background transition-colors disabled:opacity-50"
              >
                {aiLoading ? 'AI 正在写…' : '用 AI 润色封面文案（消耗一次 AI 配额）'}
              </button>
              <span className="text-[11px] text-text-secondary">判断由规则引擎给出，AI 只写文案</span>
            </div>
            {aiError && <p className="mt-2 text-xs text-danger">{aiError}</p>}
            {ai && (
              <div className="mt-2 bg-background border border-border rounded-lg p-3">
                <p className="text-[11px] font-medium text-text mb-1">
                  AI 生成（来源：ai，不是平台口径，可以不用）
                </p>
                {ai.coverCandidates.length > 0 && (
                  <p className="text-xs text-text">封面候选：{ai.coverCandidates.join(' / ')}</p>
                )}
                {ai.titleCandidates.length > 0 && (
                  <p className="text-xs text-text mt-1">标题候选：{ai.titleCandidates.join(' / ')}</p>
                )}
                {ai.rationale && <p className="text-[11px] text-text-secondary mt-1">取舍说明：{ai.rationale}</p>}
                <p className="text-[10px] text-text-secondary mt-1">模型：{ai.model}</p>
              </div>
            )}
          </div>

          <p className="mt-3 text-[11px] text-text-secondary leading-relaxed">{current.disclaimer}</p>
        </>
      )}

      {!current && !error && <p className="text-xs text-text-secondary">正在检查…</p>}
    </div>
  );
}
