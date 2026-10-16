# Creator Studio 托管部署方案（Render 单服务）

> 解决的问题：目前线上演示依赖一台家用 Windows 主机 + Cloudflare Tunnel，
> 电脑关机/睡眠/断网时链接就成了死链。把服务搬到云端托管后，
> 链接即可保持 24 小时可用，也避免被问「网站怎么打不开」时只能回答「家里电脑没开机」。

## 为什么是「单服务」

`server` 已经内置了静态托管与 SPA 回退（`server/public` → `express.static` → 非 API 路由回退 `index.html`），
前端 API 基址是同源相对路径 `/api`。所以**一个 Node 服务 = 前端 + API**，不需要拆成两个部署单元，
Render 免费层就能跑。

## 部署步骤

### 1. 本地构建（在 `D:\自媒体之路` 下）

```bash
cd creator-app
npm ci          # 已安装可跳过
npm run build   # 产出 dist/

# 把前端产物放进后端静态目录
rm -rf ../server/public && mkdir ../server/public
cp -r dist/* ../server/public/
```

### 2. 推送到 GitHub

`render.yaml`（本仓库已含模板）依赖 GitHub 仓库。确认 `creator-app/dist` 与 `node_modules`
都在 `.gitignore` 里（现有配置已忽略），`server/public` 是否入库由你决定：
推荐**不提交** `server/public`，改用 Render 的构建命令现场构建（见下）。

### 3. 在 Render 创建 Web Service

New → Web Service → 连接 `gdaksgd/creator-studio` 仓库，填：

| 字段 | 值 |
| --- | --- |
| Root Directory | `server` |
| Build Command | `npm ci && npm run build && cd ../creator-app && npm ci && npm run build && rm -rf ../server/public && mkdir ../server/public && cp -r dist/* ../server/public/` |
| Start Command | `npm start` |
| Instance Type | Free（0.1 CPU / 512 MB，够用） |

### 4. 环境变量（Render → Environment）

| 变量 | 说明 |
| --- | --- |
| `AUTH_SECRET` | **必填**。Render 免费层磁盘是临时的，`server/data/auth-secret.txt` 每次重启都会丢，不配它所有登录态会周期性失效。生成方式：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEEPSEEK_API_KEY` | 可选。不配则站内 AI 能力降级为「用户自带 Key」模式 |
| `YOUTUBE_API_KEY` | 可选。不配则资讯中心只跑 RSS + B站 |
| `HTTP_PROXY` | 留空（Render 服务器在海外，不需要代理） |
| `COLLECT_INTERVAL` / `LIGHT_COLLECT_INTERVAL` | 可选。注意：免费层 15 分钟无请求会休眠，进程内 cron 在休眠期间不会触发，恢复后由启动时的采集逻辑兜底 |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | 可选。不配则登录/云同步功能关闭，站点以「本地优先 + 演示数据」运行，完全可用 |

### 5. 自定义域名（可选但建议）

现有域名 `creator.creator-app.xyz` 在 Cloudflare：

1. Cloudflare DNS 面板新增一条 CNAME，指向 Render 给的 `onrender.com` 地址；
2. Render → Settings → Custom Domain 添加同域名，自动签发证书。

换域名后记得同步更新：README 的在线体验链接、`creator-app/src/config/contact.ts` 里的入口、对外公布过的链接。

## 免费层的诚实代价

- **冷启动**：15 分钟无访问后休眠，下一次打开要等 30–60 秒（第一次点开会看到较长的加载）。需要稳定在线的时段建议升到 `Starter`（$7/月）常驻，之后可随时降回 Free。
- **磁盘临时**：`data/` 下的缓存与自动生成的密钥重启即失；上面的 `AUTH_SECRET` 配置已规避密钥问题，基准缓存丢失只是重新采集。
- **替代选项**：Railway（$5 起步）、Fly.io（按量计费，有免费额）架构相同，本方案的「单服务 + 同源 /api」对它们同样适用。

## 支付不了 / 没有海外银行卡？可选路线

### 路线 A：Render 免费层 —— 一分钱不用花，也不需要绑卡

Render 的免费层（750 实例小时/月，512 MB RAM）**注册和使用都不需要信用卡**，
只要不主动升级到付费计划就不会碰到任何支付环节。上面整篇文档在免费层上完全可用。

代价只有一个：闲置 15 分钟后休眠，下一次打开有 30–60 秒冷启动。
对访问体验的影响是第一次点开要等一下——可以接受的话，这是零成本方案。

### 路线 B：国内云厂商香港轻量服务器 —— 支付宝/微信付款，大陆访问快

如果愿意每月花几十元换「打开就是秒开」，推荐腾讯云或阿里云的**香港**轻量应用服务器：

- **为什么是香港节点**：大陆节点要求域名 ICP 备案（`creator-app.xyz` 这类海外注册域名走不通，周期也长）；香港节点免备案、支付宝/微信直接付款、大陆访问延迟约 30–60ms。
- **配置与价格**：2C2G 即可（512 MB 也够跑，但 2G 舒服）。行情参考（2026，活动价/渠道价，以官网实时报价为准）：腾讯云轻量 2核2G 约 **288 元/年**（月均 24 元），阿里云轻量 2核2G 约 **288–468 元/年**（月均 24–39 元）。注意：腾讯官方注明香港入门机型不保障内地跨境网络质量，高峰期可能有延迟/丢包——个人作品站通常够用，介意的话优先咨询客服或选高一级规格。
- **部署步骤**（购买后 SSH 登录）：

```bash
# 1. 安装 Node.js 22（以 Ubuntu 为例）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2. 拉取仓库并构建
git clone https://github.com/gdaksgd/creator-studio.git && cd creator-studio
cd creator-app && npm ci && npm run build
rm -rf ../server/public && mkdir ../server/public && cp -r dist/* ../server/public/
cd ../server && npm ci && npm run build

# 3. 环境变量（写入 server/.env，参考 server/.env.example）
# 必须配 AUTH_SECRET；DEEPSEEK_API_KEY / YOUTUBE_API_KEY 按需
# HTTP_PROXY 留空（香港直连海外）

# 4. 用 pm2 常驻
npm i -g pm2 && pm2 start dist/index.js --name creator-studio && pm2 save && pm2 startup
```

- **域名**：Cloudflare DNS 把 `creator.creator-app.xyz` 解析到服务器 IP（亮云朵即可获得 CDN 与免费 HTTPS；「小云朵」模式对香港节点同样适用）。
- 服务器上记得开 80/443 端口（安全组），并做基础的 `ufw` 防火墙配置。

### 不建议的选项（2026 年现状）

- **Zeabur**：中文界面 + 支付宝很诱人，但 2026 年 5 月起个人免费集群已关闭，个人用户需付费。
- **Koyeb**：免费实例仍在，但注册需绑卡并预授权 $29，无海外卡不可用。
- **Fly.io / Railway**：注册或试用后均需绑卡。
- **Vercel / Cloudflare Workers**：无卡可注册，但本项目后端是常驻 Express + 进程内定时采集，无法直接迁移，不划算。

## 部署后的检查清单

- [ ] 直接访问 `https://你的域名/` 首页能打开，第一次打开自动载入演示数据
- [ ] `/marketing-briefs` 能看到两份演示简报，`/experiments` 能看到两个演示实验
- [ ] `/report` 能打开（首次会触发服务端采集，稍慢是正常的）
- [ ] 手机视口打开首页正常
- [ ] 对外链接替换成新域名，旧家用机方案停用或保留为备用
- [ ] README「在线体验」一节更新为新地址
