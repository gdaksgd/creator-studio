import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Platform, PlatformCheck, PlatformCheckInput, RuleStatus, EvidenceLevel, CoverPolishResult } from '../types';

/**
 * M4 · 平台适配检查面板
 *
 * 关键设计（对应计划书 M4 验收）：
 *  - 同一份脚本同时查 B站 与 抖音，两个结论并排显示 —— 时长建议不同（B站 3–10 分钟 / 抖音 1–3 分钟或拆条）。
 *  - 每条规则都显示 evidence.source 与证据等级徽标（A/B/C），不显示出处的结论一律不出现。
 *  - 规则引擎不调 AI：本面板的自动检查只走 /api/ai/evaluate-cover（useAI 不传，不消耗 AI 配额）。
 *    AI 只用于「润色封面文案」，且结果单独标注为 AI 生成。
 *  - v1.5.2 精简：只保留「写脚本时就能判断」的检查。没填的输入（标题 / 封面文案）对应的规则
 *    直接不出现，不再排一行「不填就不会给结论」的占位；发布后才知道的指标（CTR / 完播率 /
 *    更新频率）已整体删除 —— 这类数字该去看板看，不适合混在脚本期判断里。
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

/** 把时间戳显示成 月-日 时:分:秒（本地时区），用于「上次填写」提示 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 停手多久复查 —— 实时感与限流之间的折中 */
const CHECK_DEBOUNCE_MS = 400;
/** 两次复查的最小间隔：后端给纯规则检查开了 120/min 的宽松档，正常输入不会碰到限流 */
const CHECK_MIN_INTERVAL_MS = 1500;

interface PlatformCheckPanelProps {
  /** 脚本自身的平台，作为面板默认选中项 */
  platform: Platform;
  title: string;
  durationSec: number;
  /** 这条脚本上次保存的手填内容（来自脚本记录，重开还在） */
  saved?: PlatformCheckInput;
  /** 把改动写回脚本记录：IndexedDB 落库 + 云同步 */
  onSave: (patch: Partial<PlatformCheckInput>) => void;
}

export default function PlatformCheckPanel({ platform, title, durationSec, saved, onSave }: PlatformCheckPanelProps) {
  // 初始值直接取脚本里存过的内容 —— 这就是「填写好的封面文案重开还在」的关键
  const [coverText, setCoverText] = useState(() => saved?.coverText ?? '');
  const [savedAt, setSavedAt] = useState<number | null>(saved?.updatedAt ?? null);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [active, setActive] = useState<Platform>(platform);
  const [checks, setChecks] = useState<Partial<Record<Platform, PlatformCheck>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<CoverPolishResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // 只认最后一次检查的结果，避免旧请求回来覆盖新结果
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunRef = useRef(0);

  useEffect(() => {
    setActive(platform);
  }, [platform]);

  /** 自动保存：把当前输入写回脚本记录（Dexie + 云同步），不等「填写完毕」也不会丢 */
  const persist = (next: { coverText?: string }) => {
    onSave({ coverText: next.coverText ?? coverText });
    setSavedAt(Date.now());
  };

  /** 按当前输入跑一次检查：同一份脚本 B站 + 抖音一起查，结论并排 */
  const runCheck = useCallback(async () => {
    const mySeq = ++seqRef.current;
    const payload = {
      title,
      coverText,
      durationSec: durationSec > 0 ? durationSec : undefined,
    };
    setLoading(true);
    setError('');
    try {
      const [bili, douyin] = await Promise.all([
        api.evaluateCover({ platform: 'bilibili', ...payload }),
        api.evaluateCover({ platform: 'douyin', ...payload }),
      ]);
      if (mySeq !== seqRef.current) return; // 已有更新的一次检查在跑，丢弃这次结果
      setChecks({ bilibili: bili.check, douyin: douyin.check });
    } catch (e: any) {
      if (mySeq !== seqRef.current) return;
      const msg = e?.message || '检查失败';
      setError(
        /429|too many/i.test(msg)
          ? '检查太频繁，被限流保护拦了一下，稍等一秒会自动重查（也可以点「填写完毕」立刻重试）'
          : msg
      );
    } finally {
      if (mySeq === seqRef.current) setLoading(false);
    }
  }, [title, coverText, durationSec]);

  // 输入即复查：停手 400ms 触发一次，且两次之间至少隔 1.5s
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const wait = Math.max(CHECK_DEBOUNCE_MS, CHECK_MIN_INTERVAL_MS - (Date.now() - lastRunRef.current));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastRunRef.current = Date.now();
      void runCheck();
    }, wait);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [runCheck]);

  /** 「填写完毕」：不等防抖，马上落库 + 立刻复查一次 */
  const handleDone = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    persist({});
    setDoneAt(Date.now());
    lastRunRef.current = Date.now();
    void runCheck();
  };

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
        同一份脚本，两个平台的结论不一样 —— 在这里切换对比。输入就自动复查{loading ? '，正在复查…' : ''}
      </p>

      <label className="block mb-2">
        <span className="text-xs font-medium text-text">封面文案（封面上要写的那几个字）</span>
        <input
          type="text"
          value={coverText}
          onChange={(e) => {
            setCoverText(e.target.value);
            persist({ coverText: e.target.value });
          }}
          placeholder="不填就不会给封面相关的结论"
          className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={handleDone}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:opacity-90 transition-opacity"
        >
          填写完毕
        </button>
        <span className="text-[11px] text-text-secondary">
          自动保存：填了就存进这条脚本，关掉页面重开也还在
          {savedAt ? ` · 上次填写 ${fmtTime(savedAt)}` : ''}
          {doneAt ? (loading ? ' · 已保存，正在复查…' : ` · 已保存并复查（${fmtTime(doneAt)}）`) : ''}
        </span>
      </div>

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
              {current.summary.total > 0 ? (
                <>
                  规则：{current.summary.total} 条，全部带出处（{current.summary.sourced}/{current.summary.total}）；
                  通过 {current.summary.pass} · 注意 {current.summary.warn} · 不建议 {current.summary.fail} · 参考 {current.summary.info}
                </>
              ) : (
                '这里没有需要改的地方：填上视频标题或封面文案才会出现对应检查。'
              )}
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
