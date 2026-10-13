import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  /** 主标题（每个页面的第一视觉锚点） */
  title: string;
  /** 一句话说明这个页面是干什么的 */
  description?: ReactNode;
  /** 标题上方的小标签，如「创作台 / 数据」 */
  eyebrow?: ReactNode;
  /** 右侧主操作区 */
  actions?: ReactNode;
  className?: string;
}

/**
 * 统一页面头：小标签 + 大标题 + 说明 + 右侧操作。
 * 之前每个页面自己写 h1/说明，字号与间距全不一样，这是"简陋感"的主要来源之一。
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'anim-rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-[28px] sm:leading-[1.2]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** 区块小标题：左侧一条品牌色短竖线，比单写字更"经过设计" */
export function SectionHeading({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="h-4 w-1 shrink-0 rounded-full bg-brand-gradient"
          aria-hidden="true"
        />
        <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-text">
          {title}
        </h2>
        {hint && <span className="min-w-0 truncate text-xs text-text-muted">{hint}</span>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
