# Creator Studio · 自媒体创作助手

一个面向游戏内容创作者的**选题 → 脚本 → 素材 → 发布**全流程工作台。
资讯自动采集、按品类归类，AI 辅助生成选题与脚本，数据本地优先并同步到云端，
通过 Cloudflare Tunnel 从手机/平板/任意电脑访问。

> **在线 Demo：[https://creator.creator-app.xyz](https://creator.creator-app.xyz)**（无需密码，打开即用）

---

## 目录

- [功能](#功能)
- [在线体验](#在线体验)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [工程亮点](#工程亮点)
- [本地运行](#本地运行)
- [目录结构](#目录结构)
- [运维](#运维)
- [已知限制](#已知限制)

---

## 功能

| 模块 | 说明 |
|---|---|
| **资讯中心** | 定时从 RSS / YouTube / B站 / Steam 采集资讯与热门视频，按品类自动落桶，支持一键存为选题 |
| **选题看板** | 按品类筛选、按优先级排序；状态流转（想法 → 调研 → 已通过 → 写脚本 → 已完成） |
| **脚本编辑器** | 结构化脚本编辑，AI 生成选题评估与标题评分，支持重新生成与历史保留 |
| **素材库** | 收藏图片/视频/链接素材，按品类与类型归档 |
| **账号运营** | 追踪各平台账号数据，AI 生成运营建议 |
| **数据同步** | 本地 IndexedDB 优先，云端 Supabase 单行快照同步；冲突检测、失败不误覆盖 |
| **AI 辅助** | 选题评估、标题评分、素材分析、标题批量翻译（英文源站资讯） |

### 支持的创作品类（可在配置中自由增删）

🃏 卡牌游戏 · 👻 恐怖游戏 · 🎮 独立游戏 · 🗡️ RPG/剧情向 · ⚔️ 动作冒险 · 🏗️ 模拟经营 · 📱 手游 · 📰 行业资讯

> 另有一个仅供资讯采集落桶的「📌 综合资讯」品类，不参与创作选题。

---

## 在线体验

| 场景 | 地址 |
|---|---|
| **公网（手机 / 平板 / 任意电脑）** | **https://creator.creator-app.xyz** |
| 本机生产模式 | http://localhost:3001 |
| 本机开发模式（热更新） | http://localhost:5173 |

公网地址是**永久固定**的，可加书签或添加到手机主屏幕。

---

## 技术栈

**前端**
`React 19` · `TypeScript` · `Vite 8` · `Tailwind CSS v4` · `Zustand` · `Dexie (IndexedDB)`

**后端**
`Node.js 22` · `Express 5` · `node-cron` · `tsx`

**基础设施**
`Cloudflare Tunnel`（公网入口）· `Supabase PostgreSQL`（云端同步）

---

## 系统架构

```
                      ┌──────────────────────────────────────┐
   手机 / 平板 / 电脑 ─▶│  Cloudflare 边缘  creator-app.xyz     │
                      └────────────────┬─────────────────────┘
                                       │ 出站隧道长连接
                                       │ 无需公网 IP / 无需备案 / 无需开放端口
                                       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  本机 Windows（内置 Node v22.22.2，不依赖系统环境）             │
   │                                                              │
   │   生产模式 ──▶ Express :3001                                  │
   │                ├─ 托管前端构建产物（server/public，纯静态）      │
   │                └─ /api/**  业务接口                            │
   │                                                              │
   │   开发模式 ──▶ Vite :5173  ──/api 代理──▶ Express :3001        │
   └───────────────────────┬──────────────────────────────────────┘
                           │ 定时采集 / 数据同步
                           ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Supabase PostgreSQL                                         │
   │  表 app_sync · 单行快照（选题 + 脚本 + 版本时间戳）             │
   └──────────────────────────────────────────────────────────────┘
```

**为什么公网只走 3001？**
线上服务的是**生产构建产物**，源码不会被打包进静态目录。
早期版本用 `vite dev` 直接对外，任何人都能下载到 `.tsx` 源码，现已彻底修正。

---

## 工程亮点

### 1. 品类配置化 —— 单一事实来源

新增一个创作品类，**只需要在 `creator-app/src/config/categories.ts` 的 `CATEGORIES` 里加一条**，
UI（筛选器 / 表单 / 标签 / 徽章）、AI 提示词、资讯采集关键词会自动跟随，不需要改任何其它文件。

```ts
export interface CategoryDef {
  id: string;          // 稳定 ID，写进数据库，不可随意改
  label: string;       // 完整名称
  short: string;       // 紧凑名称（标签/筛选器）
  emoji: string;
  badge: string;       // Tailwind 徽章样式
  dot: string;
  titleLabel: string;          // 表单里"标题"字段的叫法
  titlePlaceholder: string;
  descriptionLabel: string;    // 表单里"简介"字段的叫法
  descriptionPlaceholder: string;
}
```

前后端各有一份等价的 `categories.ts`；后端用 `describeCategory()` 把品类描述注入 AI 提示词，
用 `buildSearchQueries()` 生成采集关键词，并设有 `MAX_QUERIES` 上限以控制采集合规与耗时。
`getCategory(id)` 对未知 ID 安全回退到默认品类，**不会抛错**，因此历史数据不会因品类调整而崩。

### 2. 安全加固

| 项 | 处理 |
|---|---|
| 访问控制 | 移除了原先的 6 位数字共享密码（公网弱口令意义有限），改为**不暴露任何服务端密钥**的公开 Demo |
| 源码暴露 | 线上改为生产构建，`/src/**.tsx` 不再可达 |
| CORS | 由 `cors()` 全开改为**白名单**：仅 `localhost:5173`、`127.0.0.1:5173` 与同源放行，其它一律不回 `Access-Control-Allow-Origin` |
| 请求体 | `express.json` 上限由 `50mb` 收紧到 `2mb` |
| 限流 | 分层限流（零依赖内存实现）：`/api/ai/*` 60s/20 次、`/api/news/collect` 600s/3 次、其它 `/api/*` 60s/120 次；`/api/health` 不限流 |
| AI 成本 | 每日配额 `AI_DAILY_LIMIT`（默认 300），只读 GET 与本地账户操作**不消耗**配额 |
| 代理信任 | `app.set('trust proxy', 1)`，限流取真实客户端 IP 而非隧道地址 |
| 密钥 | 全部走 `server/.env`，已 gitignore，**从未进入版本库** |

### 3. 同步健壮性 —— 不再静默覆盖云端

早期实现的致命缺陷：云端查询失败时返回空数据，与"云端本来就没有数据"无法区分，
于是本地空数据会**静默覆盖**云端真实数据。现已彻底修复：

**后端 `/download` 四态语义**

| 场景 | HTTP | 响应 |
|---|---|---|
| Supabase 未配置 | `503` | `{ code: 'NOT_CONFIGURED' }` |
| 查询失败 | `502` | `{ code: 'CLOUD_ERROR' }` + 服务端日志 |
| 成功但无数据 | `200` | `{ topics: [], scripts: [], uploadedAt: 0, empty: true }` |
| 成功有数据 | `200` | 正常数据 + `empty: false` |

关键实现：把 Supabase 的 `.single()` 换成 `.maybeSingle()` —— 否则 0 行会返回 `PGRST116`
错误，被误判成"查询失败"。

**乐观锁**

`POST /upload` 接受可选的 `baseUploadedAt`（上次同步到的云端时间戳）。
若云端已被其它设备更新（`cloud.uploaded_at > base`），返回 `409 CONFLICT` 而**不执行写入**。
前端收到 409 会自动转为**下载**而非强制覆盖。字段可选，因此旧客户端行为不受影响。

> 失败路径全部 `console.error` 落日志，不再静默吞掉。

### 4. 数据可靠性

- **原子写入**：`db.json` 采用 `写临时文件 → fsync 落盘 → rename 覆盖`，
  断电/崩溃不会产生半截 JSON；解析失败时把坏文件重命名为 `db.json.corrupt-<时间戳>` 留证后回退默认值
- **每日备份**：`tools/backup.ps1` 从 Supabase 拉取快照落盘到 `backups/`，
  含 4 类失败保护（截断 JSON / 缺字段 / HTTP 502 / 空结果集**一律拒绝落盘**），
  超 30 天自动清理，重复执行幂等
- **保活**：免费版 Supabase 连续 7 天无活动会暂停，`tools/keepalive.ps1` 每日唤醒 + 备份，
  单次网络请求完成两件事

### 5. 零依赖运行时

启动脚本优先使用 `tools/node/node.exe`（v22.22.2）与 `tools/cloudflared/cloudflared.exe`，
**换一台没有装 Node 的 Windows 电脑，解压即用。**

> 这两个二进制（83 MB + 52 MB）体积过大，**没有提交进本仓库**（见 `.gitignore`）。
> 想在本机复现：自备 Node 22，并从 Cloudflare 官网下载 `cloudflared.exe` 放进对应目录。

---

## 本地运行

### 一键启动（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File autostart.ps1
```

会自动：构建前端（若未构建）→ 启动 Express :3001 → 启动 Cloudflare 隧道，全部后台静默。

已配置**开机自启**：登录时由开始菜单「启动」文件夹中的 `Creator Studio.lnk` 触发，
开机后无需任何操作，约 30 秒服务就绪。

### 常用脚本

| 脚本 | 用途 |
|---|---|
| `发布更新.bat` | 改完代码一键构建 + 重启后端（= 上线，本地就是线上） |
| `停止服务.bat` / `stop.ps1` | 停掉后端 + 开发服务器 + 隧道 |
| `启动开发服务器.bat` | 开发模式：Vite :5173 热更新 + 后端 |
| `启动固定域名.bat` | 只启动 Cloudflare 隧道 |
| `启动前端.bat` / `启动后端.bat` | 单独启动，前台可见日志，调试用 |
| `build.ps1` | 只做生产构建（构建前先跑 React hooks 顺序体检），产物复制到 `server/public` |
| `tools/hooks-audit.mjs` | React hooks 顺序静态体检，拦截「early return 之后调用 hook」这种 `tsc` 抓不到、但会让整页白屏的运行期错误 |
| `自检.bat` / `tools/smoke-test.ps1` | 冒烟测试：本地 :3001 + 公网域名共 16 项断言（存活、SPA、无源码泄漏、API 404 契约、限流头、同步状态、打包产物、旧密码已清除），全过退出码 0 |

### 从零开始

```powershell
# 1. 装依赖（内置 node 自带 npm 时可用；否则用系统 node）
cd creator-app ; npm install
cd ..\server  ; npm install

# 2. 配密钥
copy server\.env.example server\.env
#   填入 DEEPSEEK_API_KEY / SUPABASE_URL / SUPABASE_ANON_KEY 等

# 3. 建表（Supabase SQL Editor 执行）
#   supabase-schema.sql

# 4. 启动
powershell -ExecutionPolicy Bypass -File autostart.ps1
```

---

## 目录结构

```
自媒体之路/
├─ autostart.ps1              开机自启：构建（如需）+ 后端 + 隧道
├─ stop.ps1                   停止全部服务
├─ build.ps1                  生产构建：前端 → server/public
├─ 发布更新.bat                一键构建 + 重启 = 上线
├─ 启动开发服务器.bat           开发模式（Vite 热更新）
├─ 启动固定域名.bat             只启 Cloudflare 隧道
├─ 启动前端.bat / 启动后端.bat   单独启动，前台可见日志
├─ 停止服务.bat                停止全部
├─ supabase-schema.sql        建表脚本
│
├─ creator-app/               前端 React + TS + Vite
│  └─ src/
│     ├─ config/categories.ts ★ 品类单一事实来源
│     ├─ api/client.ts         接口封装（含 ApiError 业务错误码）
│     ├─ services/syncService.ts  同步策略：乐观锁 / 冲突转下载
│     ├─ db/                   Dexie 本地库
│     ├─ store/                Zustand 状态
│     └─ pages/                资讯中心 / 选题看板 / 脚本编辑器 / 素材库 / 运营 / 数据看板
│
├─ server/                    后端 Express + tsx
│  ├─ src/
│  │  ├─ index.ts              入口：CORS 白名单 / 分层限流 / 静态托管 / SPA 兜底
│  │  ├─ middleware/rateLimit.ts  零依赖内存限流 + 每日配额
│  │  ├─ routes/               ai / news / sync
│  │  ├─ services/collectors/  RSS / YouTube / B站 / Steam 采集器
│  │  ├─ services/aiService.ts AI 能力封装
│  │  └─ db.ts                 db.json 原子读写
│  ├─ data/db.json            本地资讯数据
│  ├─ public/                 前端构建产物（Express 托管，gitignore）
│  └─ .env                    密钥（gitignore，切勿提交）
│
├─ tools/                     内置运行时
│  ├─ node/node.exe           Node.js v22.22.2
│  ├─ cloudflared/            Cloudflare 隧道客户端
│  ├─ backup.ps1              每日备份（失败保护 + 30 天保留）
│  └─ keepalive.ps1           Supabase 保活 + 备份
│
├─ backups/                   每日云端快照（gitignore）
└─ logs/                      运行日志（排错看这里，gitignore）
```

---

## 运维

### Cloudflare 隧道

配置文件：`C:\Users\12519\.cloudflared\config.yml`

```yaml
tunnel: 7b4f2dea-01c5-43b4-b606-d2a7bd835eb9
credentials-file: C:\Users\12519\.cloudflared\7b4f2dea-01c5-43b4-b606-d2a7bd835eb9.json
ingress:
  - hostname: creator.creator-app.xyz
    service: http://localhost:3001   # 生产构建，不要改回 5173
  - service: http_status:404
```

```powershell
tools\cloudflared\cloudflared.exe tunnel list          # 隧道列表
tools\cloudflared\cloudflared.exe tunnel info creator-studio   # 连通状态
```

### 每日任务

| 任务 | 时间 | 脚本 | 日志 |
|---|---|---|---|
| Supabase 保活 + 备份 | 每天 09:00 | `tools\keepalive.ps1` | `logs\keepalive.log` |

```powershell
schtasks /query /tn "CreatorStudio-SupabaseKeepAlive"
schtasks /run   /tn "CreatorStudio-SupabaseKeepAlive"
```

---

## 常见问题

**Q：网址打不开了？**
依次检查：① 电脑开着吗 ② `autostart.ps1` 跑着吗（`netstat -ano | findstr :3001`）
③ 看 `logs\named-tunnel.err.log` 有无报错。

**Q：手机打开是空白 / 看不到我的选题？**
多半是 Supabase 被暂停了。登录 [supabase.com/dashboard](https://supabase.com/dashboard) 看项目状态，
显示 `paused` 就点 **Resume project**（暂停不丢数据）。

**Q：改了代码怎么上线？**
双击 `发布更新.bat`。本地就是线上，不需要部署。

**Q：本机浏览器打不开公网域名？**
本机 DNS 对部分域名有缓存问题，本机请直接用 `http://localhost:3001`（生产）或 `http://localhost:5173`（开发）。

**Q：同步提示冲突 / 数据没同步上去？**
这是保护机制生效——云端有更新的数据，前端会自动改为下载云端版本。
若确认要以本机为准，在浏览器控制台执行 `localStorage.removeItem('lastSyncAt')` 后重新同步。

---

## 已知限制

- **单机部署**：网站可用性依赖这台 Windows 电脑开机；隧道客户端与后端都跑在本机
- **免费隧道无 SLA**：Cloudflare 免费版不保证可用性，也没有自定义 SLA
- **Supabase 免费版**：7 天无活动会暂停（已有每日保活）；存储与带宽有限额
- **云端单行快照**：`app_sync` 表固定 `id=1` 一行，设计目标是个人多设备同步，**不支持多人协作**
- **测试覆盖薄**：有端到端冒烟测试（`自检.bat`，16 项断言，覆盖存活/SPA/源码泄漏/404 契约/限流/同步/产物）和一项静态体检（`tools/hooks-audit.mjs`，已接进 `build.ps1`），但**仍无单元测试框架**，也没有浏览器端的自动化回归（无 Playwright/Puppeteer 依赖）
- **前端体积**：单 bundle 约 425 KB，未做路由级代码分割
- **AI 依赖外部 API**：DeepSeek 不可用时，AI 相关功能降级，其余功能不受影响

---

## License

个人项目，供学习与交流使用。
