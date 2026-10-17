/**
 * 标签页预取：提前把各页面的代码 chunk 下好，第一次点开任意标签页就不用再等网络。
 *
 * - 门户页停留时就开始（进入工作台之前代码已备好），进入工作台后作为兜底再触发一次；
 * - 并行批次：第一批是「最可能马上点开」的页面，第二批是其余页面，图表库单独延后；
 * - 省流模式（saveData）和 2G 网络下完全跳过；
 * - 全程静默失败。
 *
 * ★ 本模块不得静态 import api / queryCache：它们会经 queryCache 把 Dexie 拉进
 *   门户页的入口 chunk（首屏关键路径）。数据预热统一在 warmData 里动态 import。
 */

/** 路由 → 页面 chunk（与 App.tsx 的 lazy 声明保持一致） */
const ROUTE_LOADERS: Record<string, () => Promise<unknown>> = {
  '/': () => import('../pages/TopicDashboard'),
  '/scripts': () => import('../pages/ScriptEditor'),
  '/experiments': () => import('../pages/ContentExperiments'),
  '/marketing-briefs': () => import('../pages/MarketingBriefs'),
  '/report': () => import('../pages/Report'),
  '/materials': () => import('../pages/Materials'),
  '/library': () => import('../pages/MaterialLibrary'),
  '/info': () => import('../pages/InfoCenter'),
  '/settings': () => import('../pages/Settings'),
  '/about': () => import('../pages/About'),
  '/analytics': () => import('../pages/Analytics'),
};

/** 第一批：进入工作台后最可能马上点开的页面（并行下载） */
const FIRST_BATCH = ['/', '/scripts', '/experiments', '/report', '/marketing-briefs'];
/** 第二批：其余页面 */
const SECOND_BATCH = ['/materials', '/library', '/info', '/settings', '/about', '/analytics'];

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

function shouldPrefetch(): boolean {
  if (typeof window === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return false;
  return navigator.onLine !== false;
}

/** 导航意图预取：桌面悬停、手机按下就先把对应 chunk 拉起来 */
export function prefetchRoute(path: string): void {
  const load = ROUTE_LOADERS[path];
  if (!load || !shouldPrefetch()) return;
  load().catch(() => undefined);
}

let started = false;

/**
 * 启动预取（全局只跑一次）。门户页在停留时调用、工作台在外壳挂载时兜底调用；
 * delayMs 用于让当前页面自己的关键资源先走（门户页给主图让路）。
 */
export function schedulePagePrefetch(delayMs = 0): void {
  if (started || !shouldPrefetch()) return;
  started = true;

  setTimeout(() => {
    // 第一批并行
    for (const path of FIRST_BATCH) prefetchRoute(path);

    // 第二批：错开一点，避免和第一批、以及当前页的数据请求挤在一起
    setTimeout(() => {
      for (const path of SECOND_BATCH) prefetchRoute(path);

      // 图表库（recharts）体积与执行成本都偏高，再晚一步单独拉
      setTimeout(() => {
        import('../pages/analytics/charts')
          .catch(() => undefined)
          .finally(() => {
            void warmData();
          });
      }, 1500);
    }, 700);
  }, delayMs);
}

async function warmData(): Promise<void> {
  try {
    // 动态引入，避免把 Dexie / API 客户端拉进门户首屏的静态依赖（见文件头注释）
    const [{ api }, { loadWithCache }] = await Promise.all([
      import('../api/client'),
      import('../services/queryCache'),
    ]);
    const warmers: Array<() => Promise<unknown>> = [
      () => loadWithCache('report:game-industry:default', () => api.getReport()),
      () => loadWithCache('news:all:all:500', () => api.getNews({ limit: 500 })),
    ];
    for (const warm of warmers) {
      try {
        await warm();
      } catch {
        /* ignore */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch {
    /* 模块加载失败就当没预热 */
  }
}
