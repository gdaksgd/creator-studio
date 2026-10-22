# PRD · Creator Studio 成片任务 v1.0

> 文档状态：**待确认**  
> 日期：2026-10-20  
> 范围：P0 第一版（本地优先）  
> 参考项目：[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) · [OpenMontage](https://github.com/calesthio/OpenMontage)  
> 约束：**确认前不改代码、不构建到 server/public、不推送 GitHub、不部署网站。确认后也只做本地实现与 5173 预览，再次确认后才同步。**

## 一页摘要

- **新增一个对象**：成片任务（Production Run），从一份脚本快照开始，走到可导出的发布交接包。
- **五个阶段**：脚本锁定 → 发布前检查 → 素材清单 → 人工复核 → 导出交接包。
- **三种检查结果**：阻塞（不能导出发布包）、提醒（复核备注必填）、通过；有依据的检查显示 A/B/C 出处。
- **一个交付物**：ZIP 交接包，包含脚本、分镜、素材清单、发布文案、检查结果、manifest；**不含成片、配音、字幕**。
- **一条边界**：v1 只做本地任务与本地备份，不进云端同步，不自动发布。
- **工期**：约 5 个工作日；先做本地，确认后再同步。

---

## 1. 一句话

把 Creator Studio 从「选题 → 脚本 → 发布 → 复盘」补成一条完整的生产线：**脚本完成后，可以创建一次可检查、可复核、可导出的成片任务，最终拿到一个带 manifest 的发布交接包。**

v1 不生成视频、不做配音和字幕，重点是把「生产治理」做出来。

---

## 2. 背景与问题

### 2.1 现状

Creator Studio 已经具备：

- 选题评估：评分、样本依据、证据等级
- 脚本与分镜：标题、钩子、逐镜时长、画面方向
- 平台适配：B站/抖音规则、出处、A/B/C 证据分级
- 发布回填：真实播放、预测偏差
- 内容实验与分析报告

链路是：

```
选题 → 脚本 →（断）→ 发布 → 复盘
```

脚本完成之后，没有「这次到底能不能发、素材齐不齐、谁复核过、交付了什么」的记录。

### 2.2 参考项目给出的启发

**MoneyPrinterTurbo** 的价值不只是生成视频，而是：

- 固定阶段流水线：脚本 → 关键词 → 配音 → 字幕 → 素材 → 合成 → 可选发布
- 开工前 preflight：检查素材源、API Key、ffmpeg、字幕参数
- 每段可单独停止（只出脚本/只出音频/只出素材）
- 任务状态完整：进度、失败阶段、警告、已产出文件
- 每步产物落盘，形成可追溯记录

**OpenMontage** 的价值是把生产线做成操作系统：

- YAML 定义 pipeline：阶段、工具、输入、产出、审查重点、成功标准
- 标准工件：`brief → script → scene_plan → asset_manifest → edit_decisions → render_report → publish_log`
- checkpoint + 人工审批，阶段可以停在 `awaiting_human`
- 成本治理：预估 → 预留 → 对账
- 工具注册表：本地/API 双方案、fallback、依赖、成本

### 2.3 结论

Creator Studio 不应该变成「另一个视频生成器」，而应该把这两套项目的**流水线、工件、门禁、可追溯性**借过来，补在自己最强的「判断与复盘」之后。

---

## 3. 目标与非目标

### 3.1 v1 目标

1. 从一份已完成的脚本创建**成片任务（Production Run）**，锁定不可变快照。
2. 自动跑发布前检查，区分**阻塞 / 提醒 / 通过**，每条检查尽量带依据。
3. 从分镜自动生成**素材清单**，逐镜确认素材状态；确认版权/授权。
4. 人工复核，记录复核人、备注和通过时间。
5. 导出**发布交接包 ZIP**（脚本、分镜、素材清单、发布文案、检查结果、manifest）。
6. 任务本地持久化，进入本地备份；v1 不进云端同步。
7. 提供一条演示任务和一份「AI 短内容生产线」SOP 文档，作为作品集叙事。

### 3.2 v1 非目标

明确不做：

- 不生成配音、不做 TTS
- 不生成字幕、不烧字幕
- 不合成/渲染视频
- 不接入 Pexels/Pixabay/AI 视频/图片供应商
- 不自动发布到 B站/抖音
- 不做完整素材库升级（素材匹配、授权库、缩略图）
- 不做成本账本、供应商注册表、预算治理
- 不做云端同步（任务只在本机）
- 不做剪映草稿/EDL/FCPXML 导出
- 不改门户页

这些放到 P1–P3，见 §17。

---

## 4. 用户与场景

### 4.1 内容运营 / 创作者运营

> 「脚本写完了，但我怎么证明这次可以发？素材齐了吗？谁看过了？发出去的是什么版本？」

v1 给出：检查清单 + 素材清单 + 复核记录 + 交接包。

### 4.2 游戏营销策划

> 「版本传播方案要交付给剪辑、设计和发布同学，不能只丢一份脚本。」

v1 给出：按平台打包的发布交接包、封面文案、卖点/标题、检查依据。

### 4.3 面试官 / HR

打开 `/runs` 能看到一条完整任务：

```
脚本快照 → 检查结果 → 素材清单 → 复核 → 导出包
```

这比「我又做了一个 AI 功能」更能说明内容运营能力。

### 4.4 主要用户故事

- 作为内容运营，我想从脚本一键创建任务，避免漏掉标题、钩子、时长和素材。
- 作为创作者运营，我想看到每个分镜需要什么素材，哪些还没准备。
- 作为负责人，我想在导出前确认没有阻塞项，并留下复核记录。
- 作为协作者，我想拿到一个 ZIP，里面脚本、分镜、素材、发布文案和检查结果都在。
- 作为面试官，我想看到一次任务从检查到导出的完整证据链。

---

## 5. 核心概念

### 5.1 成片任务（Production Run）

一次针对某个脚本、某个平台的生产任务。任务拥有：

- 不可变脚本快照
- 预检结果
- 素材清单
- 复核记录
- 导出包记录

### 5.2 五个阶段

| key | 阶段 | 说明 | v1 如何完成 |
|---|---|---|---|
| `lock` | 脚本锁定 | 保存脚本/选题/平台检查快照 | 创建任务时自动完成 |
| `preflight` | 发布前检查 | 跑检查清单，得出阻塞/提醒/通过 | 自动 + 手动重新检查 |
| `assets` | 素材清单 | 每个分镜一个素材槽位，确认状态与版权 | 手动逐项确认 |
| `review` | 人工复核 | 留备注、确认版权、标记通过 | 手动 |
| `pack` | 导出交接包 | 生成 ZIP 并记录导出时间 | 手动导出 |

### 5.3 任务状态

| 状态 | 含义 | 进入条件 |
|---|---|---|
| `draft` | 草稿 | 刚创建，检查未完成 |
| `blocked` | 有阻塞项 | 预检存在 `block` |
| `review` | 待复核 | 无阻塞项，等待人工复核 |
| `ready` | 可导出发布包 | 复核通过 + 版权确认 |
| `exported` | 已导出 | 发布包导出成功 |
| `archived` | 已归档 | 手动归档 |

状态流转：

```
draft → blocked → review → ready → exported
              ↑        │
              └────────┘  （重新检查发现阻塞，复核失效）
```

任何以下操作都会让复核失效、状态回到 `blocked` 或 `review`：

- 重新跑预检
- 修改素材槽位状态/类型/备注
- 取消勾选版权确认

任何以下操作会让已导出的包标记为「需重新导出」：

- 重新预检
- 修改素材清单
- 修改复核备注/状态

### 5.4 预检级别

| 级别 | 含义 | 对导出的影响 |
|---|---|---|
| `block` | 阻塞 | 不能导出发布包；可导出草稿包 |
| `warn` | 提醒 | 可导出发布包，但复核备注必填 |
| `pass` | 通过 | 无影响 |
| `info` | 说明 | 无影响 |

### 5.5 发布交接包

v1 的交付物是 **制作交接包 ZIP**，不是成片。

- **发布包**：`ready` 状态下可导出，README 标记 `READY`
- **草稿包**：任何状态都可导出，README 标记 `DRAFT`，列出所有阻塞项

---

## 6. 用户流程

### 6.1 创建任务

入口一：`/scripts/:id` 脚本编辑页，右上角新增「开始成片」按钮。  
入口二：`/runs` 页面，「从脚本创建」。

流程：

1. 打开创建弹窗
2. 展示脚本标题、平台、版本、分镜数、总时长
3. 展示选题信息（如果有）
4. 确认创建
5. 生成不可变快照
6. 自动跑预检
7. 跳转到 `/runs/:id`

规则：

- 一个任务只对应一个平台（B站或抖音）和一个脚本版本
- 同一脚本可创建多个任务；提示「已有 N 个任务」
- 需要另一个平台时，从该平台对应的脚本版本另建任务；v1 不做自动复制/自动改写脚本
- 任务创建后，源脚本再修改不会影响任务
- 任务详情显示「源脚本已更新」提示，并提供「基于最新脚本新建任务」
- v1 不提供「覆盖快照」

### 6.2 发布前检查

任务创建后自动跑一次。详情页可点「重新检查」。

检查顺序：

1. 本地确定性检查（脚本完整性、时长、分镜字段、素材、版权）
2. 调用现有平台规则接口 `/api/ai/evaluate-cover`，`useAI: false`
3. 汇总为 `block / warn / pass / info`

如果平台规则接口不可用：

- 增加一条 `block`：`platform-check-unavailable`「平台规则检查未完成，不能导出发布包；可导出草稿包」
- 草稿包中记录失败原因和重试时间

### 6.3 素材清单

从脚本的每个分镜自动生成一个素材槽位：

- 镜号
- 时长
- 画面描述
- 素材类型：视频 / 图片 / 图形 / 音频 / 其他 / 未指定
- 素材状态：待准备 / 已准备 / 不需要
- 备注

用户逐项确认。全部为「已准备」或「不需要」后，素材阶段完成。

版权确认：

- 独立复选框「我已确认本任务使用的素材版权/授权」
- 未勾选 → `block`，不能导出发布包
- v1 不存具体授权文件，只存确认人和时间

### 6.4 人工复核

满足以下条件后可点「标记复核通过」：

- 无阻塞项
- 版权已确认
- 如果存在提醒项，复核备注必填

记录：

- 复核人（默认当前账号用户名；未登录则「本地复核」）
- 复核备注
- 复核时间

复核通过后状态变为 `ready`。

### 6.5 导出

- 「导出发布包」：仅 `ready` 可用
- 「导出草稿包」：任何状态可用
- 导出成功后记录导出时间、文件名、包内文件数
- 状态变为 `exported`（草稿包不改变状态）
- 如果之后任务内容变化，显示「内容已变更，请重新导出」

---

## 7. 功能需求

| 编号 | 需求 | 优先级 | 验收摘要 |
|---|---|---|---|
| FR-1 | 成片任务列表 `/runs` | P0 | 列表、搜索、状态/平台筛选、KPI、空状态 |
| FR-2 | 从脚本创建任务 | P0 | 快照不可变、平台/版本正确、重复任务提示 |
| FR-3 | 发布前检查 | P0 | 检查清单完整、级别正确、依据可见、可重跑 |
| FR-4 | 素材清单 | P0 | 每个分镜一行、状态可改、进度正确、阻塞导出 |
| FR-5 | 版权确认与人工复核 | P0 | 版权未确认阻塞；警告需备注；复核记录完整 |
| FR-6 | 导出交接包 | P0 | 发布包/草稿包、文件齐全、manifest 可追溯 |
| FR-7 | 本地持久化与备份 | P0 | 刷新不丢；进入本地备份；云端同步不变 |
| FR-8 | 演示任务 | P0 | 首次演示数据含 1 条任务，明确标注演示 |
| FR-9 | SOP 文档与流水线配置 | P0 | 文档与代码共用一份阶段定义 |
| FR-10 | 导航与入口 | P0 | 侧边栏/移动导航/脚本页入口可用 |

---

## 8. 页面与交互

### 8.1 路由与导航

新增：

- `/runs` 成片任务列表
- `/runs/:runId` 任务详情

侧边栏「创作台」新增：

```
成片任务  从脚本到发布交接包
```

图标使用 `Clapperboard`（lucide-react）。

移动端导航同步新增。

### 8.2 `/runs` 列表页

结构：

1. `PageHeader`
   - eyebrow：`创作台 / 成片任务`
   - title：`成片任务`
   - description：`把脚本变成可检查、可复核、可交接的发布包。`
   - actions：`从脚本创建`
2. KPI 行（4 个 `Stat`）
   - 进行中：`draft + blocked + review`
   - 阻塞：`blocked`
   - 可导出：`ready`
   - 已导出：`exported`（近 7 天）
3. 筛选条
   - 搜索标题/脚本名
   - 状态：全部 / 草稿 / 阻塞 / 待复核 / 可导出 / 已导出 / 已归档
   - 平台：全部 / B站 / 抖音
4. 任务卡片列表
   - 标题、平台/版本徽标、状态徽标
   - 源脚本/选题
   - 阶段进度：`3 / 5`
   - 阻塞项数量
   - 更新时间
   - 主按钮：`继续处理` / `查看`
5. 空状态
   - 标题：`还没有成片任务`
   - 说明：`从一份已完成的脚本开始，先跑发布前检查。`
   - CTA：`从脚本创建`

### 8.3 `/runs/:id` 详情页

顶部：

- 返回列表
- 标题 + 平台/版本 + 状态徽标
- 源脚本/选题链接
- 创建时间/更新时间
- 操作：`重新检查`、`导出草稿包`、`导出发布包`、`归档`、`删除`

阶段轨：

```
① 脚本锁定 — ② 发布前检查 — ③ 素材清单 — ④ 人工复核 — ⑤ 导出交接包
```

每个阶段显示状态：待处理 / 进行中 / 完成 / 阻塞。

主体两列（桌面）：

**左列：发布前检查**

- 汇总：`N 个阻塞 · N 个提醒 · N 个通过`
- 分组：阻塞（红）、提醒（黄）、通过（绿）、说明（灰）
- 每条：
  - 标题
  - 结论
  - 依据（如果有）：A/B/C 徽标 + 来源
  - 操作：
    - 脚本类阻塞 → `修改源脚本后新建任务`
    - 平台类 → `查看规则出处`
    - 素材/版权 → 滚动到素材清单
- 底部：`重新检查`

**右列：任务摘要 + 导出**

- 摘要卡：
  - 源脚本、选题
  - 平台、版本
  - 分镜数、总时长
  - 素材就绪数 / 总数
  - 版权确认状态
  - 复核状态
- 导出卡：
  - 发布包包含文件列表
  - `导出发布包`（仅 ready）
  - `导出草稿包`（始终可用）
  - 免责声明：`v1 交接包不含成片、配音和字幕。`

**下方：素材清单**

- 表头：镜号 / 时长 / 画面 / 类型 / 状态 / 备注
- 每行可编辑类型和状态
- 顶部进度：`4 / 5 已准备`
- 底部：版权确认复选框
- 修改后立即保存，并让复核失效

**下方：人工复核**

- 复核人（默认账号名/本地复核）
- 复核备注
- `标记复核通过`（无阻塞 + 版权确认 + 有警告时备注必填）
- 已通过时显示复核时间/人/备注

**下方：任务备注**

- 自由文本，自动保存

### 8.4 创建任务弹窗

字段（只读）：

- 脚本标题
- 平台/版本
- 分镜数
- 总时长
- 关联选题
- 已有任务数量

说明：

- `创建后会锁定当前脚本快照；之后修改源脚本不会影响这个任务。`
- `v1 只生成发布交接包，不生成成片。`

按钮：`取消` / `创建并检查`

### 8.5 状态与颜色

复用现有 `Badge` 语义色：

- 草稿：neutral
- 阻塞：danger
- 待复核：warning
- 可导出：success
- 已导出：info
- 已归档：neutral + 低透明度

状态不能只靠颜色区分，必须有文字。

### 8.6 响应式

- `≥1024px`：两列
- `<1024px`：单列；阶段轨横向可滚动或两行网格
- 素材表在手机上改为卡片列表，避免横向滚动
- 所有页面 390px 宽无横向溢出

---

## 9. 发布前检查清单（v1）

### 9.1 本地检查

| ID | 检查 | 条件 | 级别 | 说明 |
|---|---|---|---|---|
| `script-title` | 脚本标题 | 为空 | block | 没有标题无法发布 |
| `script-hook` | 开场钩子 | 为空 | block | 前 3-5 秒没有钩子 |
| `script-storyboards` | 分镜数量 | 0 个 | block | 没有分镜无法排素材 |
| `script-storyboards-min` | 分镜数量偏少 | 1–2 个 | warn | 提示检查节奏 |
| `script-duration` | 总时长 | ≤0 秒 | block | 分镜时长合计为 0 |
| `storyboard-fields` | 分镜字段 | 任一分镜描述为空或时长 ≤0 | block | 列出具体镜号 |
| `platform-version` | 平台/版本匹配 | B站 + short，或抖音 + long | warn | 提示版本与平台不匹配 |
| `platform-cover` | 封面文案 | 为空 | warn | 平台适配面板没有填封面文案 |
| `topic-evaluation` | 选题评估 | 没有评估 | warn | 没有选题依据 |
| `topic-ai-only` | 选题依据 | `basis.source === 'ai'` | warn | 仅有 AI 推断，没有真实样本 |
| `topic-sample` | 样本量 | `sampleSize < 20` | warn | 样本偏少，结论不稳 |
| `assets-slots` | 素材状态 | 任一槽位为「待准备」 | block | 列出缺失镜号 |
| `rights-confirmed` | 版权确认 | 未勾选 | block | 需人工确认 |
| `platform-check-unavailable` | 平台规则 | 接口失败 | block | 发布包不可导出；草稿包可用 |

### 9.2 平台规则检查

调用现有 `api.evaluateCover`：

```ts
{
  platform: 'bilibili' | 'douyin',
  title: script.title,
  coverText: script.platformCheck?.coverText ?? '',
  durationSec: totalDuration,
  useAI: false
}
```

映射：

| 平台结果 | 检查级别 |
|---|---|
| `summary.fail > 0` | block |
| `summary.warn > 0` | warn |
| `durationAdvice.status === 'fail'` | block |
| `durationAdvice.status === 'warn' / 'info'` | warn |
| 其余 | pass |

检查结果保存：

- `PlatformCheck` 完整对象
- `engine`（如 `pure-rules-v1`）
- `checkedAt`
- 每条规则的 `evidence`

### 9.3 检查展示原则

- 不把「没有数据」写成 0
- 没有平台规则结果时，明确写「未完成」，不伪装成通过
- 每条有依据的检查展示 A/B/C 和来源
- 警告和阻塞都进入导出的 `checks.json` / README

---

## 10. 数据模型

### 10.1 类型

```ts
export type RunStatus =
  | 'draft'
  | 'blocked'
  | 'review'
  | 'ready'
  | 'exported'
  | 'archived';

export type RunStageKey = 'lock' | 'preflight' | 'assets' | 'review' | 'pack';
export type RunStageStatus = 'pending' | 'active' | 'done' | 'blocked';
export type RunCheckLevel = 'block' | 'warn' | 'pass' | 'info';
export type RunCheckSource = 'local' | 'platform' | 'topic';

export interface RunCheck {
  id: string;
  category: 'script' | 'platform' | 'evidence' | 'assets' | 'rights';
  label: string;
  level: RunCheckLevel;
  detail: string;
  hint?: string;
  source: RunCheckSource;
  evidence?: {
    source: string;
    level: 'A' | 'B' | 'C';
    note?: string;
  };
  checkedAt: number;
}

export interface AssetSlot {
  id: string;
  storyboardId: string;
  sceneNumber: number;
  description: string;
  visualDirection: string;
  duration: number;
  kind: 'video' | 'image' | 'graphic' | 'audio' | 'other' | 'unspecified';
  status: 'missing' | 'ready' | 'not_needed';
  note: string;
}

export interface RunStage {
  key: RunStageKey;
  label: string;
  status: RunStageStatus;
  startedAt?: number;
  finishedAt?: number;
}

export interface ProductionRun {
  id: string;
  title: string;
  topicId: string;
  scriptId: string;
  platform: 'bilibili' | 'douyin';
  version: 'long' | 'short';
  status: RunStatus;
  stage: RunStageKey;
  createdAt: number;
  updatedAt: number;
  snapshot: {
    capturedAt: number;
    scriptUpdatedAt: number;
    script: Omit<Script, 'history'>;
    topic?: Pick<Topic, 'id' | 'title' | 'category' | 'status' | 'evaluation'>;
    platformCheck?: PlatformCheck;
    platformCheckError?: string;
  };
  checks: RunCheck[];
  assetSlots: AssetSlot[];
  rightsConfirmed: boolean;
  review: {
    approved: boolean;
    reviewer: string;
    note: string;
    approvedAt?: number;
  };
  pack?: {
    exportedAt: number;
    fileName: string;
    mode: 'publish' | 'draft';
    fileCount: number;
    stale?: boolean;
  };
  demo?: boolean;
  notes: string;
}
```

### 10.2 Dexie

数据库版本从 v6 升到 **v7**，新增：

```ts
runs: 'id, scriptId, platform, status, updatedAt, createdAt'
```

不修改现有表结构。旧数据不需要迁移。

### 10.3 本地优先与同步

- v1 任务只存本机 IndexedDB
- **不进入云端同步**，不改 Supabase schema
- 本地备份格式从 v2 升到 **v3**，增加 `runs` 字段
- 旧 v2 备份仍可导入，`runs` 视为空
- 导出包本身可作为任务的离线副本

### 10.4 快照规则

- 创建任务时深拷贝 `script`、`topic`（精简字段）、`platformCheck`
- 之后源脚本修改不改变任务
- 任务详情对比 `sourceScript.updatedAt` 与 `snapshot.scriptUpdatedAt`，显示「源脚本已更新」
- v1 不提供覆盖快照；提供「基于最新脚本新建任务」

---

## 11. 导出包规范

### 11.1 文件名

```
creator-studio_{YYYYMMDD}_{platform}_{version}_{mode}.zip
```

示例：

```
creator-studio_20261020_bilibili_long_publish.zip
creator-studio_20261020_douyin_short_draft.zip
```

ZIP 内部文件名使用 ASCII，内容 UTF-8。

### 11.2 文件结构

```
README.md
manifest.json
script.md
shotlist.csv
assets.csv
publish.md
checks.json
source-topic.json
```

| 文件 | 内容 |
|---|---|
| `README.md` | 任务摘要、状态 READY/DRAFT、检查汇总、素材汇总、复核记录、免责声明 |
| `manifest.json` | 包格式版本、流水线 ID/版本、完整 run 快照、checks、assets、review、pack 元信息 |
| `script.md` | 标题、钩子、备注、分镜表 |
| `shotlist.csv` | 镜号、时长、画面、台词、画面方向、素材类型、素材状态 |
| `assets.csv` | 镜号、素材类型、状态、备注 |
| `publish.md` | 平台、标题、封面文案、目标时长、平台规则结论与出处、发布前人工清单 |
| `checks.json` | 完整检查对象（含 evidence） |
| `source-topic.json` | 选题快照与评估依据；没有则写 `null` |

### 11.3 README 必含

- 任务标题、平台、版本、状态
- 创建/导出时间
- 源脚本/选题 ID 与更新时间
- 阶段完成情况
- 阻塞/提醒数量
- 素材就绪数 / 总数
- 复核人、复核时间、备注
- 明确声明：
  - `v1 是制作交接包，不包含成片、配音和字幕。`
  - `演示数据仅用于展示流程，不构成项目实绩。`

### 11.4 导出实现

- 浏览器端生成 ZIP，不上传服务器
- 使用 `fflate`（MIT，体积小）
- CSV 写 UTF-8 BOM，保证 Excel 打开中文不乱码
- 导出失败时给出具体原因，不静默失败

---

## 12. 非功能需求

### 12.1 性能

- 创建任务（10 个分镜）< 100ms
- 本地预检 < 50ms
- 平台规则检查等待 API，超时 10s
- 导出 10 个分镜的包 < 300ms
- 列表页初始渲染 < 200ms

### 12.2 隐私

- 除现有平台规则接口外，不向任何地方发送脚本内容
- 平台规则接口只发送标题、封面文案、时长，不发送完整分镜/台词
- 任务与导出包默认只在本机
- 页面上明确说明「平台检查会调用本地后端」

### 12.3 兼容与回归

- 现有 8 个页面不受影响
- `panel-e2e.mjs` 25/25
- `smoke-test.ps1` 本地 33/33
- 门户页不改
- 1440px / 390px 无横向溢出
- 亮/暗主题都可用
- TypeScript 0 错误，oxlint 0 error

### 12.4 可访问性

- 所有状态有文字，不只靠颜色
- 表单有 label
- 键盘可操作
- 焦点可见
- 表格/卡片在手机上可读

### 12.5 依赖

- 新增 `fflate`（ZIP）
- 不新增 UI 框架、不新增服务器依赖
- 复用现有 `api.evaluateCover`
- 不改 Supabase

---

## 13. 验收标准

### AC-1 创建任务

- 从脚本页点「开始成片」，弹窗显示正确标题/平台/版本/分镜数/总时长。
- 创建后 `/runs/:id` 可打开，快照字段与源脚本一致。
- 修改源脚本后刷新任务，任务快照不变，并显示「源脚本已更新」。

### AC-2 预检

- 标题为空 → `script-title` 为 block。
- 分镜为 0 → `script-storyboards` 为 block。
- 时长不在平台区间 → 平台检查产生 block/warn。
- 平台接口不可用 → `platform-check-unavailable` 为 block，状态为 blocked。
- 预检结果包含证据等级/来源；没有依据的检查不伪造来源。

### AC-3 素材清单

- 每个分镜生成一行，镜号/时长/描述正确。
- 修改状态后刷新仍保留。
- 有「待准备」槽位时不能进入 ready。
- 全部「已准备/不需要」+ 版权确认后，素材阶段完成。

### AC-4 复核

- 有阻塞项时「标记复核通过」禁用。
- 有警告项且备注为空时禁用。
- 复核通过后状态 ready，记录复核人/时间/备注。
- 重新检查后复核失效。

### AC-5 导出

- blocked 状态不能导出发布包，可以导出草稿包。
- ready 状态可以导出发布包。
- ZIP 可正常解压，包含 §11.2 的全部文件。
- `manifest.json` 与任务数据一致。
- `README.md` 状态为 READY 或 DRAFT，阻塞项完整列出。
- CSV 中文在 Excel 中正常显示。

### AC-6 本地持久化与备份

- 刷新浏览器任务仍在。
- 本地备份导出包含 runs；导入后任务恢复。
- 旧 v2 备份仍可导入，不报错。
- 云端同步不包含 runs，现有账号同步流程不受影响。

### AC-7 演示任务

- 首次演示数据包含 1 条任务，标记「演示任务 · 非实绩」。
- 任务有 5 个素材槽位，可完成并导出。
- 不伪造平台规则结果；平台检查未跑时显示「未完成」。

### AC-8 页面与回归

- `/runs` 和 `/runs/:id` 在 1440/390 可用。
- 无横向溢出、无 JS 报错。
- 现有 8 个页面、门户页、账号同步、报告导出不受影响。

---

## 14. 测试计划

### 14.1 预检纯函数

新增 `runPreflight` 纯函数，输入：

- 脚本快照
- 选题快照
- 平台检查结果或错误
- 素材槽位
- 版权状态

测试 fixtures：

1. 完整脚本 + 平台通过 + 素材齐 + 版权确认 → 0 block
2. 标题为空 → block
3. 分镜为 0 → block
4. 时长超平台区间 → block/warn
5. 平台接口错误 → block
6. 素材缺失 → block
7. 版权未确认 → block
8. 无选题评估 → warn
9. AI-only 选题依据 → warn
10. 所有通过 + 复核 → ready

### 14.2 浏览器 E2E

新增 `tools/runs-e2e.mjs`（Edge CDP）：

1. 打开 `/runs`
2. 从演示脚本创建任务
3. 断言 blocked 原因
4. 标记素材 ready、勾选版权
5. 重新检查
6. 填写复核备注并标记通过
7. 导出发布包
8. 用 fflate 解析 ZIP，断言文件/README/manifest
9. 刷新后任务仍在
10. 导出草稿包，断言 DRAFT

### 14.3 回归

- `panel-e2e.mjs` 25/25
- `smoke-test.ps1` 本地 33/33
- `_page-audit.mjs` 8 路由
- `tsc -b --force`
- `oxlint src`
- `vite build`
- 1440/390 页面审计

---

## 15. 里程碑与工作量

| 里程碑 | 内容 | 预计 |
|---|---|---|
| M1 | 类型、Dexie v7、流水线配置、路由/导航 | 0.5 天 |
| M2 | 创建任务、列表页、详情页骨架 | 1 天 |
| M3 | 预检、素材清单、版权/复核、状态流转 | 1.5 天 |
| M4 | ZIP 导出、本地备份、演示任务、SOP 文档 | 1 天 |
| M5 | E2E、回归、响应式、亮/暗验收 | 1 天 |
| **合计** | 含 buffer | **5 天** |

如果时间紧，M1–M3 是最小可演示版本；M4 的导出包是作品集关键，不建议砍。

---

## 16. 风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| 范围蔓延到视频生成 | 工期失控、项目定位模糊 | v1 明确非目标，渲染放 P3 |
| 平台规则接口不可用 | 无法完成发布检查 | 阻塞发布包，草稿包可用；README 说明 |
| 快照与源脚本不一致 | 用户困惑 | 显示「源脚本已更新」，提供新建任务 |
| 备份格式升级 | 老用户数据风险 | v2 备份继续可导入；runs 为空 |
| ZIP 中文乱码 | 交付物不可用 | 内部文件名 ASCII；CSV 加 BOM |
| 演示任务被误认为实绩 | 诚信问题 | 明确「演示任务 · 非实绩」 |
| 任务只在本机 | 换设备丢失 | 本地备份 + 导出包；云端同步放 P2 |
| 用户以为 v1 能出片 | 预期落差 | UI/包内明确「不含成片、配音、字幕」 |

依赖：

- 现有 `api.evaluateCover`
- 现有 `Script` / `Topic` / `PlatformCheck` 类型
- `fflate`
- Dexie v7
- 现有 UI 组件与设计令牌

---

## 17. 与参考项目的关系

| 能力 | MoneyPrinterTurbo | OpenMontage | Creator Studio v1 |
|---|---|---|---|
| 流水线阶段 | 脚本→关键词→配音→字幕→素材→合成→发布 | YAML 多 pipeline + 8 阶段 | 锁定→预检→素材→复核→导出 |
| 开工前检查 | preflight 检查 Key/ffmpeg/素材源 | stage gates + success criteria | 发布前检查清单 + 证据 |
| 中间产物 | script.json / audio / srt / materials | 11 类 canonical artifacts | run snapshot / checks / assets / pack |
| 任务状态 | progress / failed_stage / warnings | checkpoint / awaiting_human | status / stage / checks / review |
| 人工审批 | 无（自动跑） | checkpoint policy + human approval | 复核通过 + 版权确认 |
| 成本治理 | 无 | estimate/reserve/reconcile | v1 不做，P2 |
| 工具/供应商 | 多 LLM/TTS/素材供应商 | tool registry + local/API fallback | v1 不接供应商，P1/P2 |
| 批量/多平台 | video_count / aspect / 素材匹配 | media profiles / 多 pipeline | v1 一任务一平台，P1 双版本 |
| 最终产物 | 成片 MP4 | 成片 + publish log | 发布交接包 ZIP（不含成片） |

**刻意不抄：**

- 不把 Python/MoviePy/Whisper/ffmpeg 搬进主应用
- 不做 13 条 pipeline
- 不做自动发布
- 不做“AI 一键成片”的营销承诺
- 不让 AI 替人做最终发布判断

---

## 18. 后续版本

### P1 · 素材库 + 双平台版本 + 配音字幕

- 素材槽位接素材库，自动匹配/缺失提示/授权信息
- 同一脚本生成 B站长版 + 抖音短版
- 配音稿 + Edge TTS 可选
- SRT 字幕 + 平台样式预设
- 导出包增加音频/字幕

### P2 · 成本账本 + 供应商 + 审批历史

- LLM/TTS/素材/渲染成本
- 预算上限与超额警告
- 供应商注册表（本地/API、fallback）
- 阶段审批历史、重跑、对比
- 任务云端同步（只同步元数据，不同步大文件）

### P3 · 剪辑交接

- 剪映草稿 / EDL / FCPXML 导出
- 可选本地 FFmpeg worker
- 只做简单拼接/字幕烧录，不把主应用变成视频编辑器

---

## 19. 需要确认的默认决策

以下是我建议的默认值，如无异议按此执行：

1. **一任务一平台**：B站和抖音分别创建任务；需要另一平台时从对应的脚本版本另建任务，v1 不做自动复制或自动改写脚本。
2. **任务本地优先**：v1 不进云端同步；进入本地备份；导出包作为离线副本。
3. **平台检查离线时**：不能导出发布包，可以导出草稿包；不伪造通过。
4. **v1 交接包不含媒体**：不含成片、配音、字幕；UI 和 README 都写明。
5. **导航名称**：`成片任务`，路由 `/runs`。
6. **演示任务**：首次演示数据带 1 条，明确标注「演示任务 · 非实绩」。

---

## 20. 交付物清单

### 代码

- `creator-app/src/types/index.ts`：新增 Run 相关类型
- `creator-app/src/db/index.ts`：Dexie v7，`runs` 表
- `creator-app/src/config/productionPipeline.ts`：阶段/检查定义（单一事实源）
- `creator-app/src/services/runService.ts`：创建、快照、状态流转
- `creator-app/src/services/runPreflight.ts`：预检纯函数
- `creator-app/src/services/runPack.ts`：ZIP 导出
- `creator-app/src/pages/ProductionRuns.tsx`
- `creator-app/src/pages/ProductionRunDetail.tsx`
- `creator-app/src/components/runs/*`：状态徽标、阶段轨、检查列表、素材清单、导出卡
- `creator-app/src/App.tsx` / `Layout.tsx`：路由/导航
- `creator-app/src/pages/ScriptEditor.tsx`：开始成片入口
- `creator-app/src/services/demoData.ts`：演示任务
- `creator-app/src/services/localBackup.ts`：备份 v3
- `creator-app/package.json`：`fflate`

### 文档

- `docs/PRD-成片任务-v1.md`（本文件）
- `docs/AI短内容生产线-v1.md`（SOP：五阶段、角色、输入/产出、门禁、失败处理、示例）
- `pipeline` 配置说明（与 `productionPipeline.ts` 对应）

### 验收

- `tools/runs-e2e.mjs`
- 预检 fixtures
- 现有回归全绿
- 1440/390 截图
- 一个可下载的示例发布包

### 边界

- 不推送 GitHub
- 不部署网站
- 不改 `server/public`
- 不提交到线上分支

---

## 21. 确认方式

你只需要回复其中一种：

- **「按 PRD 开工」**：我按 §19 默认决策做 v1
- **「按 PRD 开工，但改 X」**：先改对应决策再开工
- **「先只做某几项」**：例如只做任务详情 + 预检 + 导出包

确认后我会先做本地版本，继续在 **http://127.0.0.1:5173** 预览；不会推送或部署。
