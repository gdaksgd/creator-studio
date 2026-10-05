// ============================================================
//  分析报告路由（M3）
//
//    GET /api/report/game-industry?days=30      → 报告 JSON（前端页面渲染用）
//    GET /api/report/game-industry.md?days=30   → 报告 Markdown（导出件）
//
//  两个端点共用同一个 buildGameIndustryReport()，所以导出的 Markdown
//  和页面上看到的内容是同一份数据、同一套出处标注，不会出现
//  「页面有出处、导出没有」这种漂移。
//
//  Markdown 放在后端而不是前端拼字符串，是为了让「导出物」可被测试直接断言
//  （tools/smoke-test.ps1 会对 .md 端点直接取文本检查样本量与出处）。
// ============================================================

import { Router } from 'express';
import { buildGameIndustryReport, renderReportMarkdown } from '../services/reportService.js';
import { isCollecting } from '../services/benchmarkService.js';
import { SEARCH_WINDOW_DAYS } from '../services/collectors/bilibiliBenchmarkCollector.js';

const router = Router();

/** 数据只按这一个窗口采集，所以只支持这一个值 */
const SUPPORTED_DAYS = [SEARCH_WINDOW_DAYS];

function parseDays(raw: unknown): { days?: number; error?: string } {
  if (raw === undefined || raw === '') return { days: SEARCH_WINDOW_DAYS };
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    return { error: `days 必须是整数（当前只支持 ${SUPPORTED_DAYS.join('/')}）` };
  }
  if (!SUPPORTED_DAYS.includes(n)) {
    return {
      error: `数据只按近 ${SEARCH_WINDOW_DAYS} 天采集，因此只支持 days=${SEARCH_WINDOW_DAYS}（收到 ${n}）。不做「参数写别的、实际按 30 天算」的假报告。`,
    };
  }
  return { days: n };
}

router.get('/game-industry', (req, res) => {
  const { days, error } = parseDays(req.query.days);
  if (error || days === undefined) {
    res.status(400).json({ ok: false, error, code: 'BAD_INPUT' });
    return;
  }
  try {
    const report = buildGameIndustryReport(days);
    if (!report.ready) {
      // 业务上「还没数据」不是服务器错误，但也不该让前端把空报告当正常报告渲染
      res.status(503).json({
        ok: false,
        code: 'NOT_READY',
        error: report.error,
        collecting: isCollecting(),
      });
      return;
    }
    res.json({ ok: true, report });
  } catch (e) {
    console.error('[report] 生成失败：', e);
    res.status(500).json({ ok: false, error: '报告生成失败，请查看服务端日志', code: 'INTERNAL' });
  }
});

router.get('/game-industry.md', (req, res) => {
  const { days, error } = parseDays(req.query.days);
  if (error || days === undefined) {
    res.status(400).json({ ok: false, error, code: 'BAD_INPUT' });
    return;
  }
  try {
    const report = buildGameIndustryReport(days);
    if (!report.ready) {
      res.status(503).json({
        ok: false,
        code: 'NOT_READY',
        error: report.error,
        collecting: isCollecting(),
      });
      return;
    }
    const md = renderReportMarkdown(report);
    const filename = `B站游戏区内容分析报告-近${days}天.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bilibili-game-report-${days}d.md"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(md);
  } catch (e) {
    console.error('[report] Markdown 导出失败：', e);
    res.status(500).json({ ok: false, error: 'Markdown 导出失败，请查看服务端日志', code: 'INTERNAL' });
  }
});

export default router;
