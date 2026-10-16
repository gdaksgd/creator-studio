import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bookmark,
  ChartColumn,
  Compass,
  FlaskConical,
  Megaphone,
  FileChartColumn,
  FileText,
  Images,
  Layers,
  LogOut,
  Newspaper,
  Settings,
  Sparkles,
  UserRound,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { ThemeToggle } from './ui/ThemeToggle';
import { LoadingBlock } from './ui/Spinner';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useToast } from './ui/Toast';
import { useAuthStore } from '../services/authService';
import { setAuthExpiredHandler } from '../services/syncService';

interface NavItem {
  to: string;
  label: string;
  desc: string;
  Icon: LucideIcon;
  end?: boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '创作台',
    items: [
      { to: '/', label: '选题看板', desc: '热点评分与选题池', Icon: Layers, end: true },
      { to: '/scripts', label: '脚本编辑', desc: '逐段写作与平台体检', Icon: FileText },
      { to: '/materials', label: '素材工坊', desc: '封面与配图素材', Icon: Images },
      { to: '/library', label: '素材库', desc: '收藏与复用的素材链接', Icon: Bookmark },
      { to: '/experiments', label: '内容实验', desc: '假设验证与内容复盘', Icon: FlaskConical },
      { to: '/marketing-briefs', label: '版本营销简报', desc: '目标、人群、卖点与传播计划', Icon: Megaphone },
    ],
  },
  {
    title: '数据',
    items: [
      { to: '/analytics', label: '数据看板', desc: '播放/互动趋势', Icon: ChartColumn },
      { to: '/report', label: '分析报告', desc: '可溯源的行业结论', Icon: FileChartColumn },
      { to: '/info', label: '资讯中心', desc: '平台政策与热点', Icon: Newspaper },
    ],
  },
  {
    title: '系统',
    items: [
      { to: '/settings', label: '设置', desc: '接口、偏好与数据', Icon: Settings },
      { to: '/about', label: '关于本站', desc: '项目介绍与联系方式', Icon: Compass },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function SidebarLink({ item }: { item: NavItem }) {
  const { to, label, desc, Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150',
          isActive
            ? 'bg-primary-soft text-primary-contrast'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-gradient transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden="true"
          />
          <Icon
            className={cn(
              'h-[18px] w-[18px] shrink-0 transition-colors',
              isActive ? 'text-primary' : 'text-text-muted group-hover:text-text-secondary',
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-[13px] font-medium">{label}</span>
          <span className="sr-only">{desc}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * 账号入口：未登录给「登录 / 注册」跳设置页，已登录显示用户名 + 退出。
 * init() 还没跑完（initialized=false）时先不渲染，避免刷新瞬间闪一下「登录 / 注册」。
 */
function AccountEntry() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const initialized = useAuthStore((s) => s.initialized);
  const logout = useAuthStore((s) => s.logout);
  const [busy, setBusy] = useState(false);

  if (!initialized) return null;

  if (!token) {
    return (
      <Button variant="soft" size="sm" onClick={() => navigate('/settings')}>
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
        登录 / 注册
      </Button>
    );
  }

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge variant="primary" size="sm" className="max-w-[7.5rem] truncate">
        {user?.username ?? '已登录'}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        loading={busy}
        onClick={() => void handleLogout()}
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        退出
      </Button>
    </div>
  );
}

/**
 * 同步逻辑跑在 React 组件之外（拿不到 useToast），由这里把「登录已过期」
 * 的提示接到 Toast 上；Layout 是全局唯一实例，注册一次即可。
 * ★ 除了弹提示，还要把 store 里的登录态一并清掉：syncService 清的是 localStorage
 *   里的 token，如果不同步 store，界面会继续显示「已登录」而所有同步都在失败。
 *   token 此时已被清除，所以 refreshMe() 会走「无 token → 清空 user/cloud」的分支。
 */
function useAuthExpiredToast() {
  const toast = useToast();
  useEffect(() => {
    setAuthExpiredHandler(() => {
      void useAuthStore.getState().refreshMe();
      toast.error('登录已过期，请重新登录');
    });
    return () => setAuthExpiredHandler(null);
  }, [toast]);
}

function SidebarContent() {
  return (
    <div className="flex h-full flex-col gap-7 px-3 py-5">
      <NavLink to="/" className="flex items-center gap-2.5 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-md">
          <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight text-text">
            Creator Studio
          </span>
          <span className="text-[11px] text-text-muted">自媒体创作助手</span>
        </span>
      </NavLink>

      <nav className="flex flex-1 flex-col gap-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <div className="eyebrow px-3 pb-1">{group.title}</div>
            {group.items.map((item) => (
              <SidebarLink key={item.to} item={item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-3 border-t border-border px-1 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="px-1 text-[11px] text-text-muted">创作者工作空间</span>
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  useAuthExpiredToast();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 桌面端：固定侧边栏（应用型产品的主要"骨架"） */}
      <aside className="sticky top-0 hidden h-screen w-[224px] shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动端：顶栏 + 可横滑的导航条（窄屏不至于把导航挤成两行） */}
        <header className="sticky top-0 z-30 border-b border-border bg-surface lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <NavLink to="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-text">
                Creator Studio
              </span>
            </NavLink>
            <div className="flex min-w-0 items-center gap-2">
              <AccountEntry />
              <ThemeToggle />
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto px-3 pb-2.5">
            {ALL_ITEMS.map(({ to, label, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-transparent bg-primary-soft text-primary-contrast'
                      : 'border-border text-text-secondary',
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </div>
        </header>

        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-border bg-surface/95 px-8 backdrop-blur lg:flex">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="text-text-muted">工作空间</span>
            <span className="text-text-muted">/</span>
            <span className="truncate font-medium text-text">{ALL_ITEMS.find((item) => item.to === pathname || (item.to !== '/' && pathname.startsWith(`${item.to}/`)))?.label ?? '选题看板'}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text-muted xl:flex">
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span>创作数据已在本机</span>
              <kbd className="ml-4 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">LOCAL</kbd>
            </div>
            <ThemeToggle />
            <AccountEntry />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1380px] flex-1 px-5 py-7 sm:px-8 xl:px-10">
          <Suspense fallback={<LoadingBlock label="正在加载页面…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
