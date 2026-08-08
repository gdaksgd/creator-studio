import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-light text-primary-dark'
        : 'text-text-secondary hover:text-text hover:bg-gray-100'
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface border-b border-border sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-primary">Creator Studio</span>
            <span className="text-xs text-text-secondary bg-gray-100 px-2 py-0.5 rounded-full">
              自媒体创作助手
            </span>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              选题看板
            </NavLink>
            <NavLink to="/scripts" className={linkClass}>
              脚本编辑
            </NavLink>
            <NavLink to="/materials" className={linkClass}>
              素材工坊
            </NavLink>
            <NavLink to="/info" className={linkClass}>
              资讯中心
            </NavLink>
            <NavLink to="/analytics" className={linkClass}>
              数据看板
            </NavLink>
            <NavLink to="/settings" className={linkClass}>
              设置
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
