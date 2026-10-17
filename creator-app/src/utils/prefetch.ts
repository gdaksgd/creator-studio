import { api } from '../api/client';
import { loadWithCache } from '../services/queryCache';

/**
 * 标签页预取：进入工作台后，利用空闲时间把各页面的代码 chunk 悄悄下好，
 * 之后第一次点开任意标签页就不用再等网络（移动端体感提升最明显）。
 * 顺带预热「分析报告」和「资讯中心」的小时级数据缓存。
 *
 * 设计约束：
 * - 只在空闲时跑、逐个下载并留间隔，不与首屏和接口请求抢带宽；
 * - 省流模式（saveData）和 2G 网络下完全跳过；
 * - 全程静默失败，预热只是锦上添花，任何错误都不影响功能。
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

/** 数据预热（key 与页面里保持一致；失败就当没预热） */
const DATA_WARMERS: Array<() => Promise<unknown>> = [
  () => loadWithCache('report:game-industry:default', () => api.getReport()),
  () => loadWithCache('news:all:all:500', () => api.getNews({ limit: 500 })),
];

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

/** 进入工作台后调用一次：空闲时逐个预取所有页面 chunk（含图表），最后预热数据缓存 */
export function scheduleIdlePrefetch(): void {
  if (started || !shouldPrefetch()) return;
  started = true;

  const begin = () => {
    const loaders: Array<() => Promise<unknown>> = [
      ...Object.values(ROUTE_LOADERS),
      // recharts（charts chunk ≈112 KB gzip）只在数据看板里被动态引用，放在最后预取
      () => import('../pages/analytics/charts'),
    ];

    let index = 0;
    const step = () => {
      const load = loaders[index++];
      if (!load) {
        void warmData();
        return;
      }
      load()
        .catch(() => undefined)
        .finally(() => {
          setTimeout(step, 250);
        });
    };
    step();
  };

  if ('requestIdleCallback' in window) {
    (
      window as Window & {
        requestIdleCallback: (cb: () => void, options?: { timeout?: number }) => number;
      }
    ).requestIdleCallback(begin, { timeout: 4000 });
  } else {
    setTimeout(begin, 1500);
  }
}

async function warmData(): Promise<void> {
  for (const warm of DATA_WARMERS) {
    try {
      await warm();
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
