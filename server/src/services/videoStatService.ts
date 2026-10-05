import type { VideoStat } from '../types.js';

// ============================================================
// B站单条视频真实数据
//
// 为什么走「用户粘贴链接」而不是「自动列出自己的视频」——2026-10-05 实测：
//   ✓ /x/web-interface/view?bvid=...   连续 8 次全部成功（0ms / 700ms 间隔都是 8/8），
//                                      无需登录、无需 WBI、无风控，返回完整 stat
//   ✗ /x/space/wbi/arc/search          连续两次均返回 -352「风控校验失败」，
//                                      即使带上 WBI 签名 + buvid3 cookie 也一样
// 结论：「自动拉取我的全部视频」在本机网络下不可靠（会静默失败）；而
// 「粘贴链接 → 精确取数」不依赖模糊匹配、不会假装成功，且直接对应用户指定的那条视频。
// 等拿到 SESSDATA 再补自动列表能力。
// ============================================================

const BILI_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

const BV_PATTERN = /BV[0-9A-Za-z]{10}/;
const AV_PATTERN = /av(\d{1,15})/i;
const SHORT_LINK_PATTERN = /b23\.tv|bili2233\.cn/i;

/** 单条视频缓存 5 分钟：view 接口稳定，但没必要重复打同一个 URL */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { stat: VideoStat; expires: number }>();

/** 批量拉取时两条之间的间隔，保持克制 */
const BATCH_DELAY_MS = 500;
const BATCH_MAX = 20;

export type VideoStatErrorCode =
  | 'BAD_INPUT'
  | 'NOT_FOUND'
  | 'RISK_CONTROL'
  | 'UPSTREAM'
  | 'NETWORK';

export interface VideoStatResult {
  ok: boolean;
  stat?: VideoStat;
  error?: string;
  code?: VideoStatErrorCode;
}

type BiliRef = { bvid: string } | { aid: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function refKey(ref: BiliRef): string {
  return 'bvid' in ref ? ref.bvid : `av${ref.aid}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
  // 极端情况下（大量不同视频）兜底，避免内存无上限增长
  if (cache.size > CACHE_MAX_ENTRIES) {
    const overflow = cache.size - CACHE_MAX_ENTRIES;
    let removed = 0;
    for (const key of cache.keys()) {
      if (removed++ >= overflow) break;
      cache.delete(key);
    }
  }
}

/**
 * 从用户输入里解析 B站视频引用。
 * 支持：纯 BV 号 / 完整链接 / 带参数链接 / m.bilibili.com / av 号 / b23.tv 短链（需发一次请求）
 */
export async function resolveVideoRef(
  input: string,
): Promise<{ ref?: BiliRef; error?: string; code?: VideoStatErrorCode }> {
  const raw = String(input || '').trim();
  if (!raw) {
    return { error: '请输入 B站视频链接或 BV 号', code: 'BAD_INPUT' };
  }

  const bv = raw.match(BV_PATTERN);
  if (bv) return { ref: { bvid: bv[0] } };

  const av = raw.match(AV_PATTERN);
  if (av) return { ref: { aid: av[1] } };

  // 短链：跟随跳转后从最终 URL 里取 BV 号
  if (SHORT_LINK_PATTERN.test(raw)) {
    try {
      const resp = await fetch(raw.startsWith('http') ? raw : `https://${raw}`, {
        headers: BILI_HEADERS,
        redirect: 'follow',
      });
      const matched = (resp.url || '').match(BV_PATTERN);
      if (matched) return { ref: { bvid: matched[0] } };
      return { error: '短链解析失败：跳转后的地址里没有 BV 号', code: 'BAD_INPUT' };
    } catch (err) {
      return { error: `短链解析失败：${(err as Error).message}`, code: 'NETWORK' };
    }
  }

  return {
    error: '无法识别视频地址，请粘贴形如 https://www.bilibili.com/video/BVxxxx 的链接',
    code: 'BAD_INPUT',
  };
}

/**
 * 拉取单条视频真实数据（带 5 分钟缓存）。
 * 返回的每个数字都直接来自 B站接口，没有任何推断或占位。
 */
export async function fetchVideoStat(input: string): Promise<VideoStatResult> {
  const resolved = await resolveVideoRef(input);
  const ref = resolved.ref;
  if (!ref) {
    return { ok: false, error: resolved.error, code: resolved.code };
  }

  const key = refKey(ref);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { ok: true, stat: cached.stat };
  }

  const query = 'bvid' in ref ? `bvid=${ref.bvid}` : `aid=${ref.aid}`;
  let json: any;
  try {
    const resp = await fetch(`https://api.bilibili.com/x/web-interface/view?${query}`, {
      headers: BILI_HEADERS,
    });
    json = await resp.json();
  } catch (err) {
    return { ok: false, error: `请求 B站失败：${(err as Error).message}`, code: 'NETWORK' };
  }

  if (!json || json.code !== 0 || !json.data) {
    const message = json?.message || '未知错误';
    const upstreamCode = json?.code;
    const code: VideoStatErrorCode =
      upstreamCode === -352 || upstreamCode === -412
        ? 'RISK_CONTROL'
        : upstreamCode === -400 || upstreamCode === -404
          ? 'NOT_FOUND'
          : 'UPSTREAM';
    return { ok: false, error: `B站返回错误：${message}`, code };
  }

  const d = json.data;
  const s = d.stat || {};
  const stat: VideoStat = {
    bvid: String(d.bvid || ('bvid' in ref ? ref.bvid : '')),
    title: String(d.title || ''),
    url: `https://www.bilibili.com/video/${d.bvid || ''}`,
    // pubdate 是秒，统一转成毫秒
    publishedAt: (Number(d.pubdate) || 0) * 1000,
    duration: Number(d.duration) || 0,
    views: Number(s.view) || 0,
    likes: Number(s.like) || 0,
    coins: Number(s.coin) || 0,
    favorites: Number(s.favorite) || 0,
    shares: Number(s.share) || 0,
    comments: Number(s.reply) || 0,
    danmaku: Number(s.danmaku) || 0,
    fetchedAt: Date.now(),
  };

  if (!stat.bvid) {
    return { ok: false, error: 'B站未返回 BV 号，无法记录', code: 'UPSTREAM' };
  }

  pruneCache();
  cache.set(key, { stat, expires: Date.now() + CACHE_TTL_MS });
  return { ok: true, stat };
}

/** 批量拉取（串行 + 间隔，最多 20 条）。逐条返回成功/失败，不用一个失败拖垮整批。 */
export async function fetchVideoStats(
  inputs: string[],
): Promise<Array<{ input: string } & VideoStatResult>> {
  const list = (Array.isArray(inputs) ? inputs : [])
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .slice(0, BATCH_MAX);

  const results: Array<{ input: string } & VideoStatResult> = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) await sleep(BATCH_DELAY_MS);
    const stat = await fetchVideoStat(list[i]);
    results.push({ input: list[i], ...stat });
  }
  return results;
}
