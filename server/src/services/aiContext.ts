import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.js';

// ============================================
// 请求级 AI Key 上下文
//
// 「一个账号对应一个 AI 配置」：已登录用户走自己账号里存的 DeepSeek Key，
// 未登录（或账号没配）时退回 server/.env 里的站点公共 Key。
//
// 用 AsyncLocalStorage 传递，好处是不用改 aiService 里 8 个导出函数的签名，
// 也不用改 routes/ai.ts 里 9 处调用点 —— 中间件在请求入口把 Key 绑好，
// 下游异步调用链里 getRequestAiKey() 拿到的就是本次请求该用的 Key。
// ============================================

const aiKeyStore = new AsyncLocalStorage<string>();

/** 在本次请求的作用域内绑定要用的 DeepSeek Key */
export function runWithAiKey<T>(key: string, fn: () => T): T {
  return aiKeyStore.run(key, fn);
}

/** 当前请求该用的 Key；不在请求作用域内（脚本 / 定时任务）时退回站点公共 Key */
export function getRequestAiKey(): string {
  const scoped = aiKeyStore.getStore();
  return scoped === undefined ? config.deepseekApiKey : scoped;
}

/** 本次请求是否有可用的 AI Key（账号 Key 或站点公共 Key） */
export function hasAiKey(): boolean {
  const key = getRequestAiKey();
  return key.length > 0 && !key.includes('your_');
}

/** 出错提示统一文案：不再让用户去改服务器上的 .env */
export const AI_NOT_CONFIGURED_MESSAGE =
  'AI 未配置：请到「设置 → AI 配置」填写你自己的 DeepSeek API Key（或由站点管理员配置公共 Key）';
