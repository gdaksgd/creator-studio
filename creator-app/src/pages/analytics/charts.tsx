/**
 * 图表展示层（按需加载）：
 * 这个模块 import 了 recharts（约 400 kB raw），所以它**只能**被 React.lazy 动态引用，
 * 绝不能从 Analytics.tsx 顶部静态 import——那样整个图表库又会跟着页面 chunk 一起下来。
 *
 * 组件内部只做渲染，props / 数据形状 / 文案 / 配色令牌与原 Analytics.tsx 逐字一致，
 * 未改动任何数据口径。
 */
import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS_TICK, CHART, HOVER_CURSOR, TOOLTIP_STYLE, compactNum } from './tokens';

export type TrendChartProps = {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
};

export type ComparisonBarsProps = {
  items: { label: string; bili: number; douyin: number; unit?: string }[];
};

/** 趋势图（面积 + 折线）：Recharts 版，带坐标轴与 tooltip */
export function TrendChart({ data, labels, color, height = 180 }: TrendChartProps) {
  const rows = data.map((value, i) => ({ name: labels[i] ?? '#' + (i + 1), value }));
  // useId 保证同一页面多张面积图的渐变 id 不撞车（撞车会让先渲染的那张变黑）
  const gradId = 'trend-' + useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="55%" stopColor={color} stopOpacity={0.08} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={compactNum}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
            cursor={HOVER_CURSOR}
            formatter={(v) => compactNum(Number(v))}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={'url(#' + gradId + ')'}
            dot={false}
            isAnimationActive={false}
            activeDot={{ r: 5, fill: color, stroke: 'var(--surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 平台对比条：B站 vs 抖音（替换改造前 div 拼的进度条） */
export function ComparisonBars({ items }: ComparisonBarsProps) {
  const rows = items.map(({ label, bili, douyin, unit }) => ({
    name: unit ? label + '（' + unit + '）' : label,
    B站: bili,
    抖音: douyin,
  }));

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: -14 }} barGap={3}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={compactNum}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text-muted)' }}
            cursor={HOVER_CURSOR}
            formatter={(v) => compactNum(Number(v))}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)', paddingTop: 4 }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="B站" name="B站" fill={CHART.bili} radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={false} />
          <Bar dataKey="抖音" name="抖音" fill={CHART.douyin} radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
