import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { syncOnLaunch } from './services/syncService'
import TopicDashboard from './pages/TopicDashboard'
import ScriptEditor from './pages/ScriptEditor'
import InfoCenter from './pages/InfoCenter'
import Analytics from './pages/Analytics'
import Materials from './pages/Materials'
import Report from './pages/Report'
import Settings from './pages/Settings'

function App() {
  useEffect(() => {
    // 已移除访问门禁：应用启动即触发一次云端同步
    syncOnLaunch()
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
