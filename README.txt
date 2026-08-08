Creator Studio - 自媒体创作助手
================================

【项目位置】D:\自媒体之路\creator-app

【如何启动】
  方式一：双击 "启动开发服务器.bat"，然后在浏览器打开 http://localhost:5173/
  方式二：在 creator-app 目录下运行 npm run dev，然后打开浏览器

【如何使用】
  1. 选题看板（首页）：添加和管理你的视频选题
  2. 脚本编辑器：编写分镜脚本，支持 B站长版 和 抖音短版

【数据存储】
  所有数据保存在浏览器本地（IndexedDB），不会上传到任何服务器。
  换浏览器或清除浏览器数据会导致数据丢失，请注意备份。

【技术栈】
  React + TypeScript + Vite + Tailwind CSS + Zustand + Dexie.js
