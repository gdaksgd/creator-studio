import { lazy, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { syncOnLaunch } from './services/syncService'
import { ensureDemoData } from './services/demoData'
// 路由级懒加载：把 Recharts 这类重依赖关进「数据看板」自己的 chunk，
// 首屏不再为没打开的页面买单（改造前单 chunk 895 kB / gzip 262 kB）
const TopicDashboard = lazy(() => import('./pages/TopicDashboard'))
const ScriptEditor = lazy(() => import('./pages/ScriptEditor'))
const InfoCenter = lazy(() => import('./pages/InfoCenter'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Materials = lazy(() => import('./pages/Materials'))
const Report = lazy(() => import('./pages/Report'))
const Settings = lazy(() => import('./pages/Settings'))

function App() {
  useEffect(() => {
    // 已移除访问门禁：应用启动先触发一次云端同步；
    // 同步结束后若本地库仍然为空，自动载入演示数据，保证首次打开不是一片空白。
    void syncOnLaunch()
      .catch(() => undefined)
      .then(() => ensureDemoData())
      .catch(() => undefined)
  }, [])

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TopicDashboard />} />
        <Route path="/scripts" element={<ScriptEditor />} />
        <Route path="/scripts/:scriptId" element={<ScriptEditor />} />
        <Route path="/info" element={<InfoCenter />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/report" element={<Report />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App
