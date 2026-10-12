import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/** 空状态：虚线框 + 图标 + 说明 + 可选操作按钮 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** 嵌在卡片里用小尺寸 */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/70 text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-surface-muted text-text-secondary',
            compact ? 'h-9 w-9' : 'h-11 w-11',
          )}
        >
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-text">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
