import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  ChartColumn,
  CloudOff,
  FileChartColumn,
  FileText,
  Images,
  Layers,
  Newspaper,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { ThemeToggle } from './ui/ThemeToggle';
import { LoadingBlock } from './ui/Spinner';

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
    items: [{ to: '/settings', label: '设置', desc: '接口、偏好与数据', Icon: Settings }],
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
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[13px] font-medium">{label}</span>
            <span className="truncate text-[11px] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
              {desc}
            </span>
          </span>
        </>
      )}
    </NavLink>
  );
}

function SidebarContent() {
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
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
        <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-surface-muted px-2.5 py-1 text-[11px] text-text-secondary">
          <CloudOff className="h-3 w-3" aria-hidden="true" />
          本地优先 · 数据不出本机
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="px-1 text-[11px] text-text-muted">v1.0 · 2026</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-bg">
      {/* 桌面端：固定侧边栏（应用型产品的主要"骨架"） */}
      <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动端：顶栏 + 可横滑的导航条（窄屏不至于把导航挤成两行） */}
        <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <NavLink to="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-white">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-text">
                Creator Studio
              </span>
            </NavLink>
            <ThemeToggle />
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

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-7 sm:px-8">
          <Suspense fallback={<LoadingBlock label="正在加载页面…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
