import type { ContentExperiment, GameMarketingBrief } from '../types';

// 备份/云端数据可能来自旧版本，这些数组字段一律按空数组兜底，避免导出直接抛错
const escapeCell = (value: string | undefined) => (value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export function marketingBriefMarkdown(brief: GameMarketingBrief, linkedExperiment?: ContentExperiment, linkedSampleCount = 0): string {
  const phases = { teaser: '预热期', launch: '上线期', sustain: '长尾期' };
  const status = { planned: '计划中', 'in-progress': '进行中', published: '已发布', reviewed: '已复盘' };
  const lines = [
    `# ${brief.title || `${brief.gameTitle} ${brief.versionName} 营销简报`}`,
    '',
    `> 数据模式：${brief.dataMode === 'real' ? '真实项目背景（不代表结果已验证）' : brief.dataMode === 'demo' ? '演示案例，非实际效果' : '策划方案，尚未验证'} · 导出于 ${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 项目目标与受众',
    `- 游戏 / 版本：${brief.gameTitle || '未填写'} / ${brief.versionName || '未填写'}`,
    `- 营销目标：${brief.objective || '未填写'}`,
    `- 目标受众：${brief.targetAudience || '未填写'}`,
    `- 受众洞察：${brief.audienceInsight || '未填写'}`,
    `- 成功定义：${brief.successDefinition || '未填写'}`,
    '',
    '## 核心卖点与依据',
    ...((brief.keySellingPoints ?? []).length ? brief.keySellingPoints.map((point, index) => `${index + 1}. ${point}`) : ['- 尚未填写卖点']),
    '',
    `证据 / 来源备注：${brief.evidenceNotes || '未填写；卖点尚未附外部证据'}`,
    `预算与资源限制：${brief.budgetNote || '未填写'}`,
    '',
    '## 关联内容实验',
    ...(brief.linkedExperimentId ? [
      `- 实验：${linkedExperiment?.title ?? '关联实验记录当前不可用'}`,
      `- 当前符合口径的已发布样本：${linkedSampleCount} 条${linkedExperiment?.evidenceMode === 'demo' ? '（演示样本）' : linkedExperiment ? '（真实发布记录）' : ''}`,
      '- 样本数仅作记录概况；不据此自动推导实验成功、因果关系或营销效果。',
    ] : ['- 未关联内容实验']),
    '',
    '## 传播计划',
    '| 阶段 | 日期 | 渠道 | 内容角度 | 目标指标 | 目标值 | 状态 |',
    '|---|---|---|---|---|---:|---|',
    ...((brief.plan ?? []).length ? brief.plan.map((item) => `| ${phases[item.phase]} | ${item.publishAt ? new Date(item.publishAt).toLocaleDateString('zh-CN') : '未定'} | ${escapeCell(item.channel || '未定')} | ${escapeCell(item.contentAngle || '未填写')} | ${escapeCell(item.targetMetric || '未填写')} | ${item.targetValue ?? '未设目标'} | ${status[item.status]} |`) : ['| 尚未安排 | — | — | — | — | — | — |']),
    '',
    '## 复盘记录',
    brief.retrospective || '尚未复盘。发布后补充实际结果、偏差及下一步行动。',
    '',
    '## 口径与限制',
    '- 目标值是策划目标，不是预测结果或已达成结果。',
    '- “真实项目背景”仅描述案例来源，不表示计划已执行、结果已验证或目标已达成。',
    '- 目标值是计划口径，不能作为实际营销成效证明。',
  ];
  return `${lines.join('\n')}\n`;
}

export function downloadMarketingBrief(brief: GameMarketingBrief, linkedExperiment?: ContentExperiment, linkedSampleCount = 0): void {
  const markdown = marketingBriefMarkdown(brief, linkedExperiment, linkedSampleCount);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `${(brief.title || `${brief.gameTitle}-${brief.versionName}-营销简报`).replace(/[\\/:*?"<>|]/g, '_')}.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
