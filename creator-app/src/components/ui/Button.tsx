import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium ' +
    'transition-colors duration-150 select-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ' +
    'disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        /** 主操作：整站只有紫色这一种主按钮，替代改造前的 bg-primary / bg-primary */
        primary: 'bg-primary text-white shadow-xs hover:bg-primary-hover',
        /** 次操作：白底描边 */
        secondary:
          'bg-surface text-text border border-border shadow-xs hover:bg-surface-hover hover:border-border-strong',
        /** 强调但非主操作：紫色柔和底 */
        soft: 'bg-primary-soft text-primary-contrast hover:brightness-[0.97]',
        /** 纯文字按钮 */
        ghost: 'text-text-secondary hover:text-text hover:bg-surface-hover',
        danger: 'bg-danger text-white shadow-xs hover:brightness-95',
        /** 危险但次要（删除确认这类） */
        dangerGhost: 'text-danger hover:bg-danger-soft',
        link: 'text-primary hover:text-primary-hover underline-offset-4 hover:underline px-0',
      },
      size: {
        xs: 'h-7 px-2 text-xs',
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
        iconSm: 'h-7 w-7 p-0 text-xs',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
});
