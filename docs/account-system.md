# 云端账号制（一人一份云端数据）

> 2026-10-12 实施。改动前 `/api/sync/upload`、`/api/sync/download` 直接读写 Supabase 的
> `app_sync` 单行且**没有任何鉴权**——任何人访问 `https://creator.creator-app.xyz/api/sync/download`
> 都能拿到全部云端数据（实测 HTTP 200 / 46447 字节）。本文记录改造后的结构、契约与验收。

## 1. 为什么是「单行 + 账号隔离」而不是「每账号一行」

- `server/.env` 里只有 Supabase 的 **anon key**（没有 service key，也没有 DDL 权限），
  **不能新建表**；
- `supabase-schema.sql:11` 有 `CONSTRAINT single_row CHECK (id = 1)`，
  连插第二行都不行。

所以复用原来那一行（`app_sync.id = 1`），把 `data` 从 v1 升级为 v2，
**按账号切分数据**，隔离在服务端 API 层完成（请求体里的 userId 一律忽略，只认 token）。

## 2. 数据结构（`data` 字段）

```jsonc
{
  "version": 2,
  "users": [
    { "id": "uuid", "username": "阿康", "usernameKey": "阿康",
      "passwordHash": "scrypt$16384$8$1$<salt>$<hash>", "createdAt": 1791815206730 }
  ],
  "accounts": {
    "<userId>": {
      "topics": [...], "scripts": [...], "uploadedAt": 1791815240671,
      "ai": { "deepseekApiKey": "enc.v1.<iv>.<tag>.<ct>", "updatedAt": 1791816000000 }  // 可选，见第 10 节
    }
  },
  "legacy": { "topics": [...], "scripts": [...], "uploadedAt": 0 }  // 可选
}
```

- 读到 v1（顶层就是 `topics` / `scripts`）时**自动迁移**：老数据进 `legacy`，一条不丢；
- `legacy` **没有任何接口会返回它**（`/api/sync/download` 只返回当前账号的 `accounts[userId]`），
  也不会混进新账号的第一次下载；
- 行级 `uploaded_at` = `accounts` 与 `legacy` 里最新的 `uploadedAt`（给运维看的时间戳）；
- 写入用 `updateCloud()`：模块级 promise 链把「读-改-写」串行化，避免并发注册互相覆盖。

实现：`server/src/services/cloudStore.ts`。

## 3. API 契约

| 方法与路径 | 鉴权 | 成功 | 失败 |
| --- | --- | --- | --- |
| `POST /api/auth/register` | 无 | 201 `{token, user:{id,username,createdAt}}` | 400 `BAD_REQUEST`（用户名 3–24 字符、密码 ≥6）／409 `USERNAME_TAKEN`／503 `NOT_CONFIGURED` |
| `POST /api/auth/login` | 无 | 200 `{token, user}` | 401 `BAD_CREDENTIALS`／503 |
| `GET /api/auth/me` | Bearer | 200 `{user, cloud:{uploadedAt,topicCount,scriptCount}}` | 401 `UNAUTHORIZED` |
| `POST /api/auth/logout` | Bearer | 200 `{success:true}` | 401 |
| `GET /api/auth/status` | 无 | 200 `{authConfigured:boolean}` | — |
| `POST /api/sync/upload` | **Bearer** | 200 | 401 `UNAUTHORIZED`／409 `CONFLICT`（`baseUploadedAt` 落后，返回 `cloudUploadedAt`） |
| `GET /api/sync/download` | **Bearer** | 200 `{topics,scripts,uploadedAt,empty}` | 401／502 `CLOUD_ERROR`／503 |
| `GET /api/sync/status` | 无 | 200 `{syncConfigured, accountMode:true}` | — |
| `GET /api/ai-config` | **Bearer** | 200 `{configured, maskedKey, updatedAt, serverConfigured}` | 401 |
| `PUT /api/ai-config` | **Bearer** | 200 同 GET（`apiKey:''` 表示清除本账号的 Key） | 400 `BAD_KEY`（长度 < 12 或 > 200、含空白）／缺失字段 400／502 `AI_CONFIG_ERROR` |
| `POST /api/ai-config/test` | **Bearer** | 200 `{ok, message}`（用请求体里的 Key，没有就用已保存的） | 400 `NO_KEY` ／401 |

- 无 token / token 过期 / 用户已被删除 → 401 `{error:"未登录或登录已过期", code:"UNAUTHORIZED"}`；
- `/api/auth/register` 限流 **5 次 / 10 分钟**，`/api/auth/login` **12 次 / 分钟**（按 IP）；
- 查询云端失败**绝不伪装成「云端为空」**（避免用本地数据覆盖云端），这是改造前就有的语义，继续保留。

## 4. 口令与令牌

- 口令：`node:crypto` 的 `scrypt`，`N=16384, r=8, p=1, keylen=32, maxmem=64MB`，
  存成 `scrypt$N$r$p$<saltB64url>$<hashB64url>`；校验用 `timingSafeEqual`；
  登录时用户不存在也会跑一次 scrypt（防用户名枚举）。
- 令牌：无状态 `${base64url(userId)}.${exp}.${hmacSha256Base64url(payload)}`，有效期 **90 天**；
  密钥取环境变量 `AUTH_SECRET`（≥16 字符），没配就自动生成 32 字节 hex 存
  `server/data/auth-secret.txt`（mode 0600，已在 `.gitignore` 覆盖的 data 目录里）。
- **注意**：`AUTH_SECRET` 变了或 `auth-secret.txt` 丢了，所有已发出的 token 失效，
  用户需要重新登录（数据不受影响）。

实现：`server/src/services/authStore.ts`、`server/src/middleware/requireAuth.ts`。

## 5. 前端接线

- token 存 `localStorage['creator-studio-token']`；`creator-app/src/api/client.ts` 的
  `request()` 只在有 token 时注入 `Authorization: Bearer …`，并导出 `setAuthToken()`；
- `creator-app/src/services/authService.ts`：`useAuthStore`（`init/register/login/logout/refreshMe`）
  - 登录/注册成功后 `afterAuthSuccess()`：**先清演示数据** → `syncOnLaunch()` → `refreshMe()`；
- 启动链：`init()` → `syncOnLaunch()` → `ensureDemoData()`；
  **有 token 时 `ensureDemoData()` 直接返回**（已登录用户不会被塞演示数据）；
- 401（token 过期/被清）：`syncService` 清 token + 提示「登录已过期，请重新登录」，并向上抛，
  不当作普通网络错误吞掉；
- **演示数据永不进云端**：`syncUpload()` 上传前过滤掉 id 以 `demo-` 开头的记录
  （设置页在已登录状态下也能点「载入演示数据」，过滤后那句
  「演示数据不会进入云端同步」才成立）。

## 6. 老数据认领（legacy）

账号制之前的云端数据是**匿名**上传的，无法自动判断属于谁，因此：

```powershell
cd D:\自媒体之路\server
npx.cmd tsx scripts/cloud-admin.ts stats                      # 只读：账号数 / 每账号条数 / legacy 数量
npx.cmd tsx scripts/cloud-admin.ts adopt-legacy <用户名>       # 把 legacy 交给该账号（账号已有数据时要 --force）
npx.cmd tsx scripts/cloud-admin.ts prune-prefix selftest      # 清理用户名以某前缀开头的测试账号
npx.cmd tsx scripts/cloud-admin.ts rewrite                    # 原样写回（排查写入链路）
```

2026-10-12 的线上那一行已经迁移成 v2：`legacy` 里保留着改造前的 **2 个选题 + 2 个脚本**，
账号数为 0。用户注册后执行 `adopt-legacy <用户名>` 即可认领；不认领也不影响使用。
（另外还留了两份离线备份：`D:\wp\_legacy-cloud-backup.json`、
`server/data/legacy-cloud-backup-20261012.json`。）

## 7. 传输层优化（顺带做掉）

- `server/src/middleware/compression.ts`：
  - `gzipJson()`：JSON/文本响应 ≥1KB 且压缩后更小时自动 gzip（手写，避免新增依赖）；
  - `ensurePrecompressed()`：启动时给 `server/public` 下的 js/css/html/svg/json 生成 `.gz`（level 9）；
  - `servePrecompressed()`：命中 `.gz` 直接下发，`/assets/*` 带
    `Cache-Control: public, max-age=31536000, immutable`，HTML 走 `no-cache`。
- 实测：`/assets/index-B-0RHLyr.js` 36,393 → **14,745 字节（gzip，−59%）**，
  且 `Content-Encoding: gzip` + `Vary: Accept-Encoding` + immutable；
  `/api/news?page=1`、`/api/report/game-industry` 也已是 gzip。

## 8. 验收记录（2026-10-12）

| 项目 | 结果 |
| --- | --- |
| `server` `tsc --noEmit` | EXIT 0 |
| 前端 `tsc --noEmit -p tsconfig.app.json` | EXIT 0 |
| mock Supabase（`D:\wp\_cloud-mock.mjs` + 3102 实例）`_account-probe.mjs` | **24/24 PASS**（含账号隔离、legacy 不外泄、409 乐观锁、scrypt 无明文、过期 token 401） |
| 线上（真实 Supabase，`_live-account-probe.mjs`） | **16/16 PASS**（注册/重名 409/隔离/me/登录/错密码 401/匿名与伪造 token 401/logout） |
| `tools\panel-e2e.mjs` | 25/25 PASS |
| `tools\smoke-test.ps1`（本机 / 公网） | **33/33** / **66/66** PASS（新增 `/api/auth/status`、`/api/sync/download` 401、vendor chunk 三项断言） |
| 预压缩文件 | 启动日志 `[static] 生成 23 个 .gz 预压缩文件` |

## 9. 已知取舍与遗留

1. 所有账号仍然睡在**同一行** JSON 里：读写是整行覆盖（已串行化）。账号数量级到几百个、
   或单账号数据到几 MB 时，才需要真正的多行/多表方案（那需要 service key）。
2. 注册/登录限流按 IP，且内存计数（重启清零）——和站内其它限流一致，够用但不抗分布式攻击。
3. `legacy` 的 `uploadedAt` 迁移后是 0（旧行的 `data` 里本来就没有这个字段，时间戳只在行级
   `uploaded_at` 列上），认领时会写成当前时间。
4. 没有找回密码/改密码接口：忘记口令只能重新注册（数据在旧账号里，可用 `cloud-admin.ts` 查看）。
5. 关掉密码登录的开关不存在——只要 Supabase 配好了，账号接口就是开的。
6. 账号级 AI Key 存在同一行 JSON 里（加密后），所以第 1 条的取舍同样适用。

## 10. 账号级 AI 配置（2026-10-12 追加）

**为什么改**：原先 AI 的 DeepSeek Key 只能写在 `server/.env` 里，设置页还教用户去改
`D:\自媒体之路\server\.env`——普通访客不可能做到；而且站点共用一把 Key，成本无法归属到人。

**现在的模型**：一个账号一份 Key，跟着账号走。

| 项 | 处理 |
| --- | --- |
| 存储 | `accounts[userId].ai = { deepseekApiKey, updatedAt }`，与选题/脚本同一份云端数据 |
| 加密 | AES-256-GCM，随机 12 字节 IV，存成 `enc.v1.<iv>.<tag>.<ct>`（base64url）；密钥由 `AUTH_SECRET`／`server/data/auth-secret.txt` 用 `sha256(secret + '\|ai-config-v1')` 派生（`server/src/services/aiConfigStore.ts`） |
| 回显 | 接口**只回掩码**（前 5 + `****` + 后 4），明文只在服务端内存里；前端输入框永远不回填明文 |
| 生效优先级 | 账号 Key **优先**，没有才回落到站点公共 Key（`server/.env` 的 `DEEPSEEK_API_KEY`），所以未登录访客仍可用 AI |
| 请求级传递 | `server/src/services/aiContext.ts` 用 `AsyncLocalStorage` 把「本次请求该用哪把 Key」传给 `aiService`，不用改 8 个导出函数的签名；`/api/ai/*` 上挂 `optionalAuth`（无 token 不报错）+ 一段中间件绑定 Key |
| 运维 | `cloud-admin.ts set-ai <用户名> [--from-env\|--key sk-...]` 把站点 Key 迁进某个账号；`stats` 会打印每个账号 `ai=本账号已配置 / 无` |
| 失败语义 | Key 错/过期/欠费只影响这次 AI 润色：接口返回 `aiUsed:false` + `aiError`，规则引擎结论照常返回 |

**踩过的坑**（都已修）：
1. `POST /api/ai-config/test` 不带 body 时 `req.body` 是空对象，早期实现把「字段缺失」当成
   「格式非法」回了 400 `BAD_KEY`；现在入参是三态（缺失 / 显式清空 / 非法），缺失时用已保存的 Key。
2. 早期版本给账号 Key 加了 60 秒进程内缓存，`cloud-admin set-ai` 从**另一个进程**写库后
   运行中的后端看不到（实测 set-ai 后立刻测会 400 `NO_KEY`）；现在彻底去掉缓存——
   `requireAuth`／`optionalAuth` 本来就已经读了那一行云端数据，直接用它手上的 `cloudAccount`
   解密即可，既没有缓存窗口也少一次 Supabase 往返。

**验收（2026-10-12）**：`D:\wp\_ai-config-probe.mjs` 在线上后端 `http://127.0.0.1:3001`
dummy 阶段 **12/12**、real 阶段 **4/4**（含匿名 401、掩码不含明文、假 Key 时 `aiUsed:false`、
真 Key 时 `aiUsed:true`、清空后回落到 `aiSource:'server'`）。

## 11. 数据面反代与可观测性加固（2026-10-14）

**现象**：换一台电脑打开公网域名登录——页面正常、登录框正常，点「登录」必现「连不上服务器，请稍后再试」。
本机（跑后端那台）也必现，且故障期内**凭据正确也一样失败**。

**根因**：本机到 `*.supabase.co` 的 TLS 被网络侧按**后缀**重置（`curl (35) Recv failure: Connection was reset`），
于是 `authStore.ts:227` 的 `await readCloud()`（登录时先读云端再找用户）直接抛
`CloudError(502,'CLOUD_ERROR','云端查询失败: TypeError: fetch failed')`，
前端 `messageForError()` 的兜底桶又把它显示成「连不上服务器」——**文案误导，故障其实在数据面**。
定位手法：`curl --connect-to creator.creator-app.xyz:443:<同一个 Cloudflare IP>` → 200 / tls=0.37s
（换 SNI 就通，说明掐 SNI 不掐 IP）；`zzz-made-up-probe-name.supabase.co` 同样被 RST（后缀级）而
`api.supabase.com`、`aws-0-us-east-1.pooler.supabase.com` 的 TLS 正常。

**修复**：数据面改走自己的域名 + Cloudflare Worker 哑管道（原理 / 证据 / 回滚见 `tools\supabase-proxy\README.md`）：
`server\.env` 的 `SUPABASE_URL=https://creator.creator-app.xyz/api/cs-cloud`，
Workers Route `creator.creator-app.xyz/api/cs-cloud/*` → 脚本 `cs-supabase-proxy` → `<ref>.supabase.co`。
后端无需改代码（URL 走配置），前端不感知。

| 复测项 | 结果 |
| --- | --- |
| 本机 / 公网 `POST /api/auth/login`（真实账号 + 错密码） | **401 BAD_CREDENTIALS**（故障期是 502 / 7.8s，现在 1.5s） |
| 公网注册 → 正确密码登录 → `cloud-admin.ts prune-prefix` | 201 / 200 / 清掉 1 个临时账号，用户数据未动 |
| `cloud-admin.ts stats` | 正常（2 个账号，行级 `uploaded_at` = 2026-10-12T14:40:05Z） |
| `tools\smoke-test.ps1` 本机 / 公网 | **33/33** / **66/66** |

**顺带加固**（原本就在待办里的四项）：

| 项 | 位置 | 内容 |
| --- | --- | --- |
| 请求日志 | `server/src/index.ts`（`trust proxy` 之后） | `res.on('finish')` 打 `[req] <ISO> <method> <url> <status> <ms> ip=<req.ip> cf=<cf-connecting-ip>`；此前 `logs/backend.out.log` 恒为 0 字节，线上故障无从查证 |
| 云端读重试 | `server/src/services/cloudStore.ts` `fetchCloud()` | 3 次尝试、间隔 300 / 900 ms，失败打 `[cloud] read failed (n/3)`，最后一次才抛 502 |
| 前端超时 + GET 重试 | `creator-app/src/api/client.ts` | `REQUEST_TIMEOUT_MS=20000`（AbortController）+ GET 失败重试 1 次（5xx，或非超时的网络错误） |
| 诚实文案 | `creator-app/src/services/authService.ts:51-57` | 502 `CLOUD_ERROR`、超时、断网、429、5xx 各自一句，兜底才说「连不上服务器」 |

**已知副作用与运维注意**：
1. 后端到云端多了一跳（实测读一次 `app_sync` 约 0.6–1.7s）；反代不可用时表现是登录 / 同步 502 `CLOUD_ERROR`，本地功能不受影响。
2. 部署机解析器 `192.168.252.11` 对**新创建的子域**返回 NXDOMAIN（上游激进否定缓存 / NSEC，约 30 分钟才失效，
   `ipconfig /flushdns` 无效）——所以后端用的是「已能解析的主机名 + 路径前缀」入口，新增子域请预留这段时间。
3. 改 `server\src` 或 `.env` 后必须重启后端（生产用的 `tsx` 不带 watch）；重启**不要**用 `stop.ps1`（它会连 cloudflared 一起杀）。
