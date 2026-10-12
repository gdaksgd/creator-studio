import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from './Button';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** 是否允许点遮罩 / 按 Esc / 点右上角关闭（提交中常设为 false） */
  closable?: boolean;
  className?: string;
}

/**
 * 弹窗：替代改造前在 6 处重复手写的
 * `bg-surface rounded-xl shadow-xl max-h-[80vh] overflow-y-auto` 遮罩结构
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closable = true,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, closable]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={() => closable && onClose()}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col rounded-xl border border-border bg-surface shadow-xl',
          SIZES[size],
          className,
        )}
      >
        {(title || closable) && (
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-text">{title}</h2>}
              {description && (
                <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
              )}
            </div>
            {closable && (
              <Button
                variant="ghost"
                size="iconSm"
                onClick={onClose}
                aria-label="关闭"
                className="-mr-1 -mt-0.5"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        <div className="overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-border bg-surface-muted/60 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
