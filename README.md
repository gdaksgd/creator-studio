# Creator Studio · 自媒体创作助手

一个面向游戏内容创作者的**选题 → 脚本 → 素材 → 发布**全流程工作台。
资讯自动采集、按品类归类，AI 辅助生成选题与脚本，数据本地优先并同步到云端，
通过 Cloudflare Tunnel 从手机/平板/任意电脑访问。

> **在线 Demo：[https://creator.creator-app.xyz](https://creator.creator-app.xyz)**（无需密码，打开即用）

---

## 目录

- [功能](#功能)
- [版本演进](#版本演进)
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
| **选题看板** | 按品类筛选、按优先级排序；状态流转（想法 → 调研 → 已通过 → 写脚本 → 已完成 → 已发布），发布后粘贴链接即可回填真实数据 |
| **脚本编辑器** | 结构化脚本编辑，AI 生成选题评估与标题评分，支持重新生成与历史保留 |
| **素材库** | 收藏图片/视频/链接素材，按品类与类型归档 |
| **账号运营** | 追踪各平台账号数据，AI 生成运营建议 |
| **预测校准** | **把 AI 的「预估播放」和 B站真实播放对上**——粘贴视频链接即取回真实播放/点赞/投币/收藏/分享/评论，自动算偏差；只统计两边都有数据的样本，缺一边的单独列清单，绝不补 0 |
| **品类基准线** | 从 B站真实样本算出各品类的播放分位与互动率水位线（**强制显示样本量与时间窗**），AI 评估结论据此带上「数据依据」，让用户分清数字是算出来的还是猜出来的 |
| **分析报告** | 把基准线数据做成一件能带走的东西：《B站游戏区内容分析报告》——品类竞争强度、TOP 作品标题模式、时长–互动率曲线、发布时段分布 + 对自己选题的具体建议；**每个数字都标注样本量与统计口径**，可一键导出 Markdown |
| **平台适配检查** | **把论文和官方文档变成能勾选的清单**——粘贴脚本标题/封面文案，选 B站 或抖音，给出 9 条带出处的规则结论（时长区间、疑问句标题、封面情绪、CTR 参考线、更新节奏、完播率分档、标题党反向清单…）；每条规则都标证据等级 A/B/C，**没有 AI 也能跑**，AI 只负责在你点按钮时润色文案 |
| **数据同步** | 本地 IndexedDB 优先，云端 Supabase 单行快照同步；冲突检测、失败不误覆盖 |
| **AI 辅助** | 选题评估、标题评分、素材分析、标题批量翻译（英文源站资讯） |

### 支持的创作品类（可在配置中自由增删）

🃏 卡牌游戏 · 👻 恐怖游戏 · 🎮 独立游戏 · 🗡️ RPG/剧情向 · ⚔️ 动作冒险 · 🏗️ 模拟经营 · 📱 手游 · 📰 行业资讯

> 另有一个仅供资讯采集落桶的「📌 综合资讯」品类，不参与创作选题。

---

## 版本演进

这个仓库不是「一次性写完」的，而是按里程碑一步步长出来的。**每一版都打了 tag，可以直接检出对照**：

| 版本 | 里程碑 | 这一版做了什么 | 代码 |
|---|---|---|---|
| `v1.0.0` | 最初版本 | 资讯 / 选题 / 脚本 / 素材四大模块 + 云端同步 + 密码门 | [tree](https://github.com/gdaksgd/creator-studio/tree/v1.0.0) |
| `v1.1.0` | **M0 工程化加固** | 去掉密码门、品类收成单一事实来源、db 改原子写、分层限流 + 每日配额、自检/备份/保活脚本 | [tree](https://github.com/gdaksgd/creator-studio/tree/v1.1.0) |
| `v1.2.0` | **M1 选题–结果闭环** | 粘贴 B站链接取回真实播放/点赞/投币/收藏/分享/评论，把 AI 的「预估播放」和真实数据对上并算偏差；缺数据的样本单列，不补 0 | [tree](https://github.com/gdaksgd/creator-studio/tree/v1.2.0) |
| `v1.3.0` | **M2 品类基准线** | 从 B站游戏区榜单真实样本算出各品类播放分位与互动率水位线（强制显示样本量与时间窗），AI 结论据此带上「数据依据」 | [tree](https://github.com/gdaksgd/creator-studio/tree/v1.3.0) |
| `v1.4.0` | **M3 分析报告生成** | 把工具的能力变成一件**可导出的作品**：《B站游戏区内容分析报告》——品类竞争强度 / 标题模式 / 时长–互动率 / 发布时段 + 针对自己选题的建议，每个数字都带样本量与口径，可导出 Markdown | [tree](https://github.com/gdaksgd/creator-studio/tree/v1.4.0) |
| `v1.5.0` | **M4 封面 + 平台适配** | 把学术结论和官方文档变成**可执行的检查器**：同一份脚本选 B站 给 3–10 分钟、选抖音给 1–3 分钟（并给拆条建议）；9 条规则逐条标注出处与证据等级 A/B/C；**纯规则引擎，没有 AI 也能给出全部结论** | [tree](https://github.com/gdaksgd/creator-studio/tree/v1.5.0) |

> `v1.1.0` / `v1.2.0` / `v1.3.0` / `v1.4.0` / `v1.5.0` 五个快照都跑过后端 `tsc --noEmit` 与前端 `tsc -b`，是能跑通的完整快照，不是残缺的中间态。

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

### 6. 数据诚实原则 —— 每个数字都要说得清它是怎么来的

这个项目里最容易做错的事，是**用 `0` 冒充「没有数据」**。原来的代码就是这样：
`Topic.estimatedViews` 在新建选题时写入 `0`，然后在**整个代码库里从未被读取过一次**。

现在前端有一条硬规则：**每个展示给用户的数字都必须有出处**，拿不到就显示「暂无数据」，
**绝不能用 `0` 或占位数字代替**。落地在这条闭环上：

```
AI 评估选题 → 给出「预估播放 5-10万」
   ↓ parseEstimatedViews() 解析成 75000（解不出来返回 null，绝不瞎猜）
发布视频     → 粘贴 B站链接 → 后端调 /x/web-interface/view 取真实数据
   ↓ 取不到就明确报错（BAD_INPUT / NOT_FOUND / RISK_CONTROL / NETWORK），不返回 0
预测校准页   → 平均绝对偏差 · 系统性高估/低估 · 逐条对比
   ↓ 缺预测值或缺实际数据的选题单列清单，不混进统计
```

**设计取舍也记在这里**：原计划是自动列出自己账号的全部视频、再按标题模糊匹配回填。
实测 `/x/space/wbi/arc/search` 稳定返回 `-352 风控校验失败`（带 WBI 签名 + `buvid3` cookie 也一样），
而 `/x/web-interface/view` 单条取数 8/8 成功。于是**放弃了会静默失败的自动匹配，
改走不会撒谎的精确链路**——顺带消灭了「标题匹配错人」这一整类错误。

同一条原则贯穿到 AI 的每一次判断里。**AI 说「预估 5-10 万」时，用户有权知道这个数字是算出来的还是猜的**：

```
品类基准线（后台采集）→ B站搜索「近 30 天 · 按播放量排序」30 条样本
   ↓ 中位数 / P25 / P75 / P90；样本量不足 15 条就整条不发布
注入 AI 提示词       → 「来源｜时间窗｜样本量｜播放分位｜互动率」+ 4 条引用要求
   ↓ basis 由服务端按真实样本计算，模型无法自己声明「我有数据支撑」
响应里的 basis       → source=benchmark{样本量 30, 时间窗 30 天, 分位 P62}
                      / source=ai（没有样本，界面直接标「纯 AI 推断，未经数据校验」）
```

数据源不提供的指标**字段直接不存在**（B站搜索接口没有投币数与分享数），
界面显示「—」并注明原因，而不是填 0 或估计值；样本量不够的品类同样**不发布基准线**，
而是列进「样本不足」清单（例如 GMV 分区只采到 2 条）。

**探针抓到过的两个真实缺陷**（都只在真实数据上暴露，`tsc` 全程通过）：

1. `parseEstimatedViews` 对「5-10万」返回 `null` —— 第一个数字没带单位时，没有继承第二个数字的单位；
2. 品类搜索全部返回 `code=-400` —— `signWbi()` 只返回 `{w_rid, wts}`，把它当成完整参数直接拼 URL，业务参数全丢了。

还有一个更隐蔽的：AI 回一句「依据不足，无法预估」时，解析器会从解释文字里
抓出「粉丝 10 人」当成播放量预测，进而算出一条**完全错误的**「你的预测低于样本最低值（P0）」。
现在这类措辞会被直接拦掉，`basis` 只报告来源与样本量，不假装知道分位。

---

### 7. 把分析做成一件能带走的作品 —— 数字和出处长在一起

M3 的《B站游戏区内容分析报告》不只是个页面，它是这个项目的**交付物**：可以导出成 Markdown
发给别人看。这类东西最容易在「导出」这一步失守——页面上标注得很清楚，导出件里只剩一排裸数字。

所以报告的数据结构本身就堵死了这条路：**每个数字都是一个 `ReportMetric`**：

```
ReportMetric {
  label: '播放中位数', value: 1069000, display: '106.9万', unit: 'views',
  basis: { source: 'bilibili-popular', sourceLabel: 'B站热门榜·单机游戏',
           sampleSize: 30, windowDays: null, collectedAt: 17…, method: '中位数' }
}
```

渲染层（JSON 与 Markdown 共用同一份数据）**没有「只打印数字」的代码路径**：表格里每个数字右边
都跟着一列「来源与样本量」。这不是靠自觉，是靠类型。

再往上一层还有一道自检：`validateReport()` 递归遍历整份报告，数出**一共有多少个数字、其中多少个没有出处**，
写进 `selfCheck { metricCount, unbackedMetricCount }`。实测值 **64 个数字 / 0 个无出处**，
冒烟测试直接断言 `unbackedMetricCount == 0`——数字一旦失去出处，CI 就红。

**导出件也是后端渲染的**（`GET /api/report/game-industry.md`），前端只负责触发下载。
这样「导出物」是可以用 `curl` 直接断言的一等公民，而不是「浏览器里看着对」。
导出件第一行是一条 ASCII 自检标记：

```
<!-- report-selfcheck ready=true metrics=64 unbacked=0 -->
```

（冒烟脚本 `tools/smoke-test.ps1` 必须保持**纯 ASCII**——PowerShell 5.1 在没有 BOM 时按 ANSI 读 `.ps1`，
中文字面量会乱码。所以中文断言一律改由后端输出 ASCII 标记来完成。）

样本不达标的维度**不出数字**，而是进 `unavailable` 清单在页面单独列出：时长曲线每个桶至少 10 条
（低于此的桶会夺冠，不可信）、标题模式至少 20 条、发布时段至少 20 条、品类水位线至少 15 条。

真实局限也写进报告本身，而不是藏在 README 里：关键词是用「极大重复子串 + 词频」做的，
**不是分词**（无词典，最长 6 字，已去停用词与被更高频长词覆盖的短词），所以只能说
「这批标题在反复说什么」，不等于语义主题分析——这句话就印在导出件的 `caveat` 里。

**探针在真实数据上抓到的缺陷**（`tsc` 全程通过，都是「逻辑上说得通、数据上不成立」）：

1. 点赞率最高的桶和播放量最高的桶恰好是同一个桶时，建议文案仍写「两者不是同一个桶」；
2. 关键词同时输出「世界(12)」和「的世界(7)」——子串频次统计把长词和它的后缀都算了一遍；
3. `MIN_CURVE_BUCKET` 原设 5，导致一个只有 7 条样本的桶夺冠，抬到 10 才符合「够样本才有结论」；
4. Markdown 把集中度阈值印成 `0.6 / 0.4`，而口径说明里写的是「60% / 40%」。

### 8. 把「结论」和「出处」焊在一起 —— 规则引擎不靠 AI 也能工作

M2/M3 解决的是「数字从哪来」，M4 解决的是「建议从哪来」。

`server/src/services/platformRules.ts` 是一个**零依赖的纯规则引擎**（`RULE_ENGINE_ID = 'pure-rules-v1'`）：输入标题、封面文案、时长、CTR、完播率、更新频率，输出 9 条结论。它不认识 OpenAI，也不读环境变量——**没有 `DEEPSEEK_API_KEY` 时功能完全可用**，AI 只在用户主动点「用 AI 润色封面文案」时才被调用，而且调用时提示词里明写「不要编造任何数据、播放量、排名、奖项」，规则结论作为硬约束传进去。

每条规则返回的结构里，出处不是一个可选的备注，而是**必填字段**：

```ts
export interface PlatformRule {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'info';
  detail: string;
  hint?: string;
  evidence: { source: string; level: 'A' | 'B' | 'C'; note?: string };  // 每条都必须有
}
```

| 证据等级 | 含义 | 例 |
|---|---|---|
| A | 同行评审论文 / 平台官方文档 | Cui et al. (2024) JBR 183:114849，16,215 个 YouTube 封面；B站 CEO 公开表态（前台播放量改为播放分钟数） |
| B | 第三方大样本转述 | 蝉妈妈转述的抖音完播率分档（明确标注「非官方原文，只作参考区间」） |
| C | 经验帖 / 本项目自定义阈值 | 「强情绪词 20 个」「标题党词 9 个」这类词表 |

`summary` 里必须满足 `sourced === total`（每条规则都有出处），冒烟测试直接断言这一点。**不知道就明说**：不填封面文案时，封面那条规则是 `info`（「不填就不会给结论」）而不是伪造一个 pass；封面像素规则永远是 `info`，因为「本工具只读文案不分析像素」。

同一个脚本、两个平台，结论必须不同——这是验收项，也是规则引擎存在的理由：

| 平台 | 时长目标 | 同一份 7.5 分钟脚本 |
|---|---|---|
| B站 | 3–10 分钟 | `pass`（落在区间内） |
| 抖音 | 1–3 分钟 | `warn` + 拆条建议（「按一个钩子一条拆成 2–3 条」） |

前端 `components/PlatformCheckPanel.tsx` 一次拉两个平台的结论并列展示，逐条渲染 `出处：…` 与 A/B/C 徽标；用户在标题框里每输入一个字都会 800ms 防抖后重算（避免打满 `/api/ai` 的 20 次/分钟限流）。这是纯规则接口，`/api/ai/evaluate-cover` 在 `useAI !== true` 时**不消耗每日 AI 配额**（`server/src/index.ts` 里显式豁免）。

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
| `自检.bat` / `tools/smoke-test.ps1` | 冒烟测试：本地 :3001 + 公网域名共 52 项断言（存活、SPA、无源码泄漏、API 404 契约、限流头、同步状态、打包产物、旧密码已清除、发布结果回填接口、品类基准线接口、分析报告接口、报告数字全部带出处、Markdown 导出、平台适配检查接口、每条规则都带出处、两平台时长结论不同），全过退出码 0 |

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
│     ├─ components/PlatformCheckPanel.tsx  M4 平台适配检查面板（逐条规则带出处 + A/B/C 证据等级）
│     ├─ utils/prediction.ts   预估播放文本 → 数字（解析不出返回 null，不瞎猜）
│     └─ pages/                资讯中心 / 选题看板 / 脚本编辑器 / 素材库 / 运营 / 数据看板 / 分析报告
│
├─ server/                    后端 Express + tsx
│  ├─ src/
│  │  ├─ index.ts              入口：CORS 白名单 / 分层限流 / 静态托管 / SPA 兜底
│  │  ├─ middleware/rateLimit.ts  零依赖内存限流 + 每日配额
│  │  ├─ routes/               ai / news / sync / video / benchmark / report
│  │  ├─ services/collectors/  RSS / YouTube / B站 / Steam 采集器（+ 基准线采集器）
│  │  ├─ services/aiService.ts AI 能力封装
│  │  ├─ services/platformRules.ts      M4 平台规则引擎：9 条规则 + 证据等级（零依赖，不调 AI 也能跑）
│  │  ├─ services/videoStatService.ts  单条 B站视频真实数据（BV/av/链接/短链 + 5 分钟缓存）
│  │  ├─ services/benchmarkService.ts  品类基准线：真实样本 → 播放分位 / 互动率水位线（6 小时缓存）
│  │  ├─ services/reportService.ts     M3 分析报告：样本池 → 五个维度的结论 + Markdown 导出
│  │  └─ db.ts                 db.json 原子读写
│  ├─ data/db.json            本地资讯数据
│  ├─ public/                 前端构建产物（Express 托管，gitignore）
│  └─ .env                    密钥（gitignore，切勿提交）
│
├─ tools/                     内置运行时（node/node.exe 与 cloudflared/ 体积过大未提交，见 .gitignore）
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
- **测试覆盖薄**：有端到端冒烟测试（`自检.bat`，52 项断言，覆盖存活/SPA/源码泄漏/404 契约/限流/同步/产物/发布结果回填/品类基准线/分析报告/报告出处自检/Markdown 导出/平台适配检查/每条规则都带出处/两平台结论不同）和一项静态体检（`tools/hooks-audit.mjs`，已接进 `build.ps1`），但**仍无单元测试框架**，也没有浏览器端的自动化回归（无 Playwright/Puppeteer 依赖）
- **基准线是头部样本口径**：热门榜只覆盖各分区头部内容，不是全量分布；品类线取「近 30 天按播放排序」，天然偏头部。界面已明确标注口径，**不可当作全量播放分布**
- **部分互动指标拿不到**：B站搜索接口不返回投币数与分享数，所以品类级基准线只有点赞率与收藏率；投币率/分享率仅在热门榜口径（游戏区整体与子分区）可用
- **基准线有 6 小时缓存**：为避免触发 B站风控，同一次采集结果缓存 6 小时，不做实时刷新；刷新接口限流 10 分钟 3 次
- **无法自动列出自己账号的全部视频**：B站 `/x/space/wbi/arc/search` 稳定返回 `-352 风控校验失败`（带 WBI 签名与 `buvid3` cookie 也一样）。因此发布结果回填采用「粘贴视频链接」的精确取数，不依赖登录态
- **报告中的因果关系全是相关性**：时长–互动率、发布时段这些维度都是**观测相关性**，样本又偏头部，不能当作「这样做就一定涨播放」的因果结论；报告里每个维度都写了 caveat
- **时长曲线的样本量要求**：每个时长桶至少 10 条样本才计入趋势，低于此的桶会被排除（低于 10 条时偶然夺冠不可信），所以冷启动初期曲线可能只有少数几段
- **关键词不是分词**：报告里的标题高频词用「极大重复子串 + 词频」统计得到（最长 6 字，无词典、已去停用词与被更高频长词覆盖的短词），只能说「这批标题在反复说什么」，**不等于语义主题分析**
- **只支持默认 30 天口径**：报告接口对其它 `days` 值返回 400 而不是静默按 30 天算——搜索池只按 30 天窗口采集，报别的数字就是撒谎
- **前端体积**：单 bundle 约 466 KB（gzip 约 137 KB），未做路由级代码分割
- **平台规则里的阈值是自定义的**：9 条规则里 A/B 级来源是论文、官方文档和第三方大样本转述，但「强情绪词」词表、「标题党词」词表、「1–2 条/周」这类阈值是本项目自己定的（界面里标为 C 级），**不是平台算法，也不该拿去当 KPI**
- **封面检查只读文案，不分析像素**：M4 不评估封面图的清晰度/色彩/亮度（需要图像处理依赖，违反零依赖原则），面板里明确写了「本工具只读文案不分析像素」
- **CTR 与完播率要手填**：B站/抖音都没有公开的 CTR、完播率接口，这两项只能手动填入，不填就不出结论（不编一个数糊上去）
- **AI 依赖外部 API**：DeepSeek 不可用时，AI 相关功能降级，其余功能不受影响

---

## License

个人项目，供学习与交流使用。
