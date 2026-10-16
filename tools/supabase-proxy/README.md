# supabase-proxy — 绕开 *.supabase.co 的 SNI-RST 封锁

## 为什么需要它

2026-10-14 排查"别的电脑登录提示连不上服务器"，根因不在应用：

| 目标 | 结果 |
| --- | --- |
| `https://creator.creator-app.xyz/api/auth/status` | 200 / TLS 0.38s |
| `https://swuwkemyffuraloijrse.supabase.co/**` | TCP 连上后 **TLS ClientHello 被 RST**（10/10 失败） |
| 随便编的 `https://zzz-made-up.supabase.co/` | 同样被 RST → 封锁针对 `*.supabase.co` 整个后缀 |
| `https://api.supabase.com/`、`https://aws-0-us-east-1.pooler.supabase.com/` | TLS 正常 → 不是 IP 级封锁 |
| 强制把 `creator.creator-app.xyz` 连到 Supabase 的 IP `172.64.149.246` | 200 → IP 通，只有那个 SNI 被掐 |

链路影响：`server/src/services/authStore.ts:227` 的 `loginUser()` 在读用户**之前**先 `await readCloud()`；
`cloudStore.ts` 的 `fetchCloud()` 抛 `CloudError(502,'CLOUD_ERROR','云端查询失败: TypeError: fetch failed')`；
前端 `authService.ts:56` 把除 USERNAME_TAKEN/BAD_CREDENTIALS/NOT_CONFIGURED 之外的一切错误都兜底成
「连不上服务器，请稍后再试」。所以账号密码正确也一样报这句话，`*.pages.dev`、`*.workers.dev` 同样被封。

## 方案

用自己的域名（`creator-app.xyz` 未被封锁）做一层反代。同一个 Worker 有两个入口：

```
入口 A（后端实际在用，无需等任何新子域生效）
  本机 Express  --HTTPS-->  creator.creator-app.xyz/api/cs-cloud/*  --Workers Route-->  Worker
入口 B（备用，自定义域名）
  本机 Express  --HTTPS-->  supabase.creator-app.xyz/*  --custom domain-->  Worker
                                                                    |
                                                                    v
                                                       <ref>.supabase.co
```

Worker 是哑管道，不保存密钥，`apikey`/`Authorization`/`Prefer` 原样透传；没有 `apikey` 的流量直接 401。
`worker.js` 里的 `PREFIXES = ['/api/cs-cloud']` 负责在入口 A 下把前缀剥掉。

**为什么后端用入口 A 而不是入口 B**：部署机（D:\自媒体之路 所在的那台 Windows）的解析器
`192.168.252.11` 对新创建的子域返回 NXDOMAIN（`supabase.creator-app.xyz`、`supabase-edge.creator-app.xyz`
都解析不了，`ipconfig /flushdns` 无效，8.8.8.8/223.5.5.5 与权威 NS 都能解析）——
上游解析器在区域 SOA minimum（1800s）内持有了激进否定缓存（RFC 8198 / Cloudflare 黑谎 NSEC）。
而 `creator.creator-app.xyz` 本来就能解析，把代理挂在它的一个路径前缀下就完全绕开了这个问题。
入口 B 保留着，等 DNS 生效后任何客户端都能用。

## 部署

1. 在 Cloudflare 面板建 API Token（My Profile → API Tokens → Create Custom Token）：
   - `Account` → `Workers Scripts` → **Edit**
   - `Zone` → `Workers Routes` → **Edit**
   - `Zone` → `DNS` → **Edit**
   - Account Resources: Include → 你的账号；Zone Resources: Include → Specific zone → `creator-app.xyz`
   （或者直接用 "Edit Cloudflare Workers" 模板，再补一条 `Zone → DNS → Edit`）
   Token 部署完就删掉/轮换：它只在这一步用一次，留在聊天记录或脚本里都是长期风险。
2. 部署并验证（脚本幂等，可重复跑；纯 ASCII，PS 5.1 可直接跑）：

   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\自媒体之路\tools\supabase-proxy\deploy.ps1 -ApiToken <TOKEN>
   ```

   脚本会：校验 Token → 解析 zone_id → 上传 Worker → 绑定 `supabase.creator-app.xyz`（custom domain 失败则回退 DNS+Route）
   → 建 `creator.creator-app.xyz/api/cs-cloud/*` 这条 Workers Route（已存在就跳过）→ 用真实 anon key 打 `app_sync` 做端到端验证。
   DNS 还没生效时可以加 `-SkipEndToEnd` 只做部署。
3. 切换数据面地址（`D:\自媒体之路\server\.env`）：

   ```
   SUPABASE_URL=https://creator.creator-app.xyz/api/cs-cloud
   ```
4. 重启后端（改的是 server\src 与 .env，`tsx` 不带 watch，必须重启；**不要**用 stop.ps1，它会把 cloudflared 一起杀掉）：

   ```powershell
   taskkill /PID <3001 监听进程的父 tsx 进程> /T /F
   powershell -ExecutionPolicy Bypass -File D:\自媒体之路\autostart.ps1
   ```
5. 复测：`/api/auth/status` → 200；真实账号 + 错密码 → **401 BAD_CREDENTIALS**（不再是 502）；
   `tsx scripts/cloud-admin.ts stats` 能读出账号；公网 `https://creator.creator-app.xyz/api/auth/login` 同样 401。

## 现状（2026-10-14 22:11 上线，已验证）

| 检查 | 结果 |
| --- | --- |
| Worker 脚本 `cs-supabase-proxy` | 上传成功，线上内容确认含 `stripPrefix` |
| custom domain | `supabase.creator-app.xyz` → cs-supabase-proxy（production） |
| Workers Route | `creator.creator-app.xyz/api/cs-cloud/*` → cs-supabase-proxy（id `698eb424c7f64cc9a52d90904697f21f`） |
| 经入口 A 读云端 | 200 `[{"id":1,"uploaded_at":1791816005085}]` |
| 经入口 B 读云端 | 200，同一份数据 |
| 公网注册（写云端） | 201 + token |
| 公网用正确密码登录 | 200 + token |
| 公网用错密码登录 | 401 BAD_CREDENTIALS（原先 502 CLOUD_ERROR） |
| 冒烟测试 | 本机 33/33、公网 66/66 |
| 直连 `*.supabase.co` 对照 | 仍然 `curl (35) Recv failure: Connection was reset` → 封锁未解除，反代是必需项 |

## 排查用的关键证据（留档）

- `curl --connect-to creator.creator-app.xyz:443:172.64.149.246:443 https://creator.creator-app.xyz/api/auth/status`
  → 200 / tls=0.370s：同一个 Cloudflare IP，换个 SNI 就通，说明掐的是 SNI 而不是 IP。
- `curl -v https://swuwkemyffuraloijrse.supabase.co/auth/v1/health`
  → `Trying 172.64.149.246:443...` → `Recv failure: Connection was reset` → `schannel: failed to receive handshake`。
- `zzz-made-up-probe-name.supabase.co` 同样被 RST；`api.supabase.com`、`aws-0-us-east-1.pooler.supabase.com` TLS 正常。
- 云端写入/读取全部走 REST（`app_sync` 单行），所以这一层反代足以覆盖登录、注册、sync、analytics、账号级 AI Key。

## 回滚

把 `SUPABASE_URL` 改回 `https://swuwkemyffuraloijrse.supabase.co` 并重启即可（前提是封锁已解除）；
Worker 侧可 `DELETE /accounts/<acct>/workers/scripts/cs-supabase-proxy`，Route 可
`DELETE /zones/<zone>/workers/routes/<id>`，域名留在 DNS 里也无害。

## 已知取舍

- 免费版 Worker：10 万请求/天、CPU 10ms/请求，本用量远低于上限。
- 该域名对公网可达，但拿不到 anon key 就只能 401，等价于 Supabase 自己的公开 REST 面。
- `api.cloudflare.com` / `dash.cloudflare.com` 在本机可达（TLS 正常，403 是未带凭据的预期结果），
  所以部署不受本次封锁影响。
- 反代把「后端到云端」这一跳改成了「后端 → Cloudflare 边缘 → Supabase」，多了一跳延迟
  （实测读一次 app_sync 约 0.6～1.7s）。`cloudStore.ts` 的 1.5s 单飞缓存 + 3 次短重试仍然有效。
- 若哪天封锁解除，把 URL 换回去即可少一跳；但**不要**在没验证直连可用前改回去。
