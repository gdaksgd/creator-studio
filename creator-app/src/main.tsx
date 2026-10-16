import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ToastProvider } from './components/ui/Toast'
import { initTheme } from './utils/theme'
import { resolveFirstVisitRedirect } from './utils/firstVisit'
import './index.css'

// 渲染前先落主题类，避免深色用户看到一帧白屏
initTheme()

// 第一次打开这个网站：如果落点是首页，先落到门户页（/welcome）。
// 必须在挂载路由之前替换 history，否则会先闪一帧首页（判定见 utils/firstVisit.ts）。
const introPath = resolveFirstVisitRedirect()
if (introPath) window.history.replaceState(null, '', introPath + window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
