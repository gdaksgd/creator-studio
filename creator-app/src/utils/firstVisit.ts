/**
 * 门户页引导：第一次打开站点的访客，如果落点是首页，先看到门户页（/welcome）。
 * 判定在 React 渲染之前执行（见 main.tsx），避免先闪一帧首页再跳转。
 *
 * 「已进站」标记由门户页在进入时写入（markEntered）：没进过站就一直先看到门户页，
 * 进过一次之后，之后访问直接到工作台。
 */

/** 「这个浏览器从门户进过站」的标记（localStorage） */
const VISITED_KEY = 'creator-studio-visited';

/**
 * 这次页面加载要不要改落到门户页：
 * - 只在「没进过站」且落点是首页（`/`）时才生效，深链接（如 /report）不劫持；
 * - 只读判定，不改标记——标记由门户页在进入时写入。
 */
export function resolveFirstVisitRedirect(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.location.pathname !== '/') return null;
  try {
    return localStorage.getItem(VISITED_KEY) === '1' ? null : '/welcome';
  } catch {
    // 读不了 localStorage（隐私模式等）：不劫持，按老行为进工作台
    return null;
  }
}

/** 门户页进入时调用：这个浏览器已经进过站，之后访问直接到工作台 */
export function markEntered(): void {
  try {
    localStorage.setItem(VISITED_KEY, '1');
  } catch {
    /* 写不了就下次仍先看到门户页，可接受 */
  }
}
