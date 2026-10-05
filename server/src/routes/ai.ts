import { Router } from 'express';
import { isAIConfigured } from '../config.js';
import { db } from '../db.js';
import { evaluateTopic, suggestScript, generateScriptDraft, evaluateProductionIdea, evaluateScriptTitle, analyzeMaterialNeeds, translateTitles, polishCoverCopy } from '../services/aiService.js';
import type { CoverPolishResult } from '../services/aiService.js';
import { checkPlatform, normalizePlatform } from '../services/platformRules.js';
import { syncAccount } from '../services/accountSyncService.js';
import { DEFAULT_CATEGORY } from '../config/categories.js';

const router = Router();

// 选题评估
router.post('/evaluate-topic', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const { topicTitle, category, notes, gameDescription } = req.body;
    if (!topicTitle) {
      return res.status(400).json({ error: '缺少选题标题' });
    }

    const result = await evaluateTopic(topicTitle, category || DEFAULT_CATEGORY, notes || '', gameDescription);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Topic evaluation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 制作思路评估
router.post('/evaluate-idea', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const { topicTitle, category, productionIdea, gameDescription } = req.body;
    if (!topicTitle) {
      return res.status(400).json({ error: '缺少选题标题' });
    }
    if (!productionIdea || !productionIdea.trim()) {
      return res.status(400).json({ error: '请先填写制作思路' });
    }

    const result = await evaluateProductionIdea(topicTitle, category || DEFAULT_CATEGORY, productionIdea, gameDescription);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Idea evaluation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 视频标题评估（品类由 category 决定，缺省用 DEFAULT_CATEGORY）
router.post('/evaluate-title', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const { gameTitle, gameDescription, scriptTitle, category } = req.body;
    if (!gameTitle) {
      return res.status(400).json({ error: '缺少游戏标题' });
    }
    if (!scriptTitle || !scriptTitle.trim()) {
      return res.status(400).json({ error: '请先输入视频标题' });
    }

    const result = await evaluateScriptTitle(gameTitle, gameDescription || '', scriptTitle, category || DEFAULT_CATEGORY);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Title evaluation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 脚本建议
router.post('/script-suggest', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const { topicTitle, category, platform, version, scriptTitle, hook, storyboards } = req.body;
    const result = await suggestScript(
      topicTitle || '', category || DEFAULT_CATEGORY, platform || '', version || '',
      scriptTitle || '', hook || '', storyboards || []
    );
    // M4：同一份脚本，平台不同 → 时长结论不同（规则引擎不调 AI，随建议一起返回）
    const durationSec = Array.isArray(storyboards)
      ? storyboards.reduce((sum: number, b: any) => sum + (Number(b && b.duration) || 0), 0)
      : 0;
    res.json({
      ...result,
      platformCheck: checkPlatform({
        platform: platform || 'bilibili',
        title: scriptTitle || '',
        durationSec: durationSec > 0 ? durationSec : undefined,
      }),
    });
  } catch (err: any) {
    console.error('[AI] Script suggestion error:', err);
    res.status(500).json({ error: err.message });
  }
});

// M4 · 封面 + 平台适配检查
// 纯规则引擎：没有 DEEPSEEK_API_KEY 也能给出全部结论；AI 仅在 useAI=true 时用于润色文案。
router.post('/evaluate-cover', async (req, res) => {
  try {
    const body = req.body || {};
    const rawPlatform = body.platform;
    if (
      rawPlatform !== undefined && rawPlatform !== null &&
      String(rawPlatform).trim() !== '' && !normalizePlatform(rawPlatform)
    ) {
      return res.status(400).json({ ok: false, code: 'BAD_INPUT', error: 'platform 只支持 bilibili 或 douyin' });
    }

    const check = checkPlatform({
      platform: rawPlatform || 'bilibili',
      title: body.title,
      coverText: body.coverText,
      durationSec: body.durationSec,
      ctr: body.ctr,
      completionRate: body.completionRate,
      postsPerWeek: body.postsPerWeek,
    });

    let aiUsed = false;
    let ai: CoverPolishResult | undefined;
    let aiError: string | undefined;

    if (body.useAI === true) {
      if (!isAIConfigured()) {
        aiError = 'AI 未配置：本次只返回规则结论（在 server/.env 设置 DEEPSEEK_API_KEY 可启用文案润色）';
      } else {
        try {
          ai = await polishCoverCopy({
            platform: check.platform,
            title: body.title || '',
            coverText: body.coverText || '',
            durationAdvice: check.durationAdvice.detail,
            ruleFindings: check.rules
              .filter((r) => r.status === 'fail' || r.status === 'warn')
              .map((r) => `[${r.label}] ${r.detail}`),
          });
          aiUsed = true;
        } catch (err: any) {
          console.error('[AI] Cover polish error:', err);
          aiError = `AI 润色失败：${err.message}（规则结论不受影响）`;
        }
      }
    }

    res.json({ ok: true, check, aiUsed, ai, aiError });
  } catch (err: any) {
    console.error('[AI] Cover check error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// AI 生成脚本框架
router.post('/generate-script', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const { topicTitle, category, platform, version, productionIdea, gameDescription } = req.body;
    if (!topicTitle) {
      return res.status(400).json({ error: '缺少选题标题' });
    }

    const result = await generateScriptDraft(topicTitle, category || DEFAULT_CATEGORY, platform, version, productionIdea, gameDescription);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Script generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取/更新账号信息
router.get('/account', (req, res) => {
  res.json(db.getAccountInfo());
});

router.post('/account', (req, res) => {
  const updated = db.updateAccountInfo(req.body);
  res.json(updated);
});

// 手动触发账号数据同步
router.post('/account/sync', async (req, res) => {
  try {
    const result = await syncAccount();
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Account sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取同步历史
router.get('/account/history', (req, res) => {
  res.json(db.getSyncHistory());
});

// 素材工坊 - AI 分析素材需求
router.post('/materials/analyze', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const { topicTitle, category, productionIdea, gameDescription, scriptTitle, hook, storyboards } = req.body;
    if (!topicTitle) {
      return res.status(400).json({ error: '缺少选题标题' });
    }
    if (!storyboards || !Array.isArray(storyboards) || storyboards.length === 0) {
      return res.status(400).json({ error: '脚本没有分镜，无法分析素材需求' });
    }

    const result = await analyzeMaterialNeeds(
      topicTitle, category || DEFAULT_CATEGORY, productionIdea || '', gameDescription || '',
      scriptTitle || '', hook || '', storyboards
    );
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Material analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 检查 AI 配置状态
router.get('/status', (req, res) => {
  res.json({
    aiConfigured: isAIConfigured(),
    accountInfo: db.getAccountInfo(),
  });
});

// 重新翻译全部新闻标题（清掉旧翻译，重新生成）
router.post('/retranslate', async (req, res) => {
  try {
    if (!isAIConfigured()) {
      return res.status(400).json({ error: 'AI 未配置，请在 server/.env 中设置 DEEPSEEK_API_KEY' });
    }

    const news = db.getNews();
    if (news.length === 0) {
      return res.json({ translated: 0, total: 0 });
    }

    // 清空旧翻译，全部重新翻译
    db.clearTranslations();
    const translations = await translateTitles(
      news.map((item) => ({ id: item.id, title: item.title })),
    );
    if (translations.size > 0) {
      db.updateTranslations(translations);
    }
    res.json({ translated: translations.size, total: news.length });
  } catch (err: any) {
    console.error('[AI] Retranslate error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
