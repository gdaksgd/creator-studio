import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import PasswordGate from './components/PasswordGate'
import { syncOnLaunch } from './services/syncService'
import TopicDashboard from './pages/TopicDashboard'
import ScriptEditor from './pages/ScriptEditor'
import InfoCenter from './pages/InfoCenter'
import Analytics from './pages/Analytics'
import Materials from './pages/Materials'
import Settings from './pages/Settings'

function App() {
  useEffect(() => {
    // Trigger cloud sync on app launch
    syncOnLaunch()
  }, [])

  return (
    <PasswordGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<TopicDashboard />} />
          <Route path="/scripts" element={<ScriptEditor />} />
          <Route path="/scripts/:scriptId" element={<ScriptEditor />} />
          <Route path="/info" element={<InfoCenter />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </PasswordGate>
  )
}

export default App
