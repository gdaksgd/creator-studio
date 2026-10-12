import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** 右侧小数字（条数/项数） */
  count?: number;
}

/** 分段式标签页：替代各页面手写的 `bg-surface border rounded-lg p-1` 切换条 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  className,
  ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-xs',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              active
                ? 'bg-primary-soft text-primary-contrast'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text',
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className={cn(
                  'ml-0.5 text-[11px] tabular-nums',
                  active ? 'text-primary-contrast/70' : 'text-text-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
