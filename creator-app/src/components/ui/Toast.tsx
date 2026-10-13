import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, Info, X } from 'lucide-react';
import { cn } from '../../utils/cn';

type ToastVariant = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

export interface ToastApi {
  push: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const VARIANT_STYLE: Record<ToastVariant, string> = {
  info: 'border-border bg-surface text-text',
  success: 'border-success/30 bg-success-soft text-success',
  error: 'border-danger/30 bg-danger-soft text-danger',
};

const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
  info: <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />,
  success: <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />,
  error: <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />,
};

/** 轻量 Toast：右下角浮层，4 秒自动消失（无需额外依赖） */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = (idRef.current += 1);
      setItems((prev) => [...prev, { id, message, variant }]);
      const timer = window.setTimeout(() => remove(id), 4000);
      timersRef.current.set(id, timer);
    },
    [remove],
  );

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m: string) => push(m, 'success'),
      error: (m: string) => push(m, 'error'),
      info: (m: string) => push(m, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
              VARIANT_STYLE[t.variant],
            )}
          >
            {VARIANT_ICON[t.variant]}
            <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
            <button type="button" onClick={() => remove(t.id)} className="-mr-1 -mt-1 rounded p-1 text-current/60 hover:bg-black/5 hover:text-current" aria-label="关闭提示">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内部使用');
  return ctx;
}
