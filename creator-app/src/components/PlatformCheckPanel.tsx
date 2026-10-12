import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from '../api/client';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Field, Input } from './ui/Input';
import { SourceNote } from './ui/SourceNote';
import { cn } from '../utils/cn';
import type { Platform, PlatformCheck, PlatformCheckInput, RuleStatus, CoverPolishResult } from '../types';

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
 *  - v1.6.0 内部工作面重做：外壳换 Card、平台切换换分段控件、输入换 Field/Input、
 *    每条规则一张小卡、出处抽成 SourceNote，正文最小字号从 10/11px 提到 12px。
 */

const PLATFORM_LABEL: Record<Platform, string> = {
  bilibili: 'B站',
  douyin: '抖音',
};

const STATUS_META: Record<
  RuleStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  pass: { label: '通过', variant: 'success' },
  warn: { label: '注意', variant: 'warning' },
  fail: { label: '不建议', variant: 'danger' },
  info: { label: '参考', variant: 'neutral' },
};

function StatusBadge({ status }: { status: RuleStatus }) {
  const s = STATUS_META[status];
  return (
    <Badge variant={s.variant} size="md">
      {s.label}
    </Badge>
  );
}

/** 建议行：紫色箭头 + 一句话，替代改造前裸 `text-xs text-primary` */
function SuggestionLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium leading-relaxed text-primary">
      <ArrowRight className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
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
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text">平台适配检查</h3>
            <Badge variant="neutral" size="sm">
              纯规则引擎 {current ? current.engine : 'pure-rules-v1'}
            </Badge>
            {loading && (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                复查中
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            同一份脚本，两个平台的结论不一样 —— 在这里切换对比。输入就自动复查。
          </p>
        </div>

        {/* 平台切换：分段控件（改造前是两个描边按钮） */}
        <div
          className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5"
          role="group"
          aria-label="选择要查看的平台"
        >
          {(['bilibili', 'douyin'] as Platform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setActive(p)}
              aria-pressed={active === p}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                active === p
                  ? 'bg-surface text-text shadow-xs'
                  : 'text-text-secondary hover:text-text'
              )}
            >
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <Field label="封面文案" hint="封面上要写的那几个字，填了就自动保存在本机">
          <Input
            type="text"
            value={coverText}
            onChange={(e) => {
              setCoverText(e.target.value);
              persist({ coverText: e.target.value });
            }}
            placeholder="不填就不会给封面相关的结论"
          />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={handleDone} variant="secondary" size="sm">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            填写完毕
          </Button>
          <span className="text-xs text-text-muted">
            自动保存：填了就存进这条脚本，关掉页面重开也还在
            {savedAt ? ` · 上次填写 ${fmtTime(savedAt)}` : ''}
            {doneAt ? (loading ? ' · 已保存，正在复查…' : ` · 已保存并复查（${fmtTime(doneAt)}）`) : ''}
          </span>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-danger">检查失败：{error}</p>
        </div>
      )}

      {current && (
        <>
          {/* 时长结论 */}
          <div className="mt-4 rounded-xl border border-border bg-surface-muted/50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-text">{current.platformLabel}</span>
              <span className="text-xs text-text-muted">建议时长</span>
              <span className="num text-sm font-semibold text-text">{current.durationAdvice.target}</span>
              <StatusBadge status={current.durationAdvice.status} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-secondary sm:text-sm">
              {current.durationAdvice.detail}
            </p>
            {current.durationAdvice.hint && <SuggestionLine>{current.durationAdvice.hint}</SuggestionLine>}
            {current.durationAdvice.completionReference && (
              <p className="mt-1.5 text-xs text-text-secondary">
                完播率参考线：
                <span className="num text-text">{current.durationAdvice.completionReference.text}</span>
              </p>
            )}
            <SourceNote
              tier={current.durationAdvice.evidence.level}
              note={current.durationAdvice.evidence.note}
            >
              {current.durationAdvice.evidence.source}
            </SourceNote>
          </div>

          {/* 规则条目：一条一张小卡 */}
          {current.rules.length > 0 && (
            <div className="mt-3 space-y-2.5">
              {current.rules.map((rule, i) => (
                <div key={rule.id} className="rounded-xl border border-border bg-surface p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="num inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold text-text-secondary">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium text-text">{rule.label}</span>
                    <StatusBadge status={rule.status} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">{rule.detail}</p>
                  {rule.hint && <SuggestionLine>{rule.hint}</SuggestionLine>}
                  <SourceNote tier={rule.evidence.level} note={rule.evidence.note}>
                    {rule.evidence.source}
                  </SourceNote>
                </div>
              ))}
            </div>
          )}

          {/* 汇总 */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-text-secondary">
            {current.summary.total > 0 ? (
              <>
                <span>
                  规则：{current.summary.total} 条，全部带出处（{current.summary.sourced}/
                  {current.summary.total}）
                </span>
                <span className="flex items-center gap-1.5">
                  <Badge variant="success" size="sm">
                    通过 {current.summary.pass}
                  </Badge>
                  <Badge variant="warning" size="sm">
                    注意 {current.summary.warn}
                  </Badge>
                  <Badge variant="danger" size="sm">
                    不建议 {current.summary.fail}
                  </Badge>
                  <Badge variant="neutral" size="sm">
                    参考 {current.summary.info}
                  </Badge>
                </span>
              </>
            ) : (
              <span>这里没有需要改的地方：填上视频标题或封面文案才会出现对应检查。</span>
            )}
          </div>

          {/* 另一平台的结论（同一份脚本对比） */}
          {otherCheck && (
            <div className="mt-3 rounded-xl border border-border bg-surface-muted/40 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-text">
                  同一份脚本在 {otherCheck.platformLabel}
                </span>
                <Badge variant="outline" size="sm">
                  建议时长 {otherCheck.durationAdvice.target}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                {otherCheck.durationAdvice.detail}
              </p>
              {otherCheck.durationAdvice.hint && (
                <SuggestionLine>{otherCheck.durationAdvice.hint}</SuggestionLine>
              )}
            </div>
          )}

          {/* AI 润色：与规则结论严格分开 */}
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleAiPolish} loading={aiLoading} variant="secondary" size="sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                用 AI 润色封面文案
              </Button>
              <span className="text-xs text-text-muted">
                消耗一次 AI 配额；判断由规则引擎给出，AI 只写文案
              </span>
            </div>
            {aiError && <p className="mt-2 text-xs text-danger">{aiError}</p>}
            {ai && (
              <div className="mt-2.5 rounded-xl border border-primary/25 bg-primary-soft/50 p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary-contrast">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  AI 生成（来源 ai，不是平台口径，可以不用）
                </p>
                {ai.coverCandidates.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-text-muted">封面候选</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {ai.coverCandidates.map((c) => (
                        <span
                          key={c}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {ai.titleCandidates.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-text-muted">标题候选</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {ai.titleCandidates.map((t) => (
                        <span
                          key={t}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {ai.rationale && (
                  <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                    取舍说明：{ai.rationale}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-text-muted">
                  模型 <span className="num">{ai.model}</span>
                </p>
              </div>
            )}
          </div>

          <p className="mt-3 border-l-2 border-border-strong pl-3 text-xs leading-relaxed text-text-muted">
            {current.disclaimer}
          </p>
        </>
      )}

      {!current && !error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-3.5 py-3 text-xs text-text-secondary">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
          正在检查…
        </div>
      )}
    </Card>
  );
}
