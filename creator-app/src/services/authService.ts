// ============================================================
//  账号制云端同步 —— 登录态 + 云端数据概况
//
//  ★ token 存 localStorage，键名 creator-studio-token（与后端契约一致）
//  ★ 注册/登录成功后：清演示数据 → 拉该账号的云端数据 → 刷新云端统计
//    （登录用户看到自己的空库是正常的，不会再被自动塞演示数据）
//  ★ 这里不做「自动注册/自动登录」，init() 只认已有的 token
// ============================================================

import { create } from 'zustand';
import { api, ApiError, setAuthToken, AUTH_TOKEN_KEY } from '../api/client';
import type { AuthUser, CloudUsage } from '../api/client';
import { clearDemoData } from './demoData';
import { syncOnLaunch } from './syncService';

/**
 * 同步判断「当前有没有登录」用（读 localStorage 即可，不依赖 React）。
 * 例：demoData.ensureDemoData() 在已登录时不再自动播种演示数据。
 */
export function hasToken(): boolean {
  try {
    return Boolean(localStorage.getItem(AUTH_TOKEN_KEY));
  } catch {
    return false;
  }
}

/** 从任意错误里取出后端业务错误码 */
function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError) return err.code;
  if (typeof err === 'object' && err !== null) return (err as { code?: string }).code;
  return undefined;
}

/** token 失效：401 或 code=UNAUTHORIZED */
function isUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) return true;
  return errorCode(err) === 'UNAUTHORIZED';
}

/**
 * 按后端 business code 出中文文案（Settings 页直接显示 store.error）。
 * 409 USERNAME_TAKEN / 401 BAD_CREDENTIALS / 503 NOT_CONFIGURED 三类单独说清楚，
 * 其余（含网络不通）统一提示稍后再试，不把「服务器没配」说成「用户填错了」。
 */
function messageForError(err: unknown): string {
  const code = errorCode(err);
  if (code === 'USERNAME_TAKEN') return '这个用户名已经被注册了';
  if (code === 'BAD_CREDENTIALS') return '用户名或密码不对';
  if (code === 'NOT_CONFIGURED') return '服务器的云账号功能没配置好（缺少 Supabase 配置）';
  return '连不上服务器，请稍后再试';
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  cloud: CloudUsage | null;
  loading: boolean;
  error: string;
  authConfigured: boolean;
  initialized: boolean;

  /** 启动时调用：读 token → 拉 me（401 清 token）→ 顺带拿 authConfigured */
  init: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 重新拉 /api/auth/me，刷新 user 与云端统计 */
  refreshMe: () => Promise<void>;
}

/** 登录/注册成功后的固定流程（每一步失败都只降级、不把登录判成失败） */
async function afterAuthSuccess(): Promise<void> {
  try {
    await clearDemoData();
  } catch (err) {
    console.warn('[auth] 清空演示数据失败（不影响登录）：', err);
  }
  try {
    await syncOnLaunch();
  } catch (err) {
    console.warn('[auth] 拉取云端数据失败（不影响登录）：', err);
  }
  await useAuthStore.getState().refreshMe();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  cloud: null,
  loading: false,
  error: '',
  authConfigured: false,
  initialized: false,

  init: async () => {
    set({ loading: true });
    try {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(AUTH_TOKEN_KEY);
      } catch {
        stored = null;
      }

      if (stored) {
        setAuthToken(stored);
        set({ token: stored });
        // token 已失效时由 refreshMe 内部清除本地登录态
        await get().refreshMe();
      }

      // authConfigured 只由服务端回答；拿不到就保持默认（false），
      // 界面上只提示「服务端未配置云端账号」，不会挡住本地功能。
      try {
        const status = await api.getAuthStatus();
        set({ authConfigured: Boolean(status?.authConfigured) });
      } catch (err) {
        console.warn('[auth] 读取云账号配置状态失败：', err);
      }
    } finally {
      set({ loading: false, initialized: true });
    }
  },

  register: async (username, password) => {
    set({ loading: true, error: '' });
    try {
      const res = await api.authRegister({ username, password });
      setAuthToken(res.token);
      set({ token: res.token, user: res.user });
      await afterAuthSuccess();
    } catch (err) {
      set({ error: messageForError(err) });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  login: async (username, password) => {
    set({ loading: true, error: '' });
    try {
      const res = await api.authLogin({ username, password });
      setAuthToken(res.token);
      set({ token: res.token, user: res.user });
      await afterAuthSuccess();
    } catch (err) {
      set({ error: messageForError(err) });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    // 先通知服务端（此时 token 还在），失败也无所谓：本地登录态一定要清掉
    try {
      if (hasToken()) await api.authLogout();
    } catch (err) {
      console.warn('[auth] 退出登录请求失败（本地照常清除）：', err);
    }
    setAuthToken(null);
    set({ token: null, user: null, cloud: null, error: '' });
  },

  refreshMe: async () => {
    if (!hasToken()) {
      set({ user: null, token: null, cloud: null });
      return;
    }
    try {
      const res = await api.authMe();
      set({ user: res.user, cloud: res.cloud ?? null });
    } catch (err) {
      if (isUnauthorized(err)) {
        console.warn('[auth] token 已失效，清除本地登录态');
        setAuthToken(null);
        set({ token: null, user: null, cloud: null });
        return;
      }
      console.warn('[auth] 读取账号信息失败：', err);
    }
  },
}));
