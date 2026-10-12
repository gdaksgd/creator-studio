/**
 * 图表配色 / 坐标轴 / Tooltip 令牌：值与原 Analytics.tsx 完全一致，只搬了位置。
 *
 * 单独放一个**不 import recharts** 的模块，这样 Analytics.tsx 可以静态引用它
 * 拿配色（CHART.bili 这类），而不会把 400 kB 的图表库重新拉进页面 chunk。
 */

/** 图表配色全部走 CSS 变量：深浅色主题自动切换，不再写死 hex */
export const CHART = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  bili: 'var(--accent-bili)',
  douyin: 'var(--accent-douyin)',
  grid: 'var(--border)',
  axis: 'var(--text-muted)',
} as const;

/** 坐标轴刻度：统一 11px + 弱化色，避免每张图各写一遍 */
export const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 11 } as const;

/** 悬停高亮：用最浅的表面色，别用默认的灰色方块 */
export const HOVER_CURSOR = { fill: 'var(--surface-muted)' } as const;

/** Tooltip 做成一张小卡片，和页面里的 card 同一套描边/圆角/阴影 */
export const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  color: 'var(--text)',
  fontSize: 12,
  padding: '8px 10px',
  boxShadow: 'var(--shadow-card)',
} as const;

/** 把大数字压成「12.3 万」 */
export function compactNum(v: number): string {
  if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(1) + ' 亿';
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + ' 万';
  return String(Math.round(v));
}
