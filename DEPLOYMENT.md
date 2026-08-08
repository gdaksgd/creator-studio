# Creator Studio 部署指南

## 概述

将自媒体创作助手部署到云端，实现多设备访问和数据同步。

**架构：**
- 后端 + 前端 → 部署到 Render（免费层）
- 数据库 → Supabase（免费 PostgreSQL）
- 访问方式 → 浏览器输入 Render 分配的 URL，输入密码 125197

---

## 第一步：注册 Supabase 并创建数据库

1. 打开 https://supabase.com/ ，点击「Start your project」
2. 用 GitHub 账号登录（推荐）或注册新账号
3. 点击「New Project」，填写：
   - Name: `creator-studio`
   - Database Password: 设置一个密码（记住它）
   - Region: 选择离你最近的（如 Southeast Asia / Northeast Asia）
4. 等待项目创建完成（约 1-2 分钟）

### 执行建表 SQL

1. 在 Supabase Dashboard 左侧菜单点击「SQL Editor」
2. 点击「New query」
3. 打开项目根目录下的 `supabase-schema.sql` 文件，复制全部内容
4. 粘贴到 SQL Editor 中，点击「Run」
5. 看到成功提示即可

### 获取 API 密钥

1. 在 Supabase Dashboard 左侧菜单点击「Settings」→「API」
2. 记下以下两个值：
   - **Project URL**: 类似 `https://xxxxxxxx.supabase.co`
   - **anon public key**: 一长串字符串（以 `eyJ` 开头）

---

## 第二步：创建 GitHub 仓库并推送代码

1. 打开 https://github.com/ ，登录你的账号
2. 点击右上角「+」→「New repository」
3. 填写：
   - Repository name: `creator-studio`
   - 选择 **Private**（私有仓库）
   - 勾选「Add a README file」
   - 不要勾选 .gitignore（项目已有）
4. 点击「Create repository」

### 推送代码到 GitHub

在项目根目录 `D:\自媒体之路` 打开终端，执行：

```bash
# 初始化 Git（如果还没有）
git init

# 添加 .gitignore（如果还没有）
# 确保以下内容在 .gitignore 中：
# server/node_modules/
# creator-app/node_modules/
# server/data/
# server/.env
# server/public/

# 添加所有文件
git add .

# 首次提交
git commit -m "Initial commit: Creator Studio"

# 添加远程仓库（替换为你的仓库地址）
git remote add origin https://github.com/你的用户名/creator-studio.git

# 推送
git branch -M main
git push -u origin main
```

---

## 第三步：部署到 Render

1. 打开 https://render.com/ ，点击「Get Started」
2. 用 GitHub 账号登录
3. 点击「New +」→「Blueprint」
4. 选择你刚创建的 `creator-studio` 仓库
5. Render 会自动识别 `render.yaml` 配置文件
6. 在环境变量页面，填入以下值：
   - `DEEPSEEK_API_KEY`: 你的 DeepSeek API Key
   - `YOUTUBE_API_KEY`: 你的 YouTube API Key
   - `SUPABASE_URL`: 第一步获取的 Project URL
   - `SUPABASE_ANON_KEY`: 第一步获取的 anon key
   - `AUTH_PASSWORD`: 125197（已预设）
7. 点击「Apply」开始部署

### 等待部署完成

- Render 会自动执行 build 命令（安装依赖、编译前端、复制到后端）
- 部署时间约 3-5 分钟
- 部署完成后，Render 会给你一个 URL，类似 `https://creator-studio-xxxx.onrender.com`

---

## 第四步：验证部署

1. 在浏览器打开 Render 分配的 URL
2. 看到密码输入页面，输入 `125197`
3. 进入应用后，你的选题和脚本数据会自动从本地同步到云端
4. 在「设置」页面可以看到「云端同步已启用」

---

## 数据同步说明

### 自动同步
- **上传**：修改数据（添加/编辑/删除选题或脚本）后 5 秒自动上传到云端
- **下载**：每次打开应用时自动检查云端是否有更新，有则自动恢复

### 手动同步
- 在「设置」页面点击「手动同步」按钮

### 换设备使用
1. 在新设备的浏览器打开 Render URL
2. 输入密码 125197
3. 应用会自动从云端下载你的所有数据
4. 正常使用，修改会自动同步

---

## 注意事项

### Render 免费层限制
- **休眠**：15 分钟无请求后服务会休眠，下次访问需要 30-60 秒冷启动
- **定时任务**：休眠期间定时任务（新闻采集、账号同步）不会执行
- 如果需要 24/7 运行，可以用 UptimeRobot（免费）定时 ping 你的 Render URL 防止休眠

### 本地开发
- 本地开发时不需要 Supabase（同步功能会自动跳过）
- 如果 `.env` 中没有设置 `AUTH_PASSWORD`，密码认证会自动关闭
- 本地开发模式仍然使用 IndexedDB 存储数据

### 数据安全
- 仓库必须设为 **Private**（私有）
- `.env` 文件不要提交到 Git（已在 .gitignore 中排除）
- Supabase 的 anon key 是公开安全的，真正的安全保障是密码 125197

---

## 常见问题

### Q: 部署后访问显示 502 或超时？
A: Render 免费层冷启动需要时间，等 1 分钟后刷新。

### Q: 数据没有同步？
A: 检查「设置」页面是否显示「云端同步已启用」。如果没有，检查 Render 环境变量中的 SUPABASE_URL 和 SUPABASE_ANON_KEY 是否正确。

### Q: 密码忘记了？
A: 在 Render 的环境变量中修改 AUTH_PASSWORD 的值，重新部署即可。

### Q: 如何更新代码？
A: 本地修改后 `git push` 到 GitHub，Render 会自动重新部署。
