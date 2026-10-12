import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../utils/cn';

const PADDING = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
  xl: 'p-6',
} as const;

export type CardPadding = keyof typeof PADDING;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 内边距档位，默认 md（= p-4，与改造前的卡片一致） */
  padding?: CardPadding;
  /** 悬停时描边高亮 + 轻微抬起，用于可点击卡片 */
  interactive?: boolean;
}

/**
 * 卡片：替代改造前在 9 个文件里重复 42 次的
 * `bg-surface border border-border rounded-xl p-4/p-5`
 */
export function Card({
  className,
  padding = 'md',
  interactive = false,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'min-w-0 bg-surface border border-border rounded-xl shadow-card',
        interactive && 'card-hover cursor-pointer hover:border-primary/30',
        PADDING[padding],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** 小节标题（报告页/设置页的 section 用） */
export function SectionTitle({
  children,
  hint,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-2 flex items-baseline gap-2', className)}>
      <h2 className="text-base font-semibold text-text">{children}</h2>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}
