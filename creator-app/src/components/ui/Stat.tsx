import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '../../utils/cn';

const TONE = {
  primary: 'bg-primary-soft text-primary-contrast',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-muted text-text-secondary',
} as const;

export type StatTone = keyof typeof TONE;

export interface StatProps {
  label: string;
  value: ReactNode;
  /** 单位或跟在数字后的小字，如「条」「%」 */
  unit?: string;
  /** 数字下方的一行说明 */
  hint?: ReactNode;
  /** 环比变化百分比：正数上箭头、负数下箭头、0/undefined 不显示 */
  delta?: number | null;
  /** delta 的说明，如「较上周」 */
  deltaLabel?: string;
  icon?: LucideIcon;
  /** 数值高于 0 时是否算「好事」，默认 true（发布量上升为好），观看时长等可按需反转 */
  positiveIsGood?: boolean;
  tone?: StatTone;
  /** 悬停轻微抬起；放在弹窗里的评分卡传 false，避免整块面板跟着上浮 */
  interactive?: boolean;
  /** Flat mode for KPI strips embedded in a larger surface. */
  appearance?: 'card' | 'flat';
  className?: string;
}

function Delta({ value, label, positiveIsGood }: {
  value: number;
  label?: string;
  positiveIsGood: boolean;
}) {
  const flat = Math.abs(value) < 0.05;
  const good = positiveIsGood ? value > 0 : value < 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = flat
    ? 'text-text-muted'
    : good
      ? 'text-success'
      : 'text-danger';
  return (
    <span className={cn('num inline-flex items-center gap-1 text-xs font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {flat ? '持平' : `${Math.abs(value).toFixed(1)}%`}
      {label && <span className="font-normal text-text-muted">{label}</span>}
    </span>
  );
}

/**
 * 指标卡：大号数字 + 等宽对齐 + 环比 + 柔和图标底。
 * 首屏 KPI 条与数据看板顶部共用，避免两处数字风格不一致。
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  delta,
  deltaLabel,
  icon: Icon,
  positiveIsGood = true,
  tone = 'primary',
  interactive = true,
  appearance = 'card',
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        appearance === 'card'
          ? 'group relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-card'
          : 'group relative min-w-0 p-2 sm:p-3',
        interactive && appearance === 'card' && 'card-hover',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow">{label}</span>
        {Icon && (
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105',
              appearance === 'flat' && 'h-7 w-7 rounded-md',
              TONE[tone],
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className={cn('num font-semibold leading-none tracking-tight text-text', appearance === 'flat' ? 'text-[24px]' : 'text-[26px]')}>
          {value}
        </span>
        {unit && <span className="text-xs text-text-muted">{unit}</span>}
      </div>
      <div className="mt-2 flex min-h-[18px] items-center gap-2">
        {typeof delta === 'number' && (
          <Delta value={delta} label={deltaLabel} positiveIsGood={positiveIsGood} />
        )}
        {hint && <span className="truncate text-xs text-text-secondary">{hint}</span>}
      </div>
    </div>
  );
}
