# Creator Studio · UI 美化方案（待确认后动工）

> 目标项目：`D:\自媒体之路\creator-app`（Creator Studio 创作者工作台，已上线 https://creator.creator-app.xyz）
> 状态：**仅调研与方案，未改任何代码**。等你确认路线后再动工。
> 时间：2026-10-11

---

## 一、现状体检（我实地看的证据，不是印象）

### 1. 技术底座（好消息）
- `creator-app/package.json`：React 19.2.8 / Vite 8.2.0 / TypeScript 6.0.2 / **Tailwind CSS v4.3.3**（配 `@tailwindcss/vite`）/ Zustand 5 / Dexie 4 / react-router 7。
- **Tailwind v4 已经装好并在用** ⇒ 想要 shadcn/ui 那类"复制源码进项目"的组件体系，**前置条件已经满足**，不需要再加构建链。
- 设计令牌集中在 `creator-app/src/index.css`，只有 **21 行**：`--color-primary: #7c3aed`（紫）、`--color-bg: #fafafa`、`--color-surface: #ffffff`、`--color-border: #e5e7eb`、文字三级灰、success/warning/danger。

### 2. 代码量（决定施工量）
| 文件 | 行数 | 说明 |
|---|---|---|
| `src/pages/Analytics.tsx` | 880 | 数据看板（最大的美化收益点） |
| `src/pages/ScriptEditor.tsx` | 846 | 脚本编辑器（表单/弹窗密集） |
| `src/pages/TopicDashboard.tsx` | 654 | 选题看板（卡片网格） |
| `src/pages/Report.tsx` | 533 | 分析报告（长文版式） |
| `src/pages/Materials.tsx` | 486 | 素材工坊 |
| `src/types/index.ts` | 390 | — |
| `src/components/PlatformCheckPanel.tsx` | 320 | 平台适配检查面板 |
| `src/api/client.ts` | 282 | — |
| `src/pages/InfoCenter.tsx` | 228 | 资讯中心 |
| `src/pages/Settings.tsx` | 199 | 设置 |
| `src/components/Layout.tsx` | 53 | 顶栏 + 7 项导航 |
| 其余（store/db/utils/App/main） | ~360 | — |
| **合计 TSX/CSS** | **约 4,600 行**，产物 JS 466 kB（gzip 137 kB）+ CSS 34 kB（gzip 7.2 kB） |

### 3. 体检结论（**具体问题清单**）
✅ **做对的**：卡片样式已经收敛成一套约定 —— `bg-surface border border-border rounded-xl p-4/p-5` 在 9 个文件里出现 **42 次**，说明有基本规范（这是好事：美化可以基于它升级，不用推倒重来）。

❌ **问题 1：颜色没有单一事实源（最该先修）**。主按钮同时存在 **4 套写法**：
- `bg-primary`（多数）
- `bg-blue-600`（`Analytics.tsx:363`、`Report.tsx:135`、`Report.tsx:166`）
- `bg-purple-600`（`ScriptEditor.tsx:287`、`ScriptEditor.tsx:670`）
- 硬编码语义色 `text-orange-600 / border-orange-200 / bg-orange-50`（`ScriptEditor.tsx:280`、`:754`、`:776`）、`text-purple-600`（`:294`、`:663`）
⇒ 同一屏里会出现两种紫、两种蓝，是"看起来没做完"的主因。

❌ **问题 2：按钮/输入/标签全是手写类名，没有组件层**。`components/` 下只有 `Layout.tsx` 和 `PlatformCheckPanel.tsx`，**没有 Button/Input/Card/Badge/Modal/Toast 这类基础件**。所以：改一次按钮样式要改几十处；hover、focus、disabled、loading 的态不统一（`disabled:opacity-50` 有的写有的没写）。

❌ **问题 3：数据看板没有图表库**。条形图用 `div` + `bg-gradient-to-r from-pink-400 to-pink-500` 拼（`Analytics.tsx:101`、`:112`）⇒ 视觉上限低、无法做 tooltip/坐标轴/对比，也是"不像专业数据产品"的最大来源。

❌ **问题 4：图标全内联 SVG**（`Analytics.tsx:367` 那个 spinner 就是手写 SVG），没有图标库 ⇒ 图标大小/线宽/视觉重量不统一。

❌ **问题 5：没有暗色模式**（全项目 `dark:` 出现 **0 次**）。对"看板 + 长时间盯屏"的工具类产品，暗色是很实用的加分项（也是作品集观感差异最大的一项）。

❌ **问题 6：动效只有 `transition-colors` / `hover:shadow-sm`**（68 处 transition/shadow 命中里绝大多数是 hover 色变），没有页面/卡片入场、数字滚动、骨架屏 ⇒ 观感"静态、平"。

❌ **问题 7：顶栏是纯文字 nav**（`Layout.tsx:12-46`），7 项靠 flex-wrap 换行，没有图标、没有分组、没有面包屑 ⇒ 首屏组织感弱。

### 4. 一句话诊断
**这个项目的 UI 不是"乱"，而是"只有三层地基（Tailwind + 一套卡片约定 + 一套紫灰令牌），缺中间的组件层和最上层的图表/图标/动效"。** 所以美化不需要重构，重点是**补中间层 + 统一令牌 + 给看板配图**。

---

## 二、三条可选路线（成本 / 效果 / 风险对比）

| | 路线 A · 轻量精修 | 路线 B · 设计系统升级（**推荐**） | 路线 C · 换肤重构 |
|---|---|---|---|
| 做什么 | 只统一颜色令牌 + 修不一致的按钮 + 补 hover/focus/空状态 | A + **抽组件层**（Button/Card/Input/Badge/Tabs/Modal/Toast/Table/Skeleton）+ 引入图表库 + 图标库 + 暗色模式 | B + 引入整套 UI 框架（shadcn/ui 全套或模板）+ 重排版式/布局 |
| 改动范围 | ~10 个文件的类名 | 新增 `src/components/ui/*`，9 个页面逐个替换为组件调用 | 全部页面重写 DOM 结构 |
| 预估工作量 | 0.5 天 | 1.5~2.5 天 | 5 天+ |
| 视觉提升 | 小（只是"不脏"） | **大**（专业数据工具观感 + 暗色 + 图表 + 动效） | 大，但边际收益递减 |
| 风险 | 低 | 低-中（Tailwind v4 已经是底座；组件库若选 Radix 系需注意 React 19 版本） | 高（可能改坏已通过 60 项冒烟 + 25 项浏览器回归的功能） |
| 对线上验收的影响 | 冒烟断言可能要微调（文案/类名） | 需要全套回归（已有 `tools/smoke-test.ps1` 60 断言 + `tools/panel-e2e.mjs` 25 项，可复用） | 回归成本最高 |
| 适合场景 | 你今天就要交 | **作品集/求职展示 + 长期自用** | 有 1 周时间且想彻底改头换面 |

---

## 三、参考网站与 GitHub 库（2026-10-11 实测数据）

### 3.1 组件基座（星标 / 最近提交 / License 均为当天 API 实测）

| 方案 | 实测星标 | 最近提交 | License | 判断 |
|---|---|---|---|---|
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | **125,334** | 2026-10-11 | MIT | **首推**。不是依赖包，是把组件源码复制进你的项目 ⇒ 与 Tailwind v4 原生契合，不会多一层样式体系，能直接吃你现有的 `--color-*` 令牌 |
| [ant-design/ant-design](https://github.com/ant-design/ant-design) | 99,735 | 2026-10-11 | MIT | 企业级最全，但自带整套 CSS-in-JS 主题体系，和你现有的 Tailwind 类名会打架，中文界面友好度最高；**不建议**在这种已收敛的项目里整体引入 |
| [saadeghi/daisyui](https://github.com/saadeghi/daisyui) | 42,574 | 2026-10-08 | MIT | Tailwind 插件式语义类名（`btn`/`card`），最省事，但审美偏"通用"，且类名体系会与现有约定并存两套 |
| [chakra-ui/chakra-ui](https://github.com/chakra-ui/chakra-ui) | 40,680 | 2026-10-06 | MIT | SaaS 向，样式系统好，但同样是与 Tailwind 并行的第二套体系 |
| [mantinedev/mantine](https://github.com/mantinedev/mantine) | 31,819 | 2026-10-11 | MIT | 组件数量最全（含日期、富文本），适合"从零建站"；本项目已有 4,600 行 Tailwind 页面，迁移成本不划算 |
| [tailwindlabs/headlessui](https://github.com/tailwindlabs/headlessui) | 28,772 | 2026-04-13 | MIT | 无样式交互件（下拉/弹窗/切换），可作为 shadcn 的补充；更新节奏偏慢但成熟 |
| [douyinfe/semi-design](https://github.com/douyinfe/semi-design) | 10,406 | 2026-10-09 | **NOASSERTION ⚠️** | 字节系，3000+ token、中文本土化最好；**License 未标准化，商用前必须自己确认** |
| [radix-ui/themes](https://github.com/radix-ui/themes) | 8,761 | 2026-04-11 | MIT | 开箱即用的主题化组件，但主仓库近半年没动（2026-04 后无提交），shadcn 系更活跃 |
| [arco-design/arco-design](https://github.com/arco-design/arco-design) | 5,713 | 2026-10-10 | MIT | 字节 Arco，中文场景好，生态活跃度低于上面的选项 |

### 3.2 图表 / 看板（**本项目收益最大的单点**）

| 方案 | 版本（npm 实测） | License | React 19 支持 | 判断 |
|---|---|---|---|---|
| [recharts/recharts](https://github.com/recharts/recharts) | 3.10.1 | MIT | ✅ peer 含 `^19.0.0` | **首推**。声明式、与 React 心智一致、体积可控，条形/折线/雷达/散点够用；你要的"B站 vs 抖音对比条"用 BarChart 一行就能替换 `Analytics.tsx:88-124` 那个 div 实现 |
| [apache/echarts](https://github.com/apache/echarts) + [echarts-for-react](https://github.com/ecomfe/echarts-for-react) | 6.1.0 / 3.0.6 | Apache-2.0 / MIT | ✅（wrapper peer 允许 echarts ^6） | 图表能力最强、中文文档最好，但体积大（按需引入可缓解），风格偏"报表" |
| [tremorlabs/tremor](https://github.com/tremorlabs/tremor) | **3.18.7 ⚠️ peer 只到 `react@^18`** | Apache-2.0 | ❌ 未声明 React 19 | 看板组件（KPI 卡、进度条、图表）最贴合你 `Analytics.tsx`，但**当前版本 peer 未包含 React 19**，装了要 `--legacy-peer-deps`，有踩坑风险 ⇒ 不推荐现在引 |
| visx / nivo | 未核实 | MIT | — | 视觉精致但 API 学习成本更高；本项目不需要 |

### 3.3 图标 / 动效 / 基础工具（npm 版本 + peer 实测，全部支持 React 19 或与 React 无关）

- 图标：[lucide-react](https://github.com/lucide-icons/lucide) `1.55.0`（**ISC**，可商用，风格最百搭，shadcn 默认搭配）；[@phosphor-icons/react](https://github.com/phosphor-icons/react) `2.1.10` MIT（可选多套字重）；[@tabler/icons-react](https://github.com/tabler/tabler-icons) `3.49.0` MIT（数量最多）。
- 动效：[motion](https://github.com/motiondivision/motion)（原 framer-motion）`14.1.0` MIT，peer 含 `^19.0.0`；[Magic UI](https://github.com/magicuidesign/magicui) **22,592★** MIT · 2026-10-11（"数字滚动、光效边框、粒子"这类现成块，复制即用）；AutoAnimate 未核实（列表增删的自动过渡）。**提醒：工具类产品动效要克制，只在"数字变化/卡片入场/加载"三处用。**
- 基础工具链（shadcn 生态标配，体积极小）：`class-variance-authority@0.7.1`（Apache-2.0）、`tailwind-merge@3.7.0`（MIT，**v3 才对 Tailwind v4**）、`clsx@2.1.1`、`sonner@2.0.8`（Toast，MIT，React 19 ✅）、`@tanstack/react-table@9.2.8`（表格排序/筛选）、`vaul@1.1.2`（移动端抽屉）、`@number-flow/react@0.6.2`（数字滚动）。
- 已装且要对齐版本：`tailwindcss@4.3.3`（当前 registry latest 也是 4.3.3）。

### 3.4 设计参考网站（找灵感，不引依赖）

| 用途 | 网站 | 免费/付费 |
|---|---|---|
| 找**真实产品**的界面（最有价值） | [Mobbin](https://mobbin.com)（截图库，含 App/Web 全流程）、[Refero](https://refero.design)、[UI Sources](https://www.uisources.com) | Mobbin 部分付费；Refero 有免费档 |
| 找**数据看板/KPI 卡**布局 | [Tremor Blocks](https://blocks.tremor.so)、[shadcn charts 示例](https://ui.shadcn.com/charts)、[Tailwind Plus](https://tailwindcss.com/plus)（原 Tailwind UI） | 前两者免费抄结构；Tailwind Plus 付费 |
| 找**动效**灵感 | [Magic UI](https://magicui.design)、[Aceternity UI](https://ui.aceternity.com)、[Godly.website](https://godly.website)、[Awwwards](https://www.awwwards.com) | 免费为主，Aceternity 有付费档 |
| 找**落地页/排版** | [Landbook](https://landbook.com)、[Landingfolio](https://www.landingfolio.com)、[SaaS Landing Page](https://saaslandingpage.com)、[Lapa Ninja](https://www.lapaninja.com) | 免费 |
| 找**中文界面**规范与案例 | [优设 UISDC](https://www.uisdc.com)、[站酷](https://www.zcool.com.cn)、[花瓣](https://huaban.com)、[Ant Design 设计价值观](https://ant.design/docs/spec/introduce-cn)、[Semi Design 中文规范](https://semi.design/zh-CN/) | 免费（AntD/Semi 的中文排版规范最适合直接照搬字号/行高） |
| 找**组件细节**（按钮/输入/标签微交互） | [Uiverse](https://uiverse.io)、[HyperUI](https://www.hyperui.dev)、[Float UI](https://floatui.com)、[Meraki UI](https://merakiui.com) | 免费 |
| 配色/主题生成 | [Tweakcn](https://tweakcn.com)（可视化生成 shadcn 主题变量）、[Realtime Colors](https://realtimecolors.com)、[Coolors](https://coolors.co) | 免费 |

### 3.5 风险与坑（选型时必须知道）

1. **`@tremor/react` 当前 peer 只到 React 18**（实测 3.18.7）⇒ 本项目 React 19.2.8 装它要 `--legacy-peer-deps`，不推荐。
2. **`recharts` 需要 `react-is` 匹配版本**（peer 明确列出）⇒ 安装时注意 lockfile 里 `react-is` 版本，React 19 项目常在这里报错。
3. **`tailwind-merge` 必须 v3**（v2 只认 Tailwind v3 的类名规则），否则 `cn()` 合并会失效、样式覆盖出现玄学。
4. **shadcn/ui 需要路径别名**：`vite.config.ts` 要加 `resolve.alias` 的 `@/*`，`tsconfig` 要有对应 `paths`，否则 CLI 生成的文件 import 报错。
5. **Tailwind v4 没有 `tailwind.config.js`**：shadcn 文档里基于 config 的步骤在 v4 下要改成 `@theme`/`@custom-variant` 写法（本项目已经是 v4，注意别把 v3 的教程照抄进来）。
6. **两套样式体系并存是最大的隐性成本**：AntD/Mantine/Chakra 之类自带样式系统，和现有 Tailwind 类名混用会互相覆盖、调试困难 ⇒ 所以我推荐"复制源码型"的 shadcn，而不是"引入包型"的框架。
7. **中文排版必须自己定**：这些库的默认字体栈是英文优先（`-apple-system/Segoe UI/Roboto`），中文实际落到系统默认字，字号 14px 下中文会偏挤 ⇒ 要显式加 `"PingFang SC","Microsoft YaHei","Noto Sans SC"` 并调 `letter-spacing: 0`、行高 1.6~1.75。
8. **暗色不是加个开关**：现有 42 处卡片、68 处 hover 色都要能在暗色下成立，必须走"令牌 + `dark:` 变量"而不是逐处写 `dark:bg-...`，否则维护成本爆炸。
9. **动效与效率的平衡**：看板类产品用户是"高频重复使用"，入场动画超过 ~200ms 会明显变烦；数字滚动只在 KPI 变化时触发。
10. **License**：Semi Design 是 `NOASSERTION`（需自行确认）；ECharts 是 Apache-2.0（可商用）；Lucide 是 ISC（可商用）；避免引入 GPL/AGPL 类图表或组件。
11. **体积**：现在 JS 466 kB（gzip 137 kB）。Recharts 按需约 +100 kB 原始（gzip 约 35 kB）；shadcn 组件是源码进项目，只打包用到的部分。**改完要重新核对 bundle 体积并在报告里记录。**
12. **联网/本地优先的矛盾**：本项目是本地优先（Dexie），不要引入需要 CDN 的字体/图表/图标方案，全部走 npm 本地打包。

### 3.6 第二轮核实补充（2026-10-11，Bundlephobia + 二次 GitHub API）

**体积实测（全包 gzip，未 tree-shake，只作量级比较）**：antd **445.2 KB**、ECharts 359.3 KB（可自定义构建裁到 100 KB 内）、Chakra 306.5 KB、Arco 267.3 KB、Tremor 217.3 KB、lucide-react 190.7 KB（按需单图标约 0.3–1 KB）、Mantine 170.4 KB、Recharts 148 KB（常用 2–3 种图约 40–60 KB）、Tabler 图标 487 KB、Phosphor 图标 **1039.9 KB**、Radix Themes 61.5 KB、DaisyUI 49.1 KB、Motion 46.8 KB、TanStack Table **31 KB**、Iconify React 2.1 KB。

**补充结论**
- **新发现可用项**：[React Bits](https://github.com/DavidHDev/react-bits) **48,903★**（但 License `NOASSERTION` ⚠️）、[AutoAnimate](https://github.com/formkit/auto-animate) 13,928★ MIT **零依赖 <5 KB**（列表增删动画最安全的选择）、[TanStack Table](https://github.com/TanStack/table) 28,480★ MIT **31 KB headless**（与手写 CSS 零冲突）、[ECharts](https://github.com/apache/echarts) **67,475★** Apache-2.0（中文文档/中文标签最友好）。
- **Mantine 9 是唯一以 `react ^19.2.0` 为 peer 基线的主流库**（`@mantine/core@9.7.2`，依赖仅 5 个、无 Emotion）—— 若想少写代码它是备选；但它自带 CSS Modules 体系，与现有 Tailwind 仍属双轨。
- **两条硬证据（否决混搭）**：① [ant-design/ant-design#56015](https://github.com/ant-design/ant-design/issues/56015) 记录「antd v6 + Tailwind v4 样式丢失」；② [tailwindlabs/tailwindcss#17448](https://github.com/tailwindlabs/tailwindcss/issues/17448) 记录 v4 里 `@apply` 会把声明全变 `!important` —— 这是 Tailwind 与手写 CSS 冲突的实锤 ⇒ 缓解办法是把 Tailwind 关进独立 `@layer`，禁止用 `!important` 决战。
- **shadcn 的 Vite 安装第一步就是装 Tailwind**（[官方文档](https://ui.shadcn.com/docs/installation/vite)）⇒ "只用 shadcn 不引 Tailwind"这条路不存在；本项目 Tailwind v4 已装，正好命中。
- **停更风险清单**：[Uiverse](https://github.com/uiverse-io/galaxy) 2024-09-02、[Float UI](https://github.com/MarsX-dev/floatui) 2025-03-23、[Meraki UI](https://github.com/merakiui/merakiui) 2025-07-11、[Tremor](https://github.com/tremorlabs/tremor) 2025-10-10、[animate-ui](https://github.com/animate-ui/animate-ui) 2025-12-31、[Headless UI](https://github.com/tailwindlabs/headlessui) 2026-04-13、[Radix Themes](https://github.com/radix-ui/themes) 2026-04-11 ⇒ 当灵感站可以，绑依赖要慎重。
- **字体许可**：MiSans / HarmonyOS Sans 是厂商自有许可（免费商用但**不是 OFL**）；Inter / Geist 是 OFL-1.1 纯西文。⇒ **本项目决定不引入任何 webfont，只用系统字体栈**（避免数 MB 中文字体与本地优先冲突）。
- **图标体积**：Phosphor 全包 1 MB、Tabler 487 KB、lucide 190 KB ⇒ 全部**按需具名导入**，禁止 `import * as Icons`。

## 七、已确认的施工决策（用户 2026-10-11 选择）

| 项 | 决定 |
|---|---|
| 路线 | **B · 设计系统升级**（令牌 + 组件层 + 图表 + 图标 + 暗色） |
| 风格 | **中性深灰蓝（cool gray / slate）为主色系，保留紫色作强调色** |
| 暗色模式 | **要**（`.dark` 类 + CSS 变量整体切换，不做逐处 `dark:` 硬编码） |
| 改动边界 | **允许顺带调整信息层级**（顶栏加图标与分组、看板卡片重排、报告页折叠） |

**决定采用的技术选型（基于上面的实测）**：手写 `src/components/ui/` 组件层（CVA + clsx + tailwind-merge@3，等于 shadcn 的拷贝式思路，但不跑 CLI、不加第二套样式体系）+ Recharts 3.10.1（React 19 peer 命中）+ lucide-react（按需具名导入）+ AutoAnimate（<5 KB，列表动画）+ 系统字体栈（不引 webfont）。**不引入**：Tremor（React 19 peer 不命中且停更）、antd/Mantine/Chakra（第二套样式体系 + 体积）、任何需要联网 CDN 的方案。


---

## 四、我的推荐（待你确认后再动工）

**推荐路线 B，分四步做，每步都能单独验收、随时叫停：**

- **第 0 步 · 先看效果再决定（0.5 小时）**：我用无头 Edge 给现网 4 个关键页（选题看板 / 脚本编辑 / 数据看板 / 分析报告）截一组"改造前"图给你，同时按选定风格做 **1 张静态效果对比图**（不改代码）——你看图确认风格方向，再决定要不要全量施工。**这一步能把"确认"变得没有猜测成本。**
- **第 1 步 · 令牌与组件层（0.5~1 天）**：把 `index.css` 的 21 行令牌扩展成完整设计系统（色阶、圆角、阴影、间距、字号、暗色变量）；新增 `src/components/ui/` 基础件；把 9 个页面里不一致的按钮色（4 套写法）一次性收敛。
- **第 2 步 · 看板升级（0.5 天）**：数据看板接入图表库，把 div 拼的条形图换成带 tooltip/对比/坐标轴的图表；报告页做排版层级（引用块、数字强调、可折叠）。
- **第 3 步 · 观感细节 + 暗色模式（0.5 天）**：图标库替换内联 SVG、卡片入场与数字滚动动效（克制）、骨架屏、空状态插画、暗色模式切换。
- **每步之后**：跑 `tools/smoke-test.ps1`（60 断言）+ `tools/panel-e2e.mjs`（25 项）+ `build.ps1`，并给"改造前/后"成对截图。**功能不掉一项，这是我做这件事的硬条件。**

---

## 五、需要你确认的四件事

1. **路线**：A（轻量精修）/ **B（设计系统升级，推荐）** / C（换肤重构）
2. **风格方向**：① 保持现在的紫（更偏"创作工具"）② 换中性深灰蓝（更偏"专业数据产品"，像 Linear/Retool）③ 换暖色（更偏"内容/生活向"）
3. **暗色模式**：要不要（要的话工作量 +0.5 天，但作品集观感收益最大）
4. **边界**：只改视觉（推荐）/ 允许顺带调整页面信息层级（比如顶栏加图标与分组、看板卡片重排）

---

## 六、落地清单（确认后按此执行，先列清楚再动手）

### 1. 令牌层（改 1 个文件，收益最大）
`creator-app/src/index.css`（现 21 行）扩成完整设计系统：
- 色阶：`--color-primary-50…900`（不再只有 primary/light/dark 三档）、语义色 success/warning/danger 各 3 档、中性色 6 档
- 圆角 `--radius-sm/md/lg/xl`、阴影 `--shadow-xs/sm/md/lg`（现在只有 Tailwind 默认）、间距与字号阶梯、`--font-sans` 中文字体栈（追加 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC"`，现在只有 `-apple-system/Segoe UI/Roboto`，中文实际落到系统默认，字重/行高会漂）
- **暗色模式**：`.dark` 变量覆盖（Tailwind v4 用 `@custom-variant dark`）
- 收敛现有 4 套按钮色（`bg-primary` / `bg-blue-600` / `bg-purple-600` / 硬编码 orange）到语义令牌

### 2. 组件层（新增目录 `creator-app/src/components/ui/`）
`button.tsx`（variant: primary/secondary/ghost/danger + size + loading）、`card.tsx`、`input.tsx`/`textarea.tsx`/`select.tsx`、`badge.tsx`、`tabs.tsx`、`modal.tsx`（现在 5 处各写一遍 `bg-surface rounded-xl shadow-xl max-h-[80vh] overflow-y-auto`，`ScriptEditor.tsx:494/581/684`、`TopicDashboard.tsx:251/489/620`）、`toast.tsx`、`table.tsx`、`skeleton.tsx`、`empty-state.tsx`、`tooltip.tsx`、`theme-toggle.tsx`

### 3. 图表层（**收益最大的单点**）
把 `Analytics.tsx:88-124` 那个 div 拼的条形图、以及各处手写柱状/进度条换成图表库（选型见第三节）；`StatCard`（`Analytics.tsx:127-140`，用 `style={{color: accent}}` 传颜色）改成用语义令牌的组件

### 4. 图标层
替换内联 SVG（如 `Analytics.tsx:367` 的手写 spinner、各页按钮上的图标）为图标库；顶栏 7 个导航项配图标（`Layout.tsx:22-44`）

### 5. 版式与信息层级
- `Analytics.tsx`（880 行）：KPI 区 → 图表区 → 明细表的分组与留白统一
- `Report.tsx`（533 行）：长文排版（标题层级、数字强调、可折叠小节、导出 Markdown 按钮位置）
- `TopicDashboard.tsx`：卡片网格 hover/选中态、筛选项做成 Tabs/Badge
- `ScriptEditor.tsx`：表单字段 label/错误提示/必填标记统一，弹窗改统一 Modal
- `Materials.tsx` / `InfoCenter.tsx` / `Settings.tsx`：跟着令牌自动受益，只做替换不做重排

### 6. 每步的验收（不许掉功能）
`node --version` 无关；执行顺序固定为：`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force` → `creator-app` 里 `npx.cmd tsc -b --force`（EXIT=0）→ `D:\自媒体之路\build.ps1`（4 步，含 hooks-audit）→ `tools/smoke-test.ps1`（60 断言，含公网参数）→ `tools/panel-e2e.mjs`（25 项浏览器回归）→ 部署后核对首页引用的 `assets/index-*.js` 哈希 + 公网 `/api/health` 200 → **每步给"改造前/后"成对截图**。
⚠️ 已知坑（文件里几条必须遵守）：后端重启只能用 WMI `Win32_Process.Create` 脱离工具进程树（否则公网 502）；改 `server/public` 后必须重新构建部署，直接改 dist 无效。

## 八、改造完成记录（2026-10-12 实测）

> 状态：路线 B 四步全部落地，功能零回归。下面的数字都是本机实跑结果。

### 1. 新增依赖（`creator-app/package.json`）
`class-variance-authority@0.7.1`、`clsx@2.1.1`、`tailwind-merge@3.7.0`、`lucide-react@1.55.0`、`recharts@3.10.1`（peer `react@19.2.8` ✓，连带 `react-is@19.3.0`）、`@formkit/auto-animate`。
`npm audit` 有 1 个 high（`source-map-js`），是构建期传递依赖、不进产物，**不要跑 `npm audit fix`**。

### 2. 落地的文件
- 令牌：`creator-app/src/index.css`（21 → 235 行，全部语义变量 + `.dark` + `@theme inline` 映射 + 中文字体栈）
- 组件层（新增 11 个）：`creator-app/src/components/ui/{Button,Card,Badge,Input,Modal,Spinner,Skeleton,EmptyState,Tabs,Toast,ThemeToggle}.tsx` + `creator-app/src/utils/{cn,theme}.ts`
- 图表：`creator-app/src/pages/Analytics.tsx` 的 3 个自研图表换 Recharts（`CHART` 令牌色 + `compactNum`）
- 图标：顶栏 7 项 + 各页按钮/状态换 `lucide-react`
- 弹窗：7 处手写遮罩换 `ui/Modal`（`TopicDashboard.tsx` 3 处、`ScriptEditor.tsx` 4 处），保留 `<form onSubmit>` 语义
- 路由：`creator-app/src/App.tsx` 7 个页面 `React.lazy` + `Layout.tsx` `<Suspense>`，把 Recharts 关进看板 chunk
- 打磨：`EmptyState` / `LoadingBlock` / `AutoAnimate` 覆盖 6 处空状态与 2 处列表；`Report.tsx` 标题分级 + 数字 `tabular-nums` + 脚注引用块

### 3. 体积（构建前后同一口径）
| 项 | 改造前 | 最终 |
| --- | --- | --- |
| 首屏 JS | 466 kB 单 chunk | `assets/index-*.js` 264.32 kB（gzip 85.17）|
| 看板 JS | 同上 | `assets/Analytics-*.js` 418.24 kB（gzip 118.53，懒加载）|
| CSS | 34 kB | 37.56 kB（gzip 7.55）|
| `server/public` | — | 940.3 KB |

> 中间态警示：Recharts 全打进单 chunk 时首屏曾到 895 kB / gzip 262 kB，所以才做路由级懒加载。

### 4. 验收（每次改动后重跑）
- `npx.cmd tsc -b --force` EXIT=0；`D:\自媒体之路\build.ps1`（含 hooks-audit）EXIT=0
- `tools/panel-e2e.mjs` 25/25 PASS
- `tools/smoke-test.ps1` 本地 30/30、公网 `-PublicUrl https://creator.creator-app.xyz` **60/60 PASS**
- `D:\wp\_shots.mjs` 13 张亮/暗截图 EXIT=0；`D:\wp\_modal-probe.mjs` 弹窗验收 MODAL_PROBE_OK（1 层遮罩、有 X、Esc 可关、`<form>` 保留）

### 5. 顺手修掉的真 bug
报告「标题模式」4 个指标在游戏子分区样本 < 20 时仍给出 `sampleSize=0` 的数字 ⇒ 自检报 `unbacked=4`、markdown 导出的自检标记不过。改为**样本不足就不给数字**（`null` + 页面提示），`server/src/types.ts`、`server/src/services/reportService.ts`、`creator-app/src/types/index.ts`、`creator-app/src/pages/Report.tsx` 同步；复测 `unbacked=0`。

### 6. 已知遗留（不阻塞）
- `/scripts`、`/materials` 在没有本地数据时几乎空白（改造前就是这样，空状态已换成 `EmptyState`）
- `Analytics` chunk 418 kB 偏大，后续可把多 tab 明细表再拆
- 弹窗内既有的「关闭」文本按钮与 Modal 头部 X 并存，可再收一次
- 后端源码改动后必须重启（`tsx` 无 watch）；`stop.ps1` 结尾 `pause` 会阻塞，改用 `Get-NetTCPConnection -LocalPort 3001 | Stop-Process` + `D:\自媒体之路\autostart.ps1`

---

## 九、第二轮「高级感」升级（2026-10-12 夜，按 HR 视角做作品集）

### 1. 起因与确认
User said (m06377): 「现在ui优化完了吗？我怎么感觉还是很简陋，我想要高级感，那种让hr看到我的项目的时候会眼前一亮的那种感觉」。
四项确认**全选**：① 左侧固定侧边栏 + 页面头 ② 首页作品级 Hero + KPI 指标条 ③ 一键载入演示数据 ④ 卡片/图表质感 + 微交互动效；边界选「可以重排，功能不变」。

### 2. 设计系统加层（`creator-app/src/index.css`）
- 新令牌：`--shadow-card/-hover/-float`、`--ring-card`、`--grid-line`、`--brand-from/to`、`--brand-soft-from/to`、`--glow-1/2`
- 组件基元（`@layer components`）：`.card`、`.card-hover`（上移 2px）、`.text-brand`、`.bg-brand-gradient`、`.bg-brand-soft`、`.texture-grid`（34px 网格 + radial mask）、`.glow-spot`、`.eyebrow`、`.num`
- 动效：`ui-rise`/`ui-fade`/`ui-pop`/`ui-shimmer` keyframes + `anim-rise|anim-fade|anim-pop|stagger-children`（nth-child 1–12 递增延迟），`prefers-reduced-motion` 下全关

### 3. 新增 / 重写
- 新增 `src/components/ui/PageHeader.tsx`（`PageHeader` + `SectionHeading`）与 `src/components/ui/Stat.tsx`（KPI 卡 + delta 箭头，6 种语义色）
- 重写 `src/components/Layout.tsx`：左侧 244px 固定侧边栏（创作台/数据/系统 三组 7 项，选中态左侧渐变指示条）+ 主区 `max-w-[1180px]`；移动端 sticky 顶栏 + 可横向滚动药丸导航
- 重写 `src/pages/TopicDashboard.tsx` 首屏：Hero（网格纹理 + 两团光晕 + 渐变标题「从热点到成片，一条流水线」+ 两个主按钮）+ 2×2 KPI（选题池/已发布/累计播放/平均预测偏差，全部由本地数据现算）
- 6 个页面视觉升级由 3 个并行 subagent 完成（`Analytics`+`Report`、`ScriptEditor`、`Materials`+`InfoCenter`），Lead 同期做 `Settings.tsx`、演示数据、`App.tsx`/`index.html`；`git diff --stat` 合计 3840 insertions / 1900 deletions

### 4. 演示数据（让 HR 打开就不是空白页）
- 新增 `src/services/demoData.ts`：`seedDemoData()`（9 选题 + 6 脚本，含 AI 评估、完整素材方案、已发布真实量级数据）、`clearDemoData()`、`countDemoData()`、`ensureDemoData()`；localStorage 开关 `creator-studio-demo`（`on|off|auto`），数据 id 一律 `demo-` 前缀，便于一键清理
- `App.tsx`：`syncOnLaunch()` 完成后若本地库为空则自动载入（避免与云端同步竞态）；`Settings.tsx` 有「载入/清空演示数据」按钮与状态徽标
- 只写本机 IndexedDB，不进云端同步；`index.html` 补 title/description/og/theme-color + 防暗色白闪内联底色

### 5. 本轮修掉的真问题
1. **`build.ps1` 中文导致解析失败**：文件是 UTF-8 **无 BOM**，Windows PowerShell 5.1 按 ANSI 解码后报「字符串缺少终止符」 ⇒ 重写为 **UTF-8 with BOM**。**教训：给 .ps1 加中文必须带 BOM。**
2. **`/info` 一次渲染 500 条**（149,435 字符、516 个按钮、500 张卡）⇒ 首屏只渲染 24 条 + 「显示更多」（复测 9,153 字符 / 41 按钮 / 24 卡，筛选变化自动重置）。
3. **手机宽度（390px）真实横向滚动**：首页选题卡按钮行不换行（`scrollWidth` 584 > 390）、设置页 `SectionHeading` 的 `truncate`（`white-space: nowrap`）把 min-content 撑到 379（441 > 390）⇒ 选题卡改 `flex-col gap-3 sm:flex-row`、按钮行 `flex-wrap sm:shrink-0`、`Card` 根加 `min-w-0`、`SectionHeading` 的 h2/hint 加 `min-w-0`。复测 8 个页面在 390px 全部 `scrollWidth == clientWidth`。

### 6. 本轮验收（本机实跑）
- `npx.cmd tsc -b --force` EXIT=0；`build.ps1` EXIT=0
- 体积：首屏 `index-*.js` 394.85 kB（gzip 129.60）、`Analytics-*.js` 419.26（119.38，懒加载）、`TopicDashboard-*.js` 22.85、`ScriptEditor-*.js` 34.21、`Report-*.js` 23.45、`server/public` 2703 KB
- `tools/panel-e2e.mjs` **25/25**、`tools/smoke-test.ps1` **30/30**、`_modal-probe.mjs` MODAL_PROBE_OK
- 新探针 `D:\wp\_page-audit.mjs`（8 页 × 亮/暗 1440px + 390px：标题、卡片数、圆角/阴影、图表数、横向溢出、页面错误）与 `D:\wp\_ovf.mjs`（溢出元素定位）全绿；页面报错只剩被故意拦截的 `/api/sync` 噪声
- 截图 `D:\wp\_shots\*.png`（亮/暗 13 张 + 弹窗 3 张）

### 7. 已知遗留（不阻塞）
- 素材卡没有真实缩略图（`src/types/index.ts` 无图片字段），用品牌色纹理 + 分类 emoji 封面，未伪造图片
- `Stat` 根类自带 `card-hover`，放进弹窗时会有轻微上浮
- 报告页宽表格在 390px 下靠容器内横向滚动（页面本身不溢出），可考虑改卡片式

---

## 十、第三轮：把「每个功能内部」也做完整（2026-10-12 深夜）

### 1. 起因
User said (m06768): 「我现在觉得需要优化每个功能内的ui，就比如这张图里面，感觉太简陋」（附 1235×918 截图）。
外壳（侧边栏 / 页面头 / 卡片令牌）已在前两轮做完，这一轮针对**功能内部的工作面**：表单、面板、条目、行内文本块。

### 2. 截图定位（AI 看不到图，全靠工具）
- **WinRT OCR** `D:\wp\_ocr.ps1 -Path <图> -Lang zh-Hans-CN`（用 `[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage`）读出「创作台 / SCRIPT」「脚本编辑」「分镜脚本」「平台适配检查」「出处：Cui, Chung, Peng & Wang (2024), Journal of Business Research 183:114349」⇒ 判定为 `/scripts/demo-script-6` 编辑页。
- **DOM 结构快照** `D:\wp\_inner.mjs <route> <out.txt>`（CDP，walk main，输出 `tag.class [fontSize] :: 文本`）——用来找「正文 10-11px」这类只有渲染后才看得见的问题。
- **残留扫描** `grep -E 'text-\[1[01]px\]|bg-background|font-bold|rounded-lg border border-border'`：PlatformCheckPanel 14 处、TopicDashboard 弹窗内部 8 处、Analytics 四个裸 input、Materials 裸 select、Settings 表单栅格等。

### 3. 新增基元
- `src/components/ui/SourceNote.tsx`：把「数据出处 + 等级 + 样本量」这件反复出现的事做成一件事 —— `SourceNote({tier:'A'|'B'|'C', label, note, children})`，左边一个小等级徽标 + 右侧 12px 正文，统一 `bg-surface-muted/60` 圆角块（此前是 11px 灰字 + 10px 徽标糊成一整段）。
- `src/components/ui/Stat.tsx` 增加 `interactive`（默认 `true`）：放进弹窗/表格里传 `interactive={false}`，修掉「评分卡跟着悬停上浮」的瑕疵。

### 4. 重写 `PlatformCheckPanel.tsx`（截图里最简陋的那块，逻辑一行未改）
平台切换改分段控件（`aria-pressed`）；封面文案改 `Field` + `Input`；规则条目一条一张卡（圆形序号 + 名称 + 状态徽标 + 结论 + 建议行 + `SourceNote`）；时长结论块、另一平台对比块、AI 候选块各自成结构化区块；免责声明改左侧竖线脚注。

### 5. 剩下的工作面
- 3 个并行 subagent：`Analytics`+`Report`（四个裸 input → `Field`/`Input`，表格 `divide-y` + hover + `num`，五处「数据来源」→ `SourceNote`）、`Materials`+`InfoCenter`+`Settings`（裸 select → `Select`，筛选工具条、信息行、`dangerGhost`）、`TopicDashboard`（弹窗内部；该 agent 中途失败，遗留由 Lead 补齐）。
- Lead 自己做 `ScriptEditor.tsx`（截图那页）：标题/钩子/备注/关联选题全改 `Field`+`Input`/`Textarea`/`Select`；AI 建议内联面板的错误/建议/技巧块各自成块；分镜卡头改 `ChevronDown` 旋转图标、展开区字段全部换组件；删除自维护的 `FIELD_CLASS`/`LABEL_CLASS`。**至此 `pages/*` 已无裸 `<input>`/`<select>`/`<textarea>`。**

### 6. 本轮修掉的真问题
1. **验收脚本把 UI 文案当契约**：`tools/panel-e2e.mjs` 依赖 `input[placeholder="不填就不会给封面相关的结论"]` 与 `规则：N 条…` 两段文案，重写面板时被顺手改掉 ⇒ 两处都按原样还原（placeholder 保留，hint 改写别处），复跑 25/25。**教训：改面板文案前先 grep `tools/panel-e2e.mjs`。**
2. **subagent 中途失败**留下的半成品：`TopicDashboard.tsx:525` 用了 `ArrowRight` 没导入（TS2304）、「记录发布结果」弹窗仍是手写结构 ⇒ Lead 补齐并把该弹窗重写为 `Modal` + `Field`/`Input` + 指标卡网格。
3. `Materials.tsx:14` 导入的 `TriangleAlert` 未使用（TS6133，`noUnusedLocals`）⇒ 用在错误提示条上。

### 7. 本轮验收（本机实跑）
- `npx.cmd tsc -b --force` EXIT=0；`build.ps1` EXIT=0；首屏 `assets/index-BkkqRPP9.js` 389.4 KB、`server/public` 5.57 MB
- `tools/panel-e2e.mjs` **25/25**；`tools/smoke-test.ps1` 本地 **30/30**、公网 `-PublicUrl https://creator.creator-app.xyz` **60/60**（首次 59/60 系隧道抖动，重跑全绿）
- `_page-audit.mjs`：8 页 × 亮/暗 1440px 全部 `scrollWidth == clientWidth`；390px 仅剩装饰光晕与报告宽表格（在容器内滚动）
- `_inner.mjs` 快照：正文已无 10-11px 小字（剩余小字只出现在 eyebrow / Badge sm / `.num` 等有意处）
- 新探针 `D:\wp\_publish-probe.mjs`：发布弹窗 **PUBLISH_PROBE_OK**（「记录发布」→ `Field` 标签与 placeholder 正常 → 输入 `BV16io9YTEqH` 点「取数」→ 真实数据 684.6 万播放 / 51.8 万赞 / 35.3 万币 → 「保存发布记录」可点 → Esc 关闭，无 JS 报错）

### 8. 本轮遗留（不阻塞）
- `Report.tsx` 里 `basis.source === 'derived' ? 'C' : 'A'` 的等级判断是合理推断但非权威；Analytics 平台对比的「混合口径」段未标等级，只有脚注
- 药丸选中态仍是 `bg-primary text-white`（与 `ui/Button` primary 同一套），未统一到 `primary-contrast` 令牌
- 素材推荐卡的「💡 理由」没有套 `SourceNote`（等级无法判断）
- 报告页宽表格在 390px 仍靠容器内横向滚动

---

## 十一、账号制 + 性能优化（2026-10-12 深夜，第四轮）

### 1. 起因

用户两条需求（同一条消息里）：

> 「云端数据改为账号制度，单个账号对应一份云端数据。新用户打开网页直接展示演示数据，注册账号后自动清空演示数据。」
> 「优化性能吧，我也觉得有些卡。」

第一句还顺手补上了上一轮评审里我自己列出的 P0 隐患：改造前 `/api/sync/upload`、`/api/sync/download`
**没有任何鉴权**，实测 `GET https://creator.creator-app.xyz/api/sync/download` 公网可读全部云端数据
（HTTP 200 / 46447 字节）。账号制的结构、契约、口令/令牌设计与认领流程单独写成
`D:\自媒体之路\docs\account-system.md`（README 里也指向它）。

### 2. 为什么是「单行 + 账号隔离」而不是「每账号一行」

- `server/.env` 只有 Supabase 的 **anon key**（无 service key、无 DDL 权限）⇒ **不能新建表**；
- `supabase-schema.sql:11` 有 `CONSTRAINT single_row CHECK (id = 1)` ⇒ 连插第二行都不行。

所以复用原来那一行（`app_sync.id = 1`），把 `data` 从 v1 升级成 v2：
`{ version: 2, users: [...], accounts: { [userId]: { topics, scripts, uploadedAt } }, legacy? }`；
隔离在服务端 API 层完成——**请求体里的 userId 一律忽略，只认 token 里的身份**。
「读-改-写」用模块级 promise 链串行化（`updateCloud()`），避免并发注册互相覆盖。

### 3. 服务端新增 / 改动

| 文件 | 内容 |
|---|---|
| `server/src/services/cloudStore.ts`（新） | v2 blob 归一化 + v1→v2 迁移（老数据进 `legacy`，一条不丢、**没有任何接口会返回它**）+ 串行化读改写；查询失败 502、未配置 503，「查不到」与「云端为空」语义分开 |
| `server/src/services/authStore.ts`（新） | scrypt（N=16384, r=8, p=1, keylen=32）加盐哈希、`timingSafeEqual`、无状态 HMAC 令牌（90 天）、`AUTH_SECRET` 或自动生成 `server/data/auth-secret.txt`、登录时用户不存在也跑一次 scrypt 防枚举 |
| `server/src/middleware/requireAuth.ts`（新） | Bearer 校验 → `401 { code: 'UNAUTHORIZED' }` |
| `server/src/routes/auth.ts`（新） | `register` / `login` / `me` / `logout` / `status` |
| `server/src/routes/sync.ts`（重写） | 两个接口挂 `requireAuth`，按 token 身份读写自己的那份；乐观锁 409 `CONFLICT` 与「失败不误覆盖」语义保留；`/status` 返回 `{ syncConfigured, accountMode: true }` |
| `server/src/middleware/compression.ts`（新） | `gzipJson()`（≥1KB 的 JSON/文本自动 gzip）+ `ensurePrecompressed()`（启动时给 `server/public` 生成 `.gz`）+ `servePrecompressed()`（`/assets/*` 带 `immutable` 长缓存，HTML `no-cache`） |
| `server/src/index.ts` | 挂 `/api/auth`；注册 5 次/10 分、登录 12 次/分限流；静态资源缓存头 + 预压缩；SPA fallback 加 `no-cache` |
| `server/scripts/cloud-admin.ts`（新） | `stats` / `prune-prefix <前缀>` / **`adopt-legacy <用户名> [--force]`** / `rewrite` |

### 4. 前端接线

`client.ts`（`AUTH_TOKEN_KEY='creator-studio-token'` + 只在有 token 时注入 Bearer）、新建
`services/authService.ts`（`useAuthStore`：`init/register/login/logout/refreshMe`）、
启动链 `init() → syncOnLaunch() → ensureDemoData()`、401 统一「清 token + 提示登录过期 + 向上抛」、
Layout 右上角账号入口、Settings 新增「账号与云端」卡（注册 / 登录 / 云端条数 / 立即同步 / 退出）。

**注册后自动清演示数据**由 `afterAuthSuccess()` 保证：`clearDemoData()` → `syncOnLaunch()` → `refreshMe()`；
有 token 时 `ensureDemoData()` 直接返回（已登录用户不会被塞演示数据）。
另外把「演示数据不会进入云端同步」这句话补成真的：`syncUpload()` 上传前过滤掉 id 以 `demo-` 开头的记录。

### 5. 性能优化（四件事）

1. **分包**：`vite.config.ts` 加 `manualChunks`（`vendor-react` / `vendor-db` / `vendor-utils`），
   入口 chunk 从 394.99 kB 降到 **36.39 kB**（gzip 14.81）；CSS 44.3 → 37.56 kB；
2. **图表懒加载**：`pages/analytics/charts.tsx` 独立成块，`TrendChart` / `ComparisonBars` 用
   `React.lazy` + `Suspense`（Skeleton 占位）——recharts 那 391.76 kB **只在真的画图时才下载**，
   而且不在 `dist/index.html` 的 `modulepreload` 列表里；Analytics 路由块 409.1 → **28.64 kB**；
3. **传输层**：JSON gzip + 静态资源预压缩 `.gz` + `/assets/*` immutable 长缓存。
   实测主入口 chunk 36,393 → **14,745 字节（−59%）**，`/api/news`、`/api/report/game-industry` 也已是 gzip；
4. **列表分页**（上一轮遗留的真问题）：资讯中心一次 500 条 → 每次 24 条 +「显示更多」，
   渲染文本 149,435 → 9,153 字符，卡片 500 → 24。

### 6. 测量数据（前后对比，工具 `D:\wp\_perf.mjs`）

**本机 3001（无隧道噪声，最可比）**：冷启动 load 74 → **64 ms**，FCP 144 → **132 ms**，
传输 550 KB → **164 KB（−70%）**；热启动 20 → 20 ms。

**公网（cloudflared 隧道，波动大：before 只有 1 次采样，after 取了 3 次）**：

| 指标 | 改造前 | 改造后（3 次） | 结论 |
|---|---|---|---|
| 冷 load | 2199 ms | 2840 / 2187 / 1740 → 中位 **2187** | 基本持平 |
| 冷 FCP | 2260 ms | 2908 / 2236 / 1800 → 中位 **2236** | 持平 |
| 冷 LCP | 5108 ms | 5640 / 4468 / 3824 → 中位 **4468** | −12.5% |
| 冷传输 | 184 KB | **163 KB** ×3 | −11% |
| 热 load | 880 ms | 656 / 928 / 810 → 中位 **810** | −8% |
| `/api/report/game-industry` 中位 | 853 ms | 575 / 584 / 538 → 中位 **575** | −33% |

⚠️ 诚实的解释：**冷启动不能只怪代码**。改造前那次采样用的是「云端已有数据」的浏览器档案
（`demo=null`，页面直接显示用户自己的 2 个选题）；改造后是**全新访客**，要现场种 9 个选题 + 6 份脚本
（`demo` 出现在 3.9–5.6 s），两者不是同一种首屏。公网单次冷采样的抖动本身就很大
（同一天 API 中位 538–853 ms），所以真正可信的是**本机数字、字节数、体积表和路由块大小**，
这几项都是显著下降的。

### 7. 本轮修掉的真问题

- **公网可读写的云同步接口**（P0）：现在匿名/伪造 token 一律 401，冒烟里加了固定断言；
- `ensureDemoData()` 会把演示数据塞给已登录用户 → 有 token 直接返回；
- 「演示数据不会进入云端同步」与实际不符（`syncUpload` 会把 `demo-` 前缀数据一起传）→ 上传前过滤；
- 老云端数据在迁移后「看不见」（匿名上传、无归属）→ 自动进 `legacy` 不丢 + `adopt-legacy` 认领命令；
- **冒烟脚本本身的两个过时契约**：入口 chunk 断言 `-gt 100000`（分包后入口只剩 36 KB）
  → 放宽为 `-gt 10000` 并**新增** vendor chunk 断言；顺带补 `/api/auth/status` 与匿名 `/api/sync/download` 401 两项。

### 8. 验收（本机实跑，2026-10-12）

| 项目 | 结果 |
|---|---|
| 前后端 `tsc` | EXIT 0 |
| mock Supabase 端到端（`_cloud-mock.mjs` + 3102 实例 + `_account-probe.mjs`） | **24/24 PASS** |
| 线上真实 Supabase（`_live-account-probe.mjs`） | **16/16 PASS** |
| 真实浏览器用户故事（`_account-ui.mjs`，见 §9） | **11/11 PASS** |
| `tools/panel-e2e.mjs` | 25/25 PASS |
| `tools/smoke-test.ps1` 本机 / 公网 | **33/33** / **66/66** PASS |
| 页面审计 1440 亮+暗 / 390 | 8 路由 `scrollW == clientWidth`，无 JS 报错 |
| 构建 | `build.ps1` EXIT 0，`server/public` 10326 KB（含历史 hash 与 `.gz`） |

### 9. `_account-ui.mjs` 验的就是用户那句话

真开一个无头 Edge（真实 IndexedDB + 真实后端）：新访客打开首页 **9 个选题 + 6 份脚本**的演示数据 →
进设置页填用户名密码点「注册并开始使用」→ 拿到 token、界面切「已登录」、**本机演示数据被清空（topics=0）** →
旁路往这个账号上传 1 条云端选题 → 刷新首页**云端数据回显** →
点「退出登录」token 被清掉、**本机数据还在**。截图落在 `D:\wp\_shots\account-*.png`。

### 10. 遗留（不阻塞）

- 所有账号仍睡在同一行 JSON 里（整行覆盖，已串行化）；账号多到几百个、单账号数据到几 MB 时需要真正的多表方案（要 service key）；
- 没有找回密码 / 改密码接口：忘记口令只能重新注册（旧账号数据仍可用 `cloud-admin.ts` 查看）；
- 注册/登录限流是内存计数、按 IP，重启清零；
- `legacy` 的 `uploadedAt` 迁移后是 0（旧行的 JSON 里本来就没有这个字段）；
- `cloud-admin.ts` 偶发 `fetch failed`（冷启动第一次连 Supabase 时；重跑即好）——只影响运维小工具，不影响服务端。

## 十二、设置页布局重做（2026-10-12 深夜，第五轮）

### 1. 起因

用户发来设置页截图（1208×1067，约 1512 CSS px 窗口按 0.8 缩放）：「现在优化一下设置界面的布局，太难看了」。
截图里 6 张卡片按 DOM 顺序摊在两列网格上，读起来是「账号与云端 → AI 配置状态 → 云端同步 ｜ 演示数据 → 账号绑定」，
底部还压着一张满宽的 YouTube 卡——语义是散的，右列还早早见底。

### 2. 先量化，再动手

新增 `D:\wp\_settings-audit.mjs <label> [baseUrl]`（CDP Edge 9357，desktop-1440 / laptop-1208 / mobile-390）：
抓所有含 `h2` 的 `.anim-rise` 卡片的位置尺寸，按 x 分列统计张数、列内空隙、列底，并记录分组标签。

| 视口 | scrollH | 列内空隙 | 列底差 | 分组标签 |
|---|---|---|---|---|
| desktop-1440 改前 | 1302 | 238px | **535px** | 无 |
| laptop-1208 改前 | 1728 | 100px | 单列 | 无 |
| mobile-390 改前 | 2179 | 99px | 单列 | 无 |
| desktop-1440 改后 | 1538 | 174px | **0px** | 账号 / 平台与数据源 / 本机数据与备份 |
| laptop-1208 改后 | 2105 | 157px | 0px | 同上 |
| mobile-390 改后 | 2573 | 156px | 0px | 同上 |

改前 1440 的 535px 是真实存在的洞：左列 x=279 塞了 4 张（账号与云端 ｜ AI 配置状态 ｜ 云端同步 ｜ YouTube Data API），底到 1275；
右列 x=847 只有 2 张（演示数据 ｜ 账号绑定），740 就到头了。

### 3. 改法（`creator-app/src/pages/Settings.tsx`）

- 不再是「一个网格摊 6 张卡」，改成三组，每组一个 `GroupLabel`（`.eyebrow` 小标签 + 一条 `h-px bg-border` 细线）+ 自己的网格：
  - **账号**：满宽「账号与云端」卡。已登录内部两列（左：登录账号 / 云端数据 / 云端更新时间；右：立即同步、退出登录、说明）；未登录内部两列（左：承诺文案 + 三条要点；右：380px 表单）。
  - **平台与数据源**：`xl:grid-cols-2` —— 账号绑定 + 合并后的「AI 与数据源」（DeepSeek 状态行 + 两个配置步骤 + 每日额度提示）。
  - **本机数据与备份**：`xl:grid-cols-2` —— 演示数据 + 云端同步。
- 每张卡 `flex flex-col`、页脚 `mt-auto`：同一行两张卡底边强制对齐（「列底差 0」就是这么来的）。
- 抽出 `StatRow` / `StatList` 两个局部组件，全页信息行样式统一。
- 文案与 handler 一行没改；`/api/status` 没有 YouTube 的开关字段，所以 YouTube 只作为可选链接与步骤保留，**不编造「已配置」状态**。

### 4. 验收

| 项目 | 结果 |
|---|---|
| `tsc -p tsconfig.app.json` | EXIT 0 |
| `oxlint src` | 3 warnings / 0 errors（与改前同为 1e4 声明数告警） |
| `_settings-audit.mjs after` | 列底差 **0px**（三个视口），`scrollW == clientWidth` |
| `_page-audit.mjs` | 8 路由无横向溢出、无 JS 报错（17 条原始报错全是 sync 噪声） |
| `_account-ui.mjs` | **11/11 PASS**（改版后注册/登录流程照旧，测试账号已 prune） |
| `panel-e2e.mjs` / `smoke-test.ps1` | 25/25；本机 33/33、公网 66/66 |
| 部署 | `build.ps1` EXIT 0（`server/public` 11122.4 KB），重启后端重新生成 `.gz`（137 个） |
| 提交 | `8fe43a0`，已推送 `origin/main` |

部署后第一次公网 smoke 出现 1 项失败（65/66），立刻重跑即 66/66——是发布瞬间的抖动，不是回归；
另外 `build.ps1` 不会清理 `server/public/assets` 里的历史 hash 文件（现在 10 个 `index-*.js`），
所以即使 Cloudflare 边缘还缓存着旧 `index.html`，它引用的旧 chunk 仍在磁盘上，不会出现「白屏 404」窗口。

## 十三、AI 配置跟随账号 + 留白收尾（2026-10-12 深夜，第六轮）

### 1. 用户原话（附截图）

> 这一大片留白也太丑了，右侧的ai配置改成跟随账号的形式，一个账号对应一个ai配置，现在的ai配置保存到我的账号上。YouTube的配置保持公开，但是不要显示这个配置方式了，用我网站的人怎么可能用到我的电脑的文件路径来配置。

截图里右列「AI 与数据源」卡有两段「配置步骤」，直接写着 `打开 D:\自媒体之路\server\.env`、`填入 DEEPSEEK_API_KEY=你的key`——**把开发机上的路径和 env 变量名当成给访客的说明**，是这个作品里最出戏的一处；左列「账号绑定」内容只有 ~300px，被 grid 拉到 ~600px，中间一整片空白。

量化留白（`_settings-audit.mjs`，登录态，1440）：改造前「账号绑定」卡高 440px、**卡内空隙 175px**（自然高度只有 265px），`scrollH` 1538。

### 2. 改法

**服务端（一个账号一份 Key，Key 不再只属于服务器）**

| 项 | 实现 |
| --- | --- |
| 存储 | `accounts[userId].ai = { deepseekApiKey, updatedAt }`，与选题/脚本同一份云端数据（`cloudStore.ts` 的 `CloudAccountData` 新增 `ai?`，`normalizeAccount` 必须透传，否则读-改-写会把 Key 抹掉） |
| 加密 | `aiConfigStore.ts`：AES-256-GCM，12 字节随机 IV，存成 `enc.v1.<iv>.<tag>.<ct>`；密钥 = `sha256(AUTH_SECRET 或 server/data/auth-secret.txt 派生 + '|ai-config-v1')` |
| 接口 | 新增 `routes/aiConfig.ts`：`GET /api/ai-config`（只回掩码 `sk-****（前 5 位 + 后 4 位，中间打码）`）、`PUT`（`apiKey:''` = 清除）、`POST test`（真发一次 `deepseek-chat` 请求） |
| 生效优先级 | 账号 Key 优先 → 回落站点公共 Key（`server/.env`），**未登录访客仍能用 AI** |
| 请求级 Key | `aiContext.ts` 用 `AsyncLocalStorage` 传「这次请求该用哪把 Key」，`aiService.ts` 的 `makeClient(apiKey)` 直接取，不用改 8 个导出函数签名 |
| 可选登录 | `middleware/optionalAuth.ts`：`/api/ai/*` 带 token 就认，不带也照常放行（不 401），失败只 `console.warn` |
| 运维 | `cloud-admin.ts set-ai <用户名> --from-env\|--key sk-...`；`stats` 打印每个账号 `ai=本账号已配置 / 无` |

**前端（设置页）**

- 「AI 与数据源」卡 → **「AI 配置」卡**：`hint="一个账号一份 DeepSeek Key，跟着你的账号走"` + 角标（`本账号` / `站点公共配置` / `未配置`）+ 两行状态（`本账号 Key` 掩码、`视频数据源` YouTube 徽标）；登录后是 password 输入框 + 保存到我的账号 / 测试连接 / 清除，未登录是一句「登录后把 Key 存进账号，换设备也跟着走」。
- **两段「配置步骤」整块删除**，全站不再出现 `D:\自媒体之路` 这类本机路径；YouTube 只留状态徽标（配置保持公开，由站点统一维护）。
- 信息行压成 2 行（原来 4 行把卡撑到 440px），页脚说明从两行压成一行 → 卡片自然高度与「账号绑定」对齐，拉伸留白自然消失。
- `client.ts`：`getStatus` 增加 `aiSource`/`youtubeConfigured`，新增 `getAiConfig` / `updateAiConfig` / `testAiConfig`。

### 3. 量化对比（1440，登录态）

| 指标 | 改前（第十二轮结束） | 改后 |
| --- | --- | --- |
| `scrollH` | 1538 | **1145** |
| 「账号绑定」卡高 / 卡内空隙 | 被拉到 ~440 / **175px** | 343 / **78px**（与同列其它卡的 54px 同量级） |
| 「AI 配置」卡高 | —（旧「AI 与数据源」更高） | 343（自然高度，`内空` 42px） |
| 列底差（1440 / 1208 / 390） | 0 / 0 / 0 | 0 / 0 / 0 |
| 1208 与 390 | 单列 5 张 | 单列 5 张，`scrollH` 1712 / 2207 |

### 4. 验收

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit -p tsconfig.app.json` / server `tsc --noEmit` | EXIT 0 / EXIT 0 |
| `oxlint src` | 3 warnings / 0 errors（39 files，与改前一致） |
| `_ai-config-probe.mjs`（线上 3001） | dummy **12/12**、real **4/4**（匿名 401、只回掩码、假 Key → `aiUsed:false`、真 Key → `aiUsed:true`、清空回落 `aiSource:'server'`） |
| `_ai-config-ui.mjs`（界面验收，本机 + 公网） | **16/16** / **16/16**（登录态下写入假 Key → 显示掩码 → **刷新后掩码从服务端重新读出** → 清除 → 回落站点公共配置；并断言页面里没有 `YOUTUBE_API_KEY`、`server\.env`、`D:\自媒体之路` 这些开发机痕迹） |
| `panel-e2e.mjs` | 25/25 PASS |
| `_account-ui.mjs` | 11/11 PASS（测试账号已 prune） |
| `smoke-test.ps1` | 本机 **33/33**、公网 **66/66** |
| 云端数据 | 账号数 1（`<我注册的账号>`，topics=2 scripts=2 `ai=本账号已配置`），legacy 已清空 |
| 部署 | `build.ps1` EXIT 0（`server/public` 11945.5 KB），重启后端重新生成 `.gz` |

### 5. 两个已修的坑（记下来省得再踩）

1. **`POST` 没有 body 不等于参数非法**：`req.body` 是空对象时，早期实现把「字段缺失」当成「格式不合法」回了 400 `BAD_KEY`；改成三态（缺失 / 显式清空 / 非法）后语义才对。
2. **进程内缓存遇上「另一个进程写库」**：`cloud-admin set-ai` 是独立进程，运行中的后端加了 60 秒缓存就看不到新 Key（实测 set-ai 后立刻测仍 `NO_KEY`）。最后**删掉缓存**：`requireAuth`/`optionalAuth` 本来就已经读过那一行云端数据，直接用它手上的 `cloudAccount` 解密，既没窗口也少一次 Supabase 往返。
3. **验收集自己会把状态改掉，别拿它当只读**：界面探针要「写入假 Key → 清除」，跑完账号就没有自己的 Key 了。第一版探针假设「账号里已经存了 Key」，于是**第二轮跑（换一个域名）必然误报**，看起来像公网 UI 坏了，其实是探针自己留的状态。现在探针改成自给自足：自己写入假 Key，**刷新后**断言掩码是服务端读回来的（顺带把 `GET /api/ai-config` 的加载路径也验了），再清除；跑完用 `set-ai --from-env` 还原。
4. **别让「未设置」先闪一下**：`GET /api/ai-config` 是异步的，早期实现在返回前就渲染「未设置」，有 Key 的用户会看到一瞬间「未设置」（探针也把它当成失败）。现在加 `aiLoaded` 状态，加载中显示「读取中…」，并顺手去掉了设置页里重复的一次 `/api/ai/status` 调用。

### 6. 留待用户决定

站点公共 Key（`server/.env` 的 `DEEPSEEK_API_KEY`）目前**保留**为匿名兜底：不登录也能用 AI，但成本算在站点头上。要「只有自己的账号能用 AI」，只需删掉 `server/.env` 里的这一行并重启（AI 相关接口会返回 `AI 未配置：请到「设置 → AI 配置」填写你自己的 DeepSeek API Key`）。

---

## 十四、资讯 / 报告「一小时才回源一次」（2026-10-13 凌晨，第七轮）

### 1. 用户原话

> 分析报告和资讯中心改成每小时获取一次，不要每次打开都获取导致对应的界面打开速度很慢。

### 2. 先测再改：慢的不是服务端

| 测量（node fetch 直连本机 3001） | 结果 |
| --- | --- |
| `GET /api/news?limit=500` | 首次 63ms / 再次 23ms，**364,119 B（gzip）**、500 条 |
| `GET /api/report/game-industry` | 17ms / 15ms，32,375 B（gzip） |
| 同一报告走公网域名（早前测） | 中位 **853ms** |

服务端算完只要十几毫秒，慢的是**公网隧道 + 每次打开都重传 364KB**。所以修法落在客户端：一小时 TTL 的本地缓存，进页面先用缓存渲染，只有过期或点「刷新」才回源。

### 3. 改法

| 项 | 实现 |
| --- | --- |
| 缓存层 | 新增 `creator-app/src/services/queryCache.ts`：`CACHE_TTL_MS = 60*60*1000`；独立 IndexedDB 库 `CreatorStudioCache`（**不碰存选题/脚本的 `CreatorStudio` 库**，避免为缓存改用户数据库版本、也避免多页签撞 Dexie 升级阻塞）；模块级 `Map` 作会话内热副本，`readCache` 先内存再 IDB |
| 统一入口 | `loadWithCache(key, loader, { force, ttlMs })` → `{ data, fetchedAt, fromCache, stale, error }`：未过期且非 force **不发请求**；回源成功写缓存；**回源失败但有旧缓存时回旧缓存并把错误带出来**（网络抖动时页面不会变空） |
| 缓存键 | 资讯 `` `news:${filter}:${sourceFilter}:500` ``（按筛选维度分开缓存）；报告 `'report:game-industry:default'` |
| 资讯页 | `loadNews(force)`；PageHeader 加「刷新」按钮；提示行 `缓存 · 几分钟前` / `刚刚更新`；切换品类只拉该品类的数据、切回「全部」命中缓存；手动采集/重译后 `clearCache('news:')` + 强制回源；加载态收紧为 `loading && news.length === 0`（刷新时不再清空列表） |
| 报告页 | `load(force)`；两个「刷新」按钮都强制回源；描述行显示 `· 本机缓存于 HH:MM:SS（每小时自动回源）`；整页「报告生成中」只在**没有已渲染报告**时出现（刷新时保留旧报告） |
| 反缓存打架 | 两个接口都显式 `Cache-Control: no-store`：否则点「刷新」可能拿到浏览器 HTTP 缓存里的旧 JSON，本地 TTL 就管不住了 |
| 没做服务端 memo | `buildGameIndustryReport` 本机只要 17ms，加缓存 + 失效钩子不划算（**不为 17ms 引入一致性风险**） |

### 4. 实测（同一浏览器档案，无头 Edge + CDP）

| 页面 | 冷打开（首次，无缓存） | 暖打开（一小时内再打开） |
| --- | --- | --- |
| 公网 `/report` | 3323ms，**接口 1 次** | **1236ms，接口 0 次** |
| 公网 `/info` | 2528ms，**接口 1 次** | **962ms，接口 0 次** |
| 本机 `/report` | 557ms，接口 1 次 | 370ms，接口 0 次 |
| 本机 `/info` | 465ms，接口 1 次 | 363ms，接口 0 次 |

公网复测一次（同方法）：`/report` 3459 → 962ms、`/info` 1883 → 935ms，均为「暖打开接口 0 次」。暖打开的 ~0.9–1.2s 是 SPA 启动 + 渲染的固定开销（不再有网络等待），冷打开的公网波动主要来自隧道与 364KB 资讯载荷。

### 5. 验收

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit`（前端 / 服务端） | EXIT 0 / EXIT 0 |
| `oxlint src` | 3 warnings / 0 errors（40 files） |
| `tools/hourly-cache.mjs`（新探针，18 项） | 本机 **18/18**、公网 **18/18**（首次各 1 次请求 → 整页刷新 0 次且内容照常 → 点「刷新」1 次 → 把缓存改旧到 2 小时前自动回源 1 次 → 切品类 1 次、切回命中 0 次 → 两端点均 `no-store`） |
| `tools/panel-e2e.mjs` | 25/25 PASS |
| `tools/smoke-test.ps1` | 本机 **33/33**、公网 **66/66** |
| `_page-audit.mjs` | 8 路由 × 亮/暗无横向溢出（仅首页装饰光斑那处坐标超出，非布局问题）、无真实 JS 报错 |
| `build.ps1` + 重启后端 | EXIT 0（`server/public` 14204.9 KB），公网 `index.html` 指向新入口 `index--BixeaF6.js`（本地即线上） |

### 6. 三个踩过的坑

1. **探针的就绪标志必须是「数据到位才有」的文案**：资讯页初始状态就是 `刚刚更新 · 0 条`，拿它当就绪标志会在 React 挂载完成时就返回，于是「冷打开」测的是首屏而不是取数，请求计数还会错位到下一段（一度得出「暖打开反而请求 1 次」的假结论）。改成「非 0 条」正则后，冷/暖分别是 1 次 / 0 次。
2. **`Page.reload` 立刻返回**：`await send('Page.reload')` 之后立刻在新文档上断言，会读到旧 DOM 而**假通过**。改成用 `Page.loadEventFired` 计数确认新文档加载完成。
3. **点「刷新」是 fire-and-forget，`writeCache` 的 IDB 事务还没提交**：马上做「改旧到 2 小时前」会被随后提交的写入覆盖，于是「TTL 过期应回源」假失败（报「实际 0」）。现在改旧前 `sleep(1500)`，并且**回读断言 `touched>=1 && minAge>=60`**，让「改旧」这一步自己也被验证。

### 7. 与用户说明的分寸

页面现在最多每小时回源一次，但**服务端采集仍是 6 小时一轮**（`COLLECT_INTERVAL` 默认 `0 */6 * * *`；基准线缓存同样是 6 小时）。改成一小时采集会让 YouTube 配额爆掉：一次 `search.list` = 100 单位、一轮最多 20 个关键词 ≈ 2000 单位，每日默认配额 10,000 单位（≈5 轮），6 小时一轮（每天 4 轮）已经贴着上限。要真正「数据每小时更新」，得先把每轮关键词数降下来（例如 3 个/轮）或申请配额，这属于要用户拍板的取舍。



---

## 十五、采集改成两条腿：RSS + B站每小时，YouTube 仍 6 小时（2026-10-13）

### 1. 用户的原话

> 分析报告和资讯中心改成每小时获取一次，不要每次打开都获取导致对应的界面打开速度很慢。

第十四节解决的是「每次打开都重传」，这一节解决「数据本身多久更新一次」。用户拍板选了推荐方案：

> **RSS + B站每小时，YouTube 保持 6 小时**

### 2. 为什么不能全源每小时

YouTube Data API 的 `search.list` 一次调用就要 **100 单位**配额，而服务端一轮采集最多打 20 个关键词（`MAX_QUERIES`）≈ **2000 单位**；默认每日配额只有 **10,000 单位**（≈5 轮）。每小时一轮 = 每天 24 轮 = 24,000 单位，会直接把配额打爆，日志里会出现大量 429、YouTube 来源直接断供。

而 RSS 与 B站搜索是免费接口，没有配额概念——所以把采集拆成两条腿：

| 轮次 | 来源 | 频率 | cron | 说明 |
| --- | --- | --- | --- | --- |
| 轻量轮 | RSS + B站 | 每小时 | `LIGHT_COLLECT_INTERVAL`（默认 `5 * * * *`） | 不吃配额，负责「每小时有新资讯」 |
| 完整轮 | RSS + YouTube + B站 | 6 小时 | `COLLECT_INTERVAL`（默认 `0 */6 * * *`） | 唯一会消耗 YouTube 配额的路径 |

### 3. 改了什么

- `server/src/services/scheduler.ts`：`collectAll(options?: { includeYouTube?: boolean })`——**默认仍包含 YouTube**（手动「立即采集」走的就是这条），定时任务里的轻量轮传 `false`；来源列表由数组拼装，结果按名字归类，不再写死三个 `allSettled` 解构。
- 新增 `collectLight()`：只跑 RSS + B站；**若上一轮采集在 30 分钟内跑过就跳过**（避免和刚跑完的完整轮贴在一起重复采集）。`LIGHT_SKIP_MS = 30 * 60 * 1000`。
- `server/src/config.ts`：新增 `lightCollectInterval: process.env.LIGHT_COLLECT_INTERVAL || '5 * * * *'`；给 `collectInterval` 补了「含 YouTube、一轮 ≈2000 单位配额」的注释。
- `server/src/index.ts`：启动时那次预采集从 `collectAll()` 改成 `collectLight()`——重启不再burning YouTube 配额，新鲜资讯仍会立刻补上。
- `server/src/routes/news.ts` 的 `POST /collect`（手动「立即采集」）**保持完整轮**不变。
- `server/.env.example`：模板里原来写着 `COLLECT_INTERVAL=0 */2 * * *`（每天 12 轮，本身就超配额），改为 `0 */6 * * *` 并加注释；新增 `LIGHT_COLLECT_INTERVAL=5 * * * *`。

### 4. ⚠️ 顺手修的线上配置事故

重启后端时日志打印出 `[Scheduler] Full collection (RSS + YouTube + Bilibili) scheduled: 0 */2 * * *`——**线上 `server/.env` 一直是每 2 小时一轮**（每天 12 轮 ≈ 24,000 单位，早就超了 YouTube 配额），模板里的超配额示例被原样抄进了线上。已把线上 `.env` 改为 `0 */6 * * *` 并补上 `LIGHT_COLLECT_INTERVAL=5 * * * *`。

（同一轮操作里踩到的坑：PowerShell 5.1 用 `Get-Content -Raw` 读 UTF-8 的 `.env` 会按 GBK 解码，中文注释变乱码、而且某些行尾的换行会被当成 GBK 尾字节吃掉导致行合并——**改 `.env` 必须用 `-Encoding UTF8` 读、用 `[System.IO.File]::WriteAllBytes` 配 `UTF8Encoding($false)` 写**。这次已据此重建 `.env`：6 个变量的值长度逐一核对未变（35/39/21/40/208），注释恢复成正常中文。）

### 5. 验收

| 项目 | 结果 |
| --- | --- |
| `tsc --noEmit`（服务端） | EXIT 0 |
| 轻量轮实测（`_collect-light-test.ts`，临时脚本已删） | `collectAll({includeYouTube:false})` → `sources={"rss":160,"bilibili":157}`（**无 youtube 键**）、新增 3 条、54s；紧接着 `collectLight()` → 跳过且不改写 `lastCollected` → `LIGHT_COLLECT_OK` |
| 重启后端日志 | `Full collection ... scheduled: 0 */6 * * *` + `Light collection (RSS + Bilibili) scheduled: 5 * * * *` + 启动轻量轮「skipped (a round just ran)」 |
| 配置生效旁证 | `/api/ai/status` → `aiConfigured:true, aiSource:"server", youtubeConfigured:true`（说明重建后的 `.env` 里 DeepSeek / YouTube / 代理都读到了） |

### 6. 仍然存在的边界

- 基准线与报告样本池依旧是 6 小时一采（`benchmarkService.ts` 的 `CACHE_TTL_MS`），这一节没动它——报告页的「一小时缓存」只保证不重复请求，不保证报告数据每小时变。
- 「每小时」是 cron 的第 5 分钟（`5 * * * *`），不是「距上次打开一小时」；页面侧仍是一小时 TTL。
- 完整轮重启后不再自动跑（改由 cron 或手动触发），所以部署后 YouTube 来源的首次更新要等到下一个 6 小时整点或手动点「立即采集」。