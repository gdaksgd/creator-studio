import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/**
 * 出处/证据行：整站「每个结论都要能看到它从哪来」的统一长相。
 *
 * 改造前这段在每个面板里都是一行 11px 灰字 + 一个 10px 等级字母（挤在一起、几乎读不清），
 * 现在抽成一个组件：等级做成方形徽标，正文 12px，浅底色块加圆角，与卡片同一套令牌。
 */

/** 证据等级：A=平台官方/同行评审，B=第三方大样本，C=经验帖或本工具自定义 */
export type SourceTier = 'A' | 'B' | 'C';

const TIER_STYLE: Record<SourceTier, string> = {
  A: 'bg-primary text-primary-contrast',
  B: 'bg-info-soft text-info',
  C: 'bg-surface-muted text-text-muted',
};

const TIER_TITLE: Record<SourceTier, string> = {
  A: 'A 级证据：平台官方口径或同行评审论文',
  B: 'B 级证据：第三方大样本数据',
  C: 'C 级证据：经验帖或本工具自定义，不能当 KPI',
};

export function SourceNote({
  tier,
  label = '出处',
  note,
  children,
  className,
}: {
  tier: SourceTier;
  /** 前缀文案，默认「出处」 */
  label?: string;
  /** 补充说明，渲染为括号 */
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mt-2 flex items-start gap-2 rounded-lg border border-border/70 bg-surface-muted/60 px-2.5 py-2',
        className,
      )}
    >
      <span
        title={TIER_TITLE[tier]}
        aria-label={TIER_TITLE[tier]}
        className={cn(
          'mt-px inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-[11px] font-semibold leading-none',
          TIER_STYLE[tier],
        )}
      >
        {tier}
      </span>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-secondary">
        <span className="text-text-muted">{label}：</span>
        {children}
        {note ? <span className="text-text-muted">（{note}）</span> : null}
      </p>
    </div>
  );
}
