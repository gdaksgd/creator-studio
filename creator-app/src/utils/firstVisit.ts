/**
 * 首次访问引导：第一次打开站点的访客，如果落点是首页，默认先看到「关于本站」。
 * 判定在 React 渲染之前执行（见 main.tsx），避免先闪一帧首页再跳转。
 */

/** 「这个浏览器打开过本站」的标记（localStorage） */
const VISITED_KEY = 'creator-studio-visited';

/**
 * 这次页面加载要不要改落到「关于本站」：
 * - 只在第一次打开本站时可能生效（之后永远返回 null）；
 * - 且只有落点是首页（`/`）才改道，深链接（如 /report）不劫持。
 * 副作用：第一次打开时写入已访问标记——无论落点是不是首页。
 */
export function resolveFirstVisitRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (localStorage.getItem(VISITED_KEY) === '1') return null;
    localStorage.setItem(VISITED_KEY, '1');
  } catch {
    // 读写不了 localStorage（隐私模式等）：不劫持，按老行为进工作台
    return null;
  }
  return window.location.pathname === '/' ? '/about' : null;
}
