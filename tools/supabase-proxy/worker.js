/**
 * cs-supabase-proxy — Supabase 数据面透明反代
 *
 * 背景：部署机所在网络对 *.supabase.co 做 SNI-RST 封锁（TCP 通、TLS ClientHello 后被重置），
 *       导致后端 readCloud()/writeCloud() 全部失败 → 登录返回 502 CLOUD_ERROR。
 *       自定义域名 creator-app.xyz 未被封锁，所以把 Supabase REST 流量绕道自己的域名出海。
 *
 * 路由：https://supabase.creator-app.xyz/*  →  https://swuwkemyffuraloijrse.supabase.co/*
 *
 * 安全：这里不保存任何密钥。apikey / Authorization / Prefer 等请求头由后端原样透传，
 *       本 Worker 只是一个只认 apikey 字段的哑管道（没有 apikey 的扫描流量直接 401）。
 */

const ORIGIN = 'https://swuwkemyffuraloijrse.supabase.co';

/**
 * 可选路径前缀。同一个 Worker 支持两种入口：
 *   1) 自定义域名：https://supabase.creator-app.xyz/*        → 前缀为空，原样透传；
 *   2) 已有域名下的 Workers Route：https://creator.creator-app.xyz/api/cs-cloud/*
 *      （2026-10-14 加这一条，是因为部署机的校园解析器对新子域返回 NXDOMAIN，
 *        而 creator.creator-app.xyz 本来就能解析，无需等 DNS 生效）
 * 走第 2 种入口时要先把前缀剥掉再去 Supabase，否则会把 /api/cs-cloud 当成 Supabase 的路径。
 */
const PREFIXES = ['/api/cs-cloud'];

function stripPrefix(pathname) {
  for (const prefix of PREFIXES) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  }
  return pathname;
}

export default {
  async fetch(request) {
    if (!request.headers.get('apikey')) {
      return new Response('missing apikey', { status: 401 });
    }

    const url = new URL(request.url);
    const target = ORIGIN + stripPrefix(url.pathname) + url.search;

    const headers = new Headers(request.headers);
    headers.delete('host');           // 由目标 URL 决定
    headers.delete('content-length'); // body 以流方式转发，长度交给运行时

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    const resp = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });

    // Workers 的 fetch 会自动解压响应体，所以必须去掉这两个头，否则下游会二次解码
    const outHeaders = new Headers(resp.headers);
    outHeaders.delete('content-encoding');
    outHeaders.delete('content-length');

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: outHeaders,
    });
  },
};
