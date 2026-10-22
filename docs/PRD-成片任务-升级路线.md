# PRD · Creator Studio 成片任务升级路线

> 文档状态：**R1–R6 已本地实现（2026-10-21），待用户验收；R7 归类为后续升级方向（未实现）**  
> 日期：2026-10-21  
> 基线：成片任务 v1（已本地实现，未同步）  
> 参考：[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) · [OpenMontage](https://github.com/calesthio/OpenMontage)  
> 相关：[PRD-成片任务-v1.md](PRD-成片任务-v1.md) · [AI短内容生产线-v1.md](AI短内容生产线-v1.md)  
> 约束：本文只定义后续升级，**不代表已开工**；确认前不改代码、不推送、不部署。

---

## 一页摘要

v1 已经有「脚本快照 → 预检 → 素材 → 复核 → 交接包」这条主线。后续不再堆“一键生成”，而是补三条能力：

1. **可追溯**：阶段工件单独下载、运行事件时间线。
2. **闭环**：成片任务接回真实发布数据，做预测校准。
3. **生产扩展**：多流水线、平台双版本、素材/版权、配音字幕、成本与批量、成片交接。

推荐顺序：

```
R1 可追溯快赢（2–3 天）
  → R2 发布闭环（3–4 天）
  → R3 多流水线与平台变体（7–10 天）
  → R4 素材库与版权（5–7 天）
  → R5 配音与字幕（8–12 天）
  → R6 成本、供应商与批量（6–8 天）
  → R7 成片交接与质检（8–12 天）
```

R1 + R2 是建议先做的 5–7 天，能明显提升“可追溯 + 闭环”的作品集叙事；R3 之后按时间和目标选择。

> **实施状态（2026-10-21）**：R1–R5 已在本机实现，未推送、未部署、未改 `server/public`。  
> R1/R2：阶段工件、事件时间线、发布校准与绑定、发布深链。  
> R3：3 条流水线注册表、按流水线驱动的阶段/检查/导出、campaign 同组任务与组合包。  
> R4：素材来源/授权/到期/允许平台、槽位关联素材库、授权阻塞检查、assets.csv 授权列。  
> R5：流水线 v2（配音/字幕）、本地 Edge TTS worker、句级时间戳字幕、媒体包 v2。  
> R6：供应商注册表、成本账本、批量创建/并发/重试、备份 v4。  
> 验收脚本：`runs-e2e` 79 项、`runs-r5-e2e` 13 项、`runs-r6-e2e` 10 项、`run-preflight-test` 43 项。R7 为后续升级方向。

---

## 1. 当前基线（v1 已完成）

- `/runs` 列表 + `/runs/:id` 详情
- 五阶段：脚本锁定 → 发布前检查 → 素材清单 → 人工复核 → 导出交接包
- 预检：阻塞 / 提醒 / 通过，带 A/B/C 证据与出处
- 素材逐镜确认、版权确认、复核门禁
- 草稿包 / 发布包 ZIP，包含 `README / manifest / script / shotlist.csv / assets.csv / publish.md / checks.json / source-topic.json`
- Dexie v7 `runs` 表、本地备份 v3（runs 已纳入）
- 演示任务、示例包、SOP

已知边界：

- 一个任务只对应一个平台/脚本版本
- 素材是手动槽位，不接素材库/授权库
- 没有配音、字幕、渲染、自动发布
- 没有阶段工件单独导出、运行事件历史
- 没有和发布结果绑定
- 只有一条隐式流水线

---

## 2. 总原则

1. **保持确定性**：不做 agent-first 自由编排；流水线是可预测、可复核的。
2. **工件优先**：每一步都有可下载、可归档的产物，而不是只留在页面状态里。
3. **门禁优先于自动化**：宁可阻塞，不把不确定的东西标成“可发布”。
4. **本地优先**：run、素材、音频、视频默认只在本机；云端只同步必要元数据。
5. **不做自动发布**：发布必须人工操作，账号与平台风险不交给脚本。
6. **不把主应用变成视频编辑器**：重媒体处理放独立 worker 或剪映/EDL 交接。
7. **每个版本都能单独验收**：做完一个 release 就能用，不依赖后面的版本。

---

## 3. 版本总览

| 版本 | 主题 | 核心交付 | 预计 | 依赖 | 退出标准 |
|---|---|---|---|---|---|
| R1 · v1.1 | 可追溯快赢 | 阶段工件下载、运行事件时间线 | 2–3 天 | v1 | 每个动作有事件；每个阶段可单独下载工件 |
| R2 · v1.2 | 发布闭环 | 任务绑定发布、预测 vs 实际校准 | 3–4 天 | R1 | run 详情能看到真实播放与偏差 |
| R3 · v1.3 | 多流水线与平台变体 | 流水线注册表、3 条模板、B站/抖音成组任务 | 7–10 天 | R1 | 能创建一条 campaign 下的两个平台任务并导出组合包 |
| R4 · v1.4 | 素材库与版权 | 素材槽位接库、授权/到期/平台限制 | 5–7 天 | v1/R3 | 缺失/过期/不允许的平台素材会阻塞发布包 |
| R5 · v2.0 | 配音与字幕 | 配音、SRT、平台字幕预设、provider 抽象 | 8–12 天 | R3/R4 | 5 镜脚本可在本地产出音频 + 字幕 |
| R6 · v2.1 | 成本、供应商与批量 | 成本账本、provider registry、批量任务 | 6–8 天 | R5 | 5 条任务批量跑完，成本与失败可查 |
| R7 · v3.0 | 成片交接与质检 | 剪映草稿/EDL、可选 FFmpeg、成片 QA | 8–12 天 | R5/R6 | 一个真实短片可在剪映打开并通过质检 |

总工期约 39–56 个工作日（单人，含测试，不含内容制作）。

---

## 4. R1 · v1.1 可追溯快赢（P0.5）· ✅ 已本地实现

### 4.1 目标

让 v1 的“可追溯”从一句口号变成可下载、可翻看的记录。

### 4.2 范围

#### A. 阶段工件单独导出

借鉴 MoneyPrinterTurbo 的 `stop_at` 和 OpenMontage 的 canonical artifacts。

- 在 run 详情增加「阶段工件」区：
  - `script.md`
  - `shotlist.csv`
  - `assets.csv`
  - `checks.json`
  - `publish.md`
- 每个文件单独下载；不要求先导出完整 ZIP。
- 工件由当前 run 快照派生，不额外持久化。
- 「下载全部」仍走现有 ZIP；阶段工件只是更轻的出口。

验收：

- 5 个文件都能单独下载；
- 内容与 run 快照一致；
- 不需要网络请求；
- 不包含成片/音频/字幕。

#### B. 运行事件时间线

借鉴 OpenMontage 的 checkpoint 状态，但用更轻的实现。

- `ProductionRun.events: RunEvent[]`，追加式，最多保留 200 条。
- 事件类型：
  - `created`
  - `checked`
  - `asset_updated`
  - `rights_confirmed`
  - `rights_revoked`
  - `review_approved`
  - `review_revoked`
  - `pack_exported`
  - `archived`
  - `note_updated`（可选）
- 每条事件记录：`id`、`type`、`at`、`actor`、`summary`、`meta?`。
- run 详情底部显示时间线，按时间倒序；折叠旧事件。
- 预检、素材、版权、复核、导出都追加事件。

验收：

- 创建任务后至少有 `created`；
- 重新检查、改素材、确认版权、复核、导出都会新增事件；
- 刷新后事件保留；
- 备份 v3 的 runs 中事件随任务恢复；
- 事件不包含完整脚本/隐私内容，只记录摘要。

### 4.3 数据与迁移

- `ProductionRun` 增加 `events?: RunEvent[]`；旧 run 读取时默认 `[]`。
- 不升 Dexie 版本（runs 表结构不变）。
- 备份格式仍为 v3；旧 v1/v2/v3 备份兼容。

### 4.4 工作量

2–3 天（含类型、服务、UI、事件测试）。

---

## 5. R2 · v1.2 发布闭环（P1）· ✅ 已本地实现

### 5.1 目标

把成片任务和真实发布结果接起来。两个参考项目都停在“产出”，这是 Creator Studio 的差异化。

### 5.2 范围

- run 详情新增「发布回填与校准」卡：
  - 如果源选题已有 `published`，显示真实播放、点赞、投币、评论、发布时间、BVID；
  - 显示选题预测/人工目标 vs 实际，以及偏差；
  - 如果没有发布记录，提供跳转到选题看板「记录发布」的入口；
  - 支持「绑定本次任务」：把 run 与 `bvid/platform` 绑定，存 `run.publishRef`。
- 新增 `RunPublishRef`：
  ```ts
  interface RunPublishRef {
    topicId: string;
    platform: 'bilibili' | 'douyin';
    bvid?: string;
    boundAt: number;
  }
  ```
- 多条 run 对应同一选题时，按 platform + bvid 匹配；匹配不到时提示「未绑定」，不猜。
- 不修改云端 `PublishedRecord` 结构；运行数据仍只在本机。
- 可选：在选题看板的发布回填弹窗里显示「关联成片任务」下拉，默认最近一条同平台 run。

验收：

- 有发布记录的 run 能看到真实值与偏差；
- 绑定后刷新仍保留；
- 没有发布记录时不显示假数字；
- run 的平台与发布记录平台不一致时给出提示；
- 发布回填后，任务详情能回到源选题/脚本。

### 5.3 数据与迁移

- `ProductionRun` 增加 `publishRef?`。
- 不改 Dexie 表结构。
- 事件时间线追加 `publish_bound`（如果 R1 已做）。

### 5.4 工作量

3–4 天。

---

## 6. R3 · v1.3 多流水线与平台变体（P1）· ✅ 已本地实现

### 6.1 目标

从“一条固定流水线”升级为“可选择的几条生产线”，并支持同一内容在 B站/抖音的成组生产。

### 6.2 流水线注册表

借鉴 OpenMontage 的 pipeline manifest，但用 TypeScript 类型定义，保持可校验、可打包。

```ts
interface PipelineDefinition {
  id: string;
  version: string;
  name: string;
  description: string;
  stageKeys: RunStageKey[];
  checkGroups: CheckGroupDefinition[];
  packSections: PackSectionDefinition[];
  defaultPlatform?: Platform;
}
```

首批 3 条：

| Pipeline | 用途 | 阶段差异 | 额外检查 |
|---|---|---|---|
| `game-longform@1` | B站长解说 | 现有五阶段 | 3–10 分钟、章节节奏、B站规则 |
| `game-shortform@1` | 抖音短切片 | 现有五阶段 + 开场钩子检查 | 1–3 分钟、竖屏、完播率参考 |
| `version-marketing-pack@1` | 版本营销素材包 | brief → 素材清单 → 发布包（不带完整分镜） | 目标/受众/卖点/节奏/评估指标 |

- 创建任务时选择 pipeline；默认按脚本 platform/version 推断。
- `ProductionRun` 增加 `pipelineId`、`pipelineVersion`；旧 run 迁移为 `game-longform@1`。
- 导出 `manifest.json` 记录 pipeline id/version。
- 详情页的阶段轨、检查分组、导出文件由 pipeline 定义驱动，不再写死。

### 6.3 平台变体成组

- 不做“一条 run 内多 variants”，避免预检/素材/复核互相污染。
- 新增 `Campaign` 概念：一个 campaign 下挂多条 run（B站长版、抖音短版），共享 topic/选题与版本信息。
- 从一条 run 可「创建另一平台任务」：
  - 选择同选题的对应脚本版本；
  - 生成新的 run，带 `campaignId`、`variantOfRunId`；
  - 原 run 不受影响。
- 新增 `/campaigns/:id` 或 run 详情内的「同组任务」：
  - 两条 run 的状态、阻塞、导出并列；
  - 可导出「组合包」：两个 run 的包 + `campaign.json`。
- 不做自动改写脚本；B站长版/抖音短版仍由脚本版本提供。

验收：

- 创建任务时可以选 3 条 pipeline 之一；
- 旧 run 正常打开，manifest 补 `game-longform@1`；
- 从一条 run 能创建同选题的另一平台 run；
- 两条 run 有关联关系，可导出组合包；
- 删除/归档一条 run 不影响另一条。

### 6.4 数据与迁移

- `ProductionRun.pipelineId/pipelineVersion/campaignId?/variantOfRunId?`
- 新 Dexie v8 可选：`campaigns` 表；或 campaign 由 run 字段聚合，不建表。
- 备份 v3 兼容；新增字段可选。

### 6.5 工作量

7–10 天。

### 6.6 本地实现记录（2026-10-21）

- 注册表：`creator-app/src/config/productionPipeline.ts` 内新增 `PIPELINES`，包含 `game-longform@1`、`game-shortform@1`、`version-marketing-pack@1`；阶段、检查分组、导出文件均由定义驱动。
- 数据：`ProductionRun.pipelineId/pipelineVersion/campaignId/variantOfRunId` 均为可选字段，**未升 Dexie 版本**；旧 run 读取时回退 `game-longform@1`，manifest 同步补上。
- 创建：创建弹窗可选 3 条流水线，默认按脚本平台/版本推断；营销包不跑平台规则、无需人工复核、导出不含 `script.md/shotlist.csv`，manifest 省略完整 `storyboards`。
- 同组：run 详情新增「同组任务」卡，可从同选题另一平台脚本创建变体 run（`campaignId` + `variantOfRunId`）；组合包包含每条任务的独立目录与 `campaign.json`，未就绪任务以 DRAFT 包进入。
- 未做：独立的 `/campaigns/:id` 页面（本期用 run 详情内的同组卡）；自动改写脚本；campaign 表。
- 验收：`runs-e2e` 70/70，`run-preflight-test` 27/27；1440/390 亮暗截图见 `docs/screenshots/r3/`。

---

## 7. R4 · v1.4 素材库与版权（P1）· ✅ 已本地实现

### 7.1 目标

把“手动勾选素材状态”升级为“从素材库匹配 + 可核查的授权记录”。

### 7.2 范围

- 扩展 `LibraryAsset`（可选字段，不破坏旧记录）：
  - `sourceType`: local / stock / ai / original
  - `license`: own / licensed / cc / unknown
  - `licenseUrl?`
  - `expiresAt?`
  - `allowedPlatforms?: Platform[]`
  - `checksum?`
  - `usageCount?`
- 素材槽位：
  - `assetId?`：关联素材库记录
  - `matchStatus`: unmatched / suggested / matched / missing
  - `rightsStatus`: ok / unknown / expired / platform_blocked
- run 详情素材清单：
  - 支持从素材库选择/搜索；
  - 显示建议匹配（按类型/标签/关键词，不做“自动认定”）；
  - 显示授权、到期、允许平台；
  - 缺失/未知/过期/平台不允许 → 阻塞发布包。
- 预检新增：
  - `asset-rights-missing`
  - `asset-rights-expired`
  - `asset-platform-blocked`
  - `asset-unmatched`
- 发布包新增 `assets.csv` 列：来源、授权、到期、允许平台、素材 ID。
- 只同步素材元数据；不把大文件放进云同步/备份。

验收：

- 从库里选素材后，槽位显示来源/授权/到期；
- 过期或平台不允许时，发布包不可导出；
- 未匹配素材仍可标记“不需要”，不阻塞；
- 旧素材记录没有新字段时显示“未记录”，不伪造授权；
- 导出包里的素材清单能回到素材库来源。

### 7.3 数据与迁移

- `LibraryAsset` 增加可选字段；Dexie 表结构不变（可选字段）。
- `AssetSlot` 增加 `assetId?`、`matchStatus`、`rightsStatus`；旧 run 默认 `unmatched`/`unknown`。
- 备份 v3 兼容。

### 7.4 工作量

5–7 天。

### 7.5 本地实现记录（2026-10-21）

- 素材库：`LibraryAsset` 增加可选 `sourceType/license/licenseUrl/expiresAt/allowedPlatforms/checksum/usageCount`；新增/编辑弹窗可记录，旧记录显示「未记录」。
- 槽位：`AssetSlot` 增加可选 `assetId/assetSnapshot/matchStatus/rightsStatus`；关联时保存授权快照，导出与预检都以此为准。
- 预检：新增 `asset-rights-missing`、`asset-rights-expired`、`asset-platform-blocked`（block）与 `asset-unmatched`（warn）；未关联素材标记「不需要」不产生 unmatched 提醒。
- 导出：`assets.csv` 增加来源、授权、到期、允许平台、素材ID、素材名称列。
- 授权刷新：`refreshRun`、复核、导出前都会刷新关联素材授权快照；过期/平台不符会阻止发布包。
- 兼容：不升 Dexie 版本；备份 v3 兼容；云端仍只同步素材元数据，不涉及媒体文件。
- 验收：`runs-e2e` 79/79，`run-preflight-test` 34/34；截图见 `docs/screenshots/r4/`。

---

## 8. R5 · v2.0 配音与字幕（P2）· ✅ 已本地实现

### 8.1 目标

让成片任务从“交接包”走到“可直接剪辑的音频 + 字幕”，但不把主应用变成视频生成器。

### 8.2 范围

- 新阶段：`voice`、`subtitles`，插在 `assets` 与 `review` 之间。
- 配音：
  - 配音稿从脚本/分镜台词生成，可编辑；
  - TTS provider 适配：本地 Edge TTS 优先，云端作为可替换 provider；
  - 输出 `voiceover.mp3`、时长、provider、成本（如有）。
- 字幕：
  - TTS 时间戳或本地 Whisper 生成 SRT；
  - 平台预设：B站/抖音字号、位置、行宽、阅读速度；
  - 输出 `subtitles.srt`，可选 VTT。
- 预检新增：
  - 音频时长与视频目标时长偏差；
  - 字幕行宽/阅读速度；
  - 字幕与台词一致性抽查（不自动宣称完全对齐）；
  - provider 不可用时阻塞对应阶段，不伪造文件。
- 发布包 v2：
  - 增加 `voiceover.mp3`、`subtitles.srt`、`voice.json`、`subtitle.json`；
  - README 说明媒体文件是否包含。
- 本地 worker 边界：
  - 主应用只做编排/配置/状态；
  - TTS/Whisper 在独立本地 worker 或命令行运行；
  - 不把 Python/Whisper 打进前端 bundle；
  - 媒体文件默认只在本机，不进云端同步。

验收：

- 5 镜脚本能在本地生成音频和 SRT；
- 音频时长、字幕行数/阅读速度有检查和警告；
- provider 失败时 run 停在 voice/subtitles，状态可解释；
- 导出包 v2 能包含音频/字幕；
- 没有安装 TTS worker 时，v1 功能仍可用。

### 8.3 数据与迁移

- `ProductionRun` 增加 `voice?`、`subtitles?` 工件引用（本地文件路径/大小/时长，不存 blob 到云端）。
- 新 Dexie v9 可选 `runArtifacts` 表；或继续放 run 内。
- 备份默认不含媒体文件，只含路径/元数据；导出包按需包含。
- 包格式升级到 `creator-studio-run-pack/v2`，保留 v1 读取。

### 8.4 工作量

8–12 天。

### 8.5 本地实现记录（2026-10-21）

- 流水线：新增 `game-longform@2` / `game-shortform@2`，7 阶段（素材后插入配音、字幕）；v1 任务仍按 `@1` 读取，不突然要求 TTS。
- Worker：`tools/tts-worker/` 本地 Edge TTS HTTP worker（127.0.0.1:3101），返回 MP3 base64 + 句级时间戳；健康检查失败时配音阶段阻塞，不生成假音频。
- 媒体：Dexie v9 `runMedia` 表存音频 Blob；本地备份和云同步都不包含媒体；删除任务时清理。
- 字幕：按 TTS `SentenceBoundary` 生成 SRT，B站 18 字/行、抖音 12 字/行预设；无时间戳时用估算并在检查中标明。检查行宽、阅读速度、时间戳来源和台词覆盖率。
- 包：v2 包增加 `voiceover.mp3`、`subtitles.srt`、`voice.json`、`subtitle.json`，manifest `formatVersion: "2"`；组合包按 run 目录带入媒体。
- 未做：Whisper 对齐、逐字强制对齐、自动发布；媒体不跨设备同步。
- 验收：`runs-e2e` 79/79，`runs-r5-e2e` 13/13，`run-preflight-test` 43/43；截图见 `docs/screenshots/r5/`。

---

## 9. R6 · v2.1 成本、供应商与批量（P2）· ✅ 已本地实现

### 9.1 目标

当开始使用付费 TTS/图片/视频 provider 时，能看清成本、失败和批量吞吐。

### 9.2 范围

- **Provider registry**：
  - 能力：llm / tts / image / video / stock
  - 运行时：local / api / hybrid
  - 成本、依赖、可用状态、fallback 链
  - 首次使用付费 provider 需确认
- **成本账本**：
  - 每次 run 记录 `RunCostEntry`：provider、操作、估算、实际、tokens/字符/素材数、时间
  - run 详情显示总成本；批量显示汇总
  - 预算上限与超额警告；不默认硬阻断（可配置 cap）
- **批量任务**：
  - 从一个选题/一组脚本创建 N 条 run
  - 队列、并发上限、失败重试、部分结果
  - 批量详情：成功/失败/阻塞，逐条跳转
- 借鉴 OpenMontage 的 estimate → reserve → reconcile；v1 可以先只做 estimate/actual，不做 reserve。

验收：

- 每个付费操作有成本记录；
- 批量 5 条 run 能跑完，失败项可重试；
- 成本汇总与实际 provider 账单口径说明清楚；
- 未配置 provider 时，批量任务停在 preflight 并给出原因。

### 9.3 数据与迁移

- `RunCostEntry[]`（或 `runCosts` 表）
- `RunBatch` 表/对象
- 备份 v4；旧备份兼容
- 云端仍不同步 run/媒体；只同步选题/脚本

### 9.4 工作量

6–8 天。

### 9.5 本地实现记录（2026-10-21）

- 供应商注册表：`src/config/providers.ts`，覆盖 Edge TTS、本地规则、B站公开接口、DeepSeek、人工复核；标注能力、运行时、免费/付费、计价口径与 fallback。DeepSeek 单价为 null（按供应商账单），不猜价格。
- 成本账本：Dexie v10 `runCosts`；配音生成记录 Edge TTS 0 元 + 字符数；任务详情「成本」卡与供应商口径弹窗；批量详情汇总。
- 批量：Dexie v10 `runBatches`；从一组脚本创建 N 条 run，并发 1–3，预检失败自动重试 2 次，失败项可再次重试；批量详情逐条跳转，显示 run 阻塞状态与成本。
- 备份 v4：包含 runs/runCosts/runBatches；旧 v1–v3 备份仍可读取；媒体仍不进备份。
- 未做：真实供应商 token 账单同步、视频/图片供应商接入、付费 provider 的强制确认流程（当前 run 流水线只调用免费本地 provider）。
- 验收：`runs-e2e` 79/79，`runs-r5-e2e` 13/13，`runs-r6-e2e` 10/10，`run-preflight-test` 43/43；截图见 `docs/screenshots/r6/`。

---

## 10. R7 · v3.0 成片交接与质检（P3）· 后续升级方向（未开工）

> 状态：**后续升级方向**。当前交付止于 R6。启动 R7 需要先补齐本地视频/图片素材、FFmpeg worker，以及剪映或 EDL/FCPXML 导入验证；在此之前不伪造成片或质检报告。

### 10.1 目标

把“制作交接包”延伸到最后一步：能在剪映/剪辑软件里打开，或在本地做简单合成，并有成片质检。

### 10.2 范围

- 剪映草稿 / EDL / FCPXML 导出（优先剪映草稿）
- 可选本地 FFmpeg worker：
  - 图片/素材拼接
  - 字幕烧录
  - 音频混合
  - 不追求复杂特效
- 媒体配置（media profiles）：
  - B站 16:9、抖音 9:16、时长/码率/帧率
- 成片质检（借鉴 OpenMontage 的交付检查思路）：
  - 时长/画幅/编码/音量
  - 字幕是否超界/重叠/阅读速度
  - 镜头节奏/静帧风险/重复素材
  - 缺失素材/黑帧/静音段
- `delivery_report.json`：质检结果进入发布包；阻塞项不能标“可发布”。

验收：

- 一个真实 30–60 秒短片能在剪映打开（或 EDL/FCPXML 导入）；
- 质检能发现时长/画幅/字幕/静音问题；
- 失败时保留中间工件，不丢任务；
- 仍不自动发布。

### 10.3 工作量

8–12 天。

---

## 11. 跨版本架构决策

### 11.1 流水线定义

- 使用 **TypeScript registry**（`src/config/pipelines/`），不引入 YAML 运行时。
- 理由：现有应用是 TS，类型校验比 YAML 更直接；manifest 里仍导出 pipeline id/version，保持可追溯。
- 如果未来需要非技术同学编辑，再加 JSON 编辑器/校验，不改运行时。

### 11.2 版本与兼容

- `ProductionRun` 新字段全部可选；旧 run 读取时给默认值。
- 包格式：
  - v1：当前 8 个文件。
  - v2：增加 `voiceover.mp3`、`subtitles.srt`、`voice.json`、`subtitle.json`。
  - v3：增加 `delivery_report.json` / 剪映包。
- 旧包仍可读；新包在 manifest 标 `formatVersion`。
- 本地备份：
  - v3 已含 runs；
  - R5 起备份默认不含媒体文件，只存路径/元数据；导出包可含媒体。

### 11.3 事件与审计

- R1 用 run 内 `events[]`；超过 200 条时保留最近 200 条，并在 UI 标“已截断”。
- 如果后续需要跨 run 查询/不可篡改，再迁到 `runEvents` 表；不在 R1 过度设计。

### 11.4 素材与媒体

- 媒体大文件不进入 Supabase 云同步。
- 素材元数据可同步；文件路径仅本机有效。
- 跨设备分享通过导出包，不通过云同步。

### 11.5 发布

- 永远保留人工发布；不接自动发布 API。
- 发布回填只读/绑定，不自动改写平台数据。

---

## 12. 测试与验收策略

每个 release 都要：

1. 新增对应纯函数 fixtures（工件、事件、pipeline、成本、质检）。
2. 新增 `tools/<release>-e2e.mjs`（Edge CDP），覆盖核心用户故事。
3. 回归：
   - `tools/runs-e2e.mjs`（v1 主流程）
   - `tools/run-preflight-test.mjs`
   - `tools/panel-e2e.mjs` 25/25
   - `smoke-test.ps1`（对新构建）
   - `tsc` / `oxlint` / `vite build` / hooks audit
4. 1440 和 390 宽度、亮/暗主题、无横向溢出。
5. 不推送、不部署；验收只在本地 5173/4173。

---

## 13. 风险与不做的范围

### 13.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 多流水线导致 UI/检查分叉 | 维护成本 | 所有阶段/检查/包由 registry 驱动，不写死在页面 |
| 平台变体变成自动改写脚本 | 质量/责任不清 | v1.3 只配对现有脚本版本，不自动改写 |
| 素材版权字段不准确 | 误标“可发布” | 未记录=unknown，阻塞发布包；人工确认 |
| TTS/Whisper 体积/环境 | 本地安装复杂 | 独立 worker，按需安装；主应用不打包 |
| 媒体进入云同步 | 数据/成本失控 | 媒体只本地；云同步仅元数据 |
| 成本口径与实际账单不一致 | 误导 | 标明估算/实际来源；不把估算当账单 |
| 事件/备份膨胀 | 本地存储 | 事件上限 200；媒体不进备份 |
| 渲染质量不可控 | 作品集翻车 | 先剪映/EDL 交接，再考虑 FFmpeg |

### 13.2 明确不做

- 不做 agent-first 自动编排
- 不做 13 条 pipeline
- 不做自动发布
- 不把 Python/MoviePy/Whisper/ffmpeg 全塞进主应用
- 不做无人工确认的“成功”判断
- 不在没有真实成本数据前做复杂预算系统

---

## 14. 推荐执行顺序

### 如果只有 1 周

做 **R1 + R2**：

- 阶段工件下载
- 运行事件时间线
- 发布绑定与校准

这三项能让“可追溯 + 闭环”完整成立，且不需要重依赖。

### 如果有 3 周

加 **R3 + R4**：

- 3 条流水线模板
- B站/抖音成组任务
- 素材库/版权门禁

这时已经是一个完整的“内容生产操作系统”雏形。

### 如果要做真正的成片

再做 **R5 + R6 + R7**：

- 配音/字幕
- 成本/批量
- 剪映/EDL/FFmpeg + 质检

但即使不做 R5–R7，前面的版本也已经是完整作品集项目。

---

## 15. 需要确认的默认决策

1. 流水线用 **TypeScript registry**，不引入 YAML 运行时。
2. 平台变体用 **独立 run + campaign 关联**，不做单 run 多 variant。
3. 发布回填复用 `Topic.published`，run 只存 `publishRef`，不改云端表结构。
4. 素材版权扩展 `LibraryAsset` 可选字段，不新建大表；媒体不进云同步。
5. 配音/字幕用独立本地 worker，主应用只编排。
6. 包格式 v1 → v2 → v3 兼容，旧包仍可读。
7. 所有版本继续“本地实现 → 预览 → 确认 → 同步”，确认前不推送。

---

## 16. 交付物（按 release）

每个 release 的交付物固定为：

- 代码与数据迁移
- 对应 fixtures + E2E
- 回归结果
- 更新后的 PRD/SOP 版本
- 1 个可演示的示例包/截图
- 不推送、不部署，直到用户确认

---

## 17. 建议的下一步

先确认 R1 + R2 是否作为下一批开工范围。

- 如果确认，我会先把这两项写成 **PRD v1.1** 的详细验收清单，再做本地实现。
- 如果你更想先做平台变体/素材版权，也可以把 R3 或 R4 提到前面；但 R1/R2 的投入产出比最高，且不会引入重依赖。
