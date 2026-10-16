import { lazy, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { syncOnLaunch } from './services/syncService'
import { ensureDemoData } from './services/demoData'
import { useAuthStore } from './services/authService'
// 路由级懒加载：把 Recharts 这类重依赖关进「数据看板」自己的 chunk，
// 首屏不再为没打开的页面买单（改造前单 chunk 895 kB / gzip 262 kB）
const TopicDashboard = lazy(() => import('./pages/TopicDashboard'))
const ScriptEditor = lazy(() => import('./pages/ScriptEditor'))
const InfoCenter = lazy(() => import('./pages/InfoCenter'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Materials = lazy(() => import('./pages/Materials'))
const MaterialLibrary = lazy(() => import('./pages/MaterialLibrary'))
const Report = lazy(() => import('./pages/Report'))
const Settings = lazy(() => import('./pages/Settings'))
const ContentExperiments = lazy(() => import('./pages/ContentExperiments'))
const MarketingBriefs = lazy(() => import('./pages/MarketingBriefs'))
const About = lazy(() => import('./pages/About'))
const Portal = lazy(() => import('./pages/Portal'))

function App() {
  useEffect(() => {
    // 启动顺序：① 读 token / 拉 me（账号态）→ ② 云端同步 → ③ 演示数据兜底。
    // 每一步失败都不能挡住渲染，所以每一段都单独 catch。
    // ★ ensureDemoData 在已登录时会自己跳过，登录用户看到的空库不会被塞演示数据。
    void useAuthStore
      .getState()
      .init()
      .catch(() => undefined)
      .then(() => syncOnLaunch())
      .catch(() => undefined)
      .then(() => ensureDemoData())
      .catch(() => undefined)
  }, [])

  return (
    <Routes>
      {/* 门户页：不进 Layout（整屏落地页），首次访问的落点判定见 utils/firstVisit.ts */}
      <Route path="/welcome" element={<Portal />} />
      <Route element={<Layout />}>
        <Route path="/" element={<TopicDashboard />} />
        <Route path="/scripts" element={<ScriptEditor />} />
        <Route path="/scripts/:scriptId" element={<ScriptEditor />} />
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
