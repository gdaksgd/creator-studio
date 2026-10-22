import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Portal from './pages/Portal'
import { LoadingBlock } from './components/ui/Spinner'
// 路由级懒加载：把 Recharts、Dexie 这类重依赖关进各自的 chunk，首屏不为没打开的页面买单。
// Portal（首访落地页）走同步 import：它是最先要画的页面，不该再等一次 chunk 往返。
const Layout = lazy(() => import('./components/Layout'))
const TopicDashboard = lazy(() => import('./pages/TopicDashboard'))
const ScriptEditor = lazy(() => import('./pages/ScriptEditor'))
const ProductionRuns = lazy(() => import('./pages/ProductionRuns'))
const ProductionRunDetail = lazy(() => import('./pages/ProductionRunDetail'))
const InfoCenter = lazy(() => import('./pages/InfoCenter'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Materials = lazy(() => import('./pages/Materials'))
const MaterialLibrary = lazy(() => import('./pages/MaterialLibrary'))
const Report = lazy(() => import('./pages/Report'))
const Settings = lazy(() => import('./pages/Settings'))
const ContentExperiments = lazy(() => import('./pages/ContentExperiments'))
const MarketingBriefs = lazy(() => import('./pages/MarketingBriefs'))
const About = lazy(() => import('./pages/About'))

function App() {
  useEffect(() => {
    // 启动顺序：① 账号态 → ② 云端同步（仅登录用户）→ ③ 演示数据兜底。
    // 三个服务按需 import：门户页首屏的关键路径不再拖上 Dexie / 账号 / 同步模块。
    // ★ 未登录访客是作品集最常见的访客，他们不会发起任何启动请求（sync 只在有 token 时跑）。
    void (async () => {
      try {
        const [{ useAuthStore, hasToken }, { syncOnLaunch }, { ensureDemoData }] = await Promise.all([
          import('./services/authService'),
          import('./services/syncService'),
          import('./services/demoData'),
        ])
        await useAuthStore.getState().init().catch(() => undefined)
        if (hasToken()) await syncOnLaunch().catch(() => undefined)
        await ensureDemoData().catch(() => undefined)
      } catch {
        /* 按需模块加载失败不挡住渲染 */
      }
    })()
  }, [])

  return (
    <Routes>
      {/* 门户页：不进 Layout（整屏落地页），首次访问的落点判定见 utils/firstVisit.ts */}
      <Route path="/welcome" element={<Portal />} />
      {/* Layout 也懒加载：门户页不需要侧边栏，就不为它下载整个工作台外壳 */}
      <Route
        element={
          <Suspense fallback={<LoadingBlock className="min-h-screen" />}>
            <Layout />
          </Suspense>
        }
      >
        <Route path="/" element={<TopicDashboard />} />
        <Route path="/scripts" element={<ScriptEditor />} />
        <Route path="/scripts/:scriptId" element={<ScriptEditor />} />
        <Route path="/runs" element={<ProductionRuns />} />
        <Route path="/runs/:runId" element={<ProductionRunDetail />} />
        <Route path="/info" element={<InfoCenter />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/report" element={<Report />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="/library" element={<MaterialLibrary />} />
        <Route path="/experiments" element={<ContentExperiments />} />
        <Route path="/marketing-briefs" element={<MarketingBriefs />} />
        <Route path="/about" element={<About />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App
