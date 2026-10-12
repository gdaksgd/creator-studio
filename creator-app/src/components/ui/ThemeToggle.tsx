import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../utils/theme';
import { cn } from '../../utils/cn';

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
];

/** 主题切换：浅色 / 深色 / 跟随系统，选择写进 localStorage */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label="主题切换"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-xs',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setMode(value)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              active
                ? 'bg-primary-soft text-primary-contrast'
                : 'text-text-muted hover:bg-surface-hover hover:text-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
