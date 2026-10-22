# 示例交接包

`creator-studio-sample-publish.zip` 是 Creator Studio 成片任务 v1 的示例发布包。

- 来源：演示任务「首发 6 小时，我把《丝之歌》打到了第一个 Boss」
- 状态：**READY · 发布交接包**
- 数据性质：**演示任务 · 非实绩**
- 生成方式：完成素材确认、版权确认、发布前检查和人工复核后导出
- 复现：`KEEP_SAMPLE=1 node tools/runs-e2e.mjs`

包内文件：

```
README.md          任务摘要、检查汇总、素材汇总、复核记录
manifest.json      完整 run 快照、流水线版本、检查与素材
script.md          标题、钩子、分镜表
shotlist.csv       镜号、时长、画面、台词、画面方向、素材状态
assets.csv         素材槽位清单
publish.md         平台、标题、封面文案、平台规则与人工清单
checks.json        完整检查结果与证据出处
source-topic.json  选题快照与评估依据
```

说明：v1 是制作交接包，不包含成片、配音和字幕；包内平台规则与样本依据仅用于展示工作流，不构成平台官方 KPI 承诺。
