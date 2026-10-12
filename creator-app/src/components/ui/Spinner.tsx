import { cn } from '../../utils/cn';

const SIZES = {
  sm: 'h-3.5 w-3.5 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
} as const;

/** 统一的旋转指示器（替代各页面手写的 SVG / border spinner） */
export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label ?? '加载中'}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent',
        SIZES[size],
        className,
      )}
    />
  );
}

/** 页面/面板级加载占位：居中指示器 + 文案 */
export function LoadingBlock({
  label = '加载中…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 text-text-secondary',
        className,
      )}
    >
      <Spinner size="lg" className="text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
