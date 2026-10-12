import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'creator-studio-theme';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** 应用主题：只在 <html> 上切换 .dark，颜色全部由 CSS 变量驱动 */
export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function setStoredTheme(mode: ThemeMode) {
  applyTheme(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 隐私模式下写不了 localStorage，主题只在本次会话生效 */
  }
}

/** 首屏调用：在 React 渲染前就把 .dark 打上，避免暗色用户看到白屏闪现 */
export function initTheme() {
  applyTheme(getStoredTheme());
}

/** 组件里读/改主题；选 system 时跟随系统变化实时切换 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme);

  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* 同上 */
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  return { mode, setMode };
}
