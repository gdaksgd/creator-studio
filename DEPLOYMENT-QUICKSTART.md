# Creator Studio 部署速查

本压缩包包含源码、依赖锁文件和当前前后端构建产物。它不是可直接解压到任意静态网页空间就能完整运行的单页文件：应用的资讯、AI、报告、发布数据和账号能力需要 Node.js 后端；云同步还需要 Supabase。

## 本机 Windows 部署

1. 安装 Node.js 22 LTS。
2. 在 `creator-app` 与 `server` 目录分别执行 `npm ci`。
3. 复制 `server/.env.example` 为 `server/.env`，仅填写你自己的 API Key、Supabase URL/anon key 和 `AUTH_SECRET`；不要把 `.env` 上传或发给他人。
4. 如启用云同步，先在自己的 Supabase 项目检查并配置 `supabase-schema.sql`。该 SQL 的 RLS policy 使用 anon 角色读写，正式公开部署前务必先审查数据库权限与应用鉴权，不要未经安全评估直接公开云同步。
5. 构建前端：进入 `creator-app` 执行 `npm ci`（已安装可跳过），再执行 `npm run build`。
6. 将 `creator-app/dist` 内容复制到 `server/public`（使 `server/public/index.html` 存在）。
7. 构建并启动后端：进入 `server` 执行 `npm run build`，再执行 `npm start`。默认端口为 3001；线上部署需要配置 HTTPS、SPA 回退、环境变量与持久化存储。

`build.ps1` 依赖仓库内 `tools/node/node.exe`；本压缩包不含该二进制。若没有准备该内置 Node，请按上面的 `npm ci` / `npm run build` 步骤构建，不要直接运行依赖内置运行时的旧启动脚本。

## 上传到静态网站空间

可以托管 `creator-app/dist` 做前端预览，但单独静态托管不包含 API 服务，资讯采集、AI、报告 API、账号同步等功能无法工作。需要同时部署 `server` 到支持 Node.js 的主机，并把前端 API 代理到该后端；直接放到普通静态空间不是完整部署。

## 压缩包内容边界

没有打包 `.env`、本地 `server/data`、日志、个人运行数据、`node_modules`、Git 历史、内置 Node/cloudflared 二进制。部署后生成自己的数据与密钥，并自行备份。
