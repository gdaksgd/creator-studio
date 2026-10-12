import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../utils/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md font-medium whitespace-nowrap border',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-muted text-text-secondary border-border',
        primary: 'bg-primary-soft text-primary-contrast border-transparent',
        success: 'bg-success-soft text-success border-transparent',
        warning: 'bg-warning-soft text-warning border-transparent',
        danger: 'bg-danger-soft text-danger border-transparent',
        info: 'bg-info-soft text-info border-transparent',
        outline: 'bg-transparent text-text-secondary border-border',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[11px]',
        md: 'px-2 py-0.5 text-xs',
        lg: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}
