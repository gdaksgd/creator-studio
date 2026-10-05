// 把 AI 给出的「预估播放量」文本解析成可用于比较的数字。
//
// ★ 只解析，不推断：解析不出来就返回 null，由用户手填。
//   绝不能在解析失败时返回 0——那会让「未知」伪装成「预测极低」，
//   正是这个项目原来最大的问题（estimatedViews 有个数字，但没有任何依据）。

const UNIT_MULTIPLIER: Record<string, number> = {
  '万': 10000, w: 10000, W: 10000,
  '千': 1000, k: 1000, K: 1000,
};

function scale(value: number, unit: string | undefined): number {
  if (!unit) return value;
  return value * (UNIT_MULTIPLIER[unit] ?? 1);
}

/** 区间两端差距超过这个倍数，就认为解析不可信（例如「3000-5万」被误判） */
const SUSPICIOUS_RATIO = 50;

/**
 * 解析形如「5-10万」「约3万播放」「5000~8000」「1.5万」的文本。
 * 返回预测中值，无法可靠解析时返回 null。
 */
export function parseEstimatedViews(text: string | undefined | null): number | null {
  if (!text) return null;
  // 去掉千分位和空白，避免「1,0000」这类写法干扰
  const raw = String(text).replace(/[,，\s]/g, '');

  // 优先匹配区间。单位可能只写在后面那个数上（「5-10万」）
  const range = raw.match(/(\d+(?:\.\d+)?)([万千wkWK])?[-~—–至到](\d+(?:\.\d+)?)([万千wkWK])?/);
  if (range) {
    const first = parseFloat(range[1] ?? '');
    const second = parseFloat(range[3] ?? '');
    const sharedUnit = range[4] || range[2];
    const a = scale(first, range[2] || sharedUnit);
    const b = scale(second, range[4] || sharedUnit);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo <= 0) return null;
    if (hi / lo > SUSPICIOUS_RATIO) return null;
    return Math.round((lo + hi) / 2);
  }

  // 没有区间：优先取带单位的那个数字（「约3万播放」应得 30000 而不是 3）
  const singles = [...raw.matchAll(/(\d+(?:\.\d+)?)([万千wkWK])?/g)];
  if (singles.length === 0) return null;
  const chosen = singles.find((m) => m[2]) ?? singles[0];
  const value = scale(parseFloat(chosen[1] ?? ''), chosen[2]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** 播放量友好显示：6843035 -> 684.3万。未知一律显示「—」，不显示 0 */
export function formatViews(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}

/**
 * 实际播放相对预测的偏差描述。
 * 差距过大时改用「倍数」表达，比 +4800% 更直观。
 */
export function formatDeviation(
  predicted: number | undefined | null,
  actual: number | undefined | null,
): string {
  if (
    predicted === undefined || predicted === null || actual === undefined || actual === null ||
    !Number.isFinite(predicted) || !Number.isFinite(actual) || predicted <= 0
  ) {
    return '—';
  }
  const ratio = actual / predicted;
  if (ratio >= 10) return `超预测 ${ratio.toFixed(1)} 倍`;
  if (ratio > 0 && ratio <= 0.1) return `仅为预测的 ${(ratio * 100).toFixed(1)}%`;
  const pct = (ratio - 1) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** 时长（秒）显示：1798 -> 29:58 */
export function formatDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
