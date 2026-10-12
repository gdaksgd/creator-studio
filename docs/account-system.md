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
    "<userId>": { "topics": [...], "scripts": [...], "uploadedAt": 1791815240671 }
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
