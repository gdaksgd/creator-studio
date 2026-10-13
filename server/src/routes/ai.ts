import { Router } from 'express';
import { config, isYouTubeConfigured } from '../config.js';
import { db, defaultAccountInfo, getLegacySharedAccountAnalytics } from '../db.js';
import { evaluateTopic, suggestScript, generateScriptDraft, evaluateProductionIdea, evaluateScriptTitle, analyzeMaterialNeeds, translateTitles, polishCoverCopy } from '../services/aiService.js';
import type { CoverPolishResult } from '../services/aiService.js';
import { checkPlatform, normalizePlatform } from '../services/platformRules.js';
import { syncAccount } from '../services/accountSyncService.js';
import { DEFAULT_CATEGORY } from '../config/categories.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import type { AuthedRequest } from '../middleware/requireAuth.js';
import { decodeAccountKey } from '../services/aiConfigStore.js';
import { AI_NOT_CONFIGURED_MESSAGE, hasAiKey, runWithAiKey } from '../services/aiContext.js';
import { claimLegacyAnalyticsForUser, getUserAccountInfo, getUserSyncHistory, getUserSyncStatus, hasUserAccountAnalytics, isLegacyClaimOwner, legacyAnalyticsHasData, sanitizeAccountInfoPatch, updateUserAccountInfo } from '../services/userAnalyticsStore.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getLegacyAccountAnalyticsClaimStatus } from '../services/cloudStore.js';

const router = Router();

/** 本次请求实际用的是谁的 Key（只有这里知道，/status 会回给前端） */
interface AiRequest extends AuthedRequest {
  aiKeySource?: 'account' | 'server' | 'none';
}

// 每个 AI 请求先「可选登录」，再把该请求要用的 DeepSeek Key 绑进请求作用域：
//   已登录且账号里存了 Key → 用账号自己的；否则 → 用 server/.env 的站点公共 Key。
// 之后 aiService 里任何一层调用 getClient() 拿到的都是这个 Key。
router.use(optionalAuth);
router.use((req, _res, next) => {
  const authed = req as AiRequest;
  // optionalAuth 刚刚读过云端、账号记录就在手上，直接解密即可：
  // 既省一次 Supabase 往返，也不会因为读取缓存而看不到刚写进去的 Key。
  let accountKey = '';
  if (authed.authUser) {
    try {
      accountKey = decodeAccountKey(authed.cloudAccount);
    } catch (err) {
      console.warn('[AI] 读取账号 AI Key 失败，退回站点公共 Key:', err instanceof Error ? err.message : err);
    }
  }
  const effective = accountKey || config.deepseekApiKey;
  authed.aiKeySource = accountKey ? 'account' : config.deepseekApiKey ? 'server' : 'none';
  runWithAiKey(effective, next);
});

// 选题评估
router.post('/evaluate-topic', async (req, res) => {
  try {
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
    }

    const { topicTitle, category, notes, gameDescription } = req.body;
    if (!topicTitle) {
      return res.status(400).json({ error: '缺少选题标题' });
    }

    const userId = (req as AiRequest).authUser?.id;
    const result = await evaluateTopic(topicTitle, category || DEFAULT_CATEGORY, notes || '', gameDescription, userId);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Topic evaluation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 制作思路评估
router.post('/evaluate-idea', async (req, res) => {
  try {
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
    }

    const { topicTitle, category, productionIdea, gameDescription } = req.body;
    if (!topicTitle) {
      return res.status(400).json({ error: '缺少选题标题' });
    }
    if (!productionIdea || !productionIdea.trim()) {
      return res.status(400).json({ error: '请先填写制作思路' });
    }

    const userId = (req as AiRequest).authUser?.id;
    const result = await evaluateProductionIdea(topicTitle, category || DEFAULT_CATEGORY, productionIdea, gameDescription, userId);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Idea evaluation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 视频标题评估（品类由 category 决定，缺省用 DEFAULT_CATEGORY）
router.post('/evaluate-title', async (req, res) => {
  try {
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
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
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
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
// 纯规则引擎：没有配置 AI Key 也能给出全部结论；AI 仅在 useAI=true 时用于润色文案。
// 配置位置：设置页 → AI 配置（账号级）或服务端 .env 的公共 Key。
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
    });

    let aiUsed = false;
    let ai: CoverPolishResult | undefined;
    let aiError: string | undefined;

    if (body.useAI === true) {
      if (!hasAiKey()) {
        aiError = 'AI 未配置：本次只返回规则结论（在「设置 → AI 配置」填写自己的 DeepSeek Key 可启用文案润色）';
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
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
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
router.get('/account', async (req, res) => {
  const userId = (req as AiRequest).authUser?.id;
  if (!userId) return res.json(defaultAccountInfo());
  try {
    res.json(await getUserAccountInfo(userId));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' });
  }
});

router.post('/account', async (req, res) => {
  const userId = (req as AiRequest).authUser?.id;
  if (!userId) return res.status(401).json({ error: '账号统计需登录后保存', code: 'UNAUTHORIZED' });
  try {
    res.json(await updateUserAccountInfo(userId, sanitizeAccountInfoPatch(req.body)));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' });
  }
});

// 手动触发账号数据同步
router.post('/account/sync', async (req, res) => {
  try {
    const userId = (req as AiRequest).authUser?.id;
    if (!userId) return res.status(401).json({ error: '账号统计需登录后同步', code: 'UNAUTHORIZED' });
    const result = await syncAccount(userId);
    res.json(result);
  } catch (err: any) {
    console.error('[AI] Account sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取同步历史
router.get('/account/history', async (req, res) => {
  const userId = (req as AiRequest).authUser?.id;
  if (!userId) return res.json([]);
  try {
    res.json(await getUserSyncHistory(userId));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' });
  }
});

router.get('/account/sync-status', async (req, res) => {
  const userId = (req as AiRequest).authUser?.id;
  if (!userId) return res.json({ configured: false, updatedAt: 0 });
  try { res.json(await getUserSyncStatus(userId)); }
  catch (err) { res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' }); }
});

router.get('/account/legacy-claim-status', requireAuth, async (req, res) => {
  try {
    const userId = (req as AiRequest).authUser?.id;
    // 旧共享统计含站点主的 B 站 UID/粉丝数，而注册是开放的：只有最早注册的账号
    // 能看到「可认领」，其它账号连数量也不返回。
    if (!userId || !(await isLegacyClaimOwner(userId))) {
      res.json({ available: false, syncHistoryCount: 0 });
      return;
    }
    const claim = await getLegacyAccountAnalyticsClaimStatus();
    const legacy = getLegacySharedAccountAnalytics();
    const available = claim.available && legacyAnalyticsHasData() && !(await hasUserAccountAnalytics(userId));
    res.json({ available, syncHistoryCount: available ? legacy.syncHistory.length : 0 });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' });
  }
});

router.post('/account/claim-legacy', requireAuth, async (req, res) => {
  try {
    const userId = (req as AiRequest).authUser?.id;
    if (!userId) return res.status(401).json({ error: '未登录', code: 'UNAUTHORIZED' });
    if (!(await isLegacyClaimOwner(userId))) {
      return res.status(403).json({ error: '只有最早注册的账号可以认领历史共享数据', code: 'FORBIDDEN' });
    }
    if (await hasUserAccountAnalytics(userId)) return res.status(409).json({ error: '当前账号已有账号运营数据，不能自动合并旧共享数据', code: 'ACCOUNT_ALREADY_CONFIGURED' });
    res.json(await claimLegacyAnalyticsForUser(userId));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' });
  }
});

// 素材工坊 - AI 分析素材需求
router.post('/materials/analyze', async (req, res) => {
  try {
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
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

// 检查 AI 配置状态（aiSource 告诉前端这次用的是账号 Key 还是站点公共 Key）
router.get('/status', async (req, res) => {
  const authed = req as AiRequest;
  try {
    const legacy = await getLegacyAccountAnalyticsClaimStatus().catch(() => ({ available: false, claimed: false }));
    res.json({
      aiConfigured: hasAiKey(),
      aiSource: authed.aiKeySource ?? (config.deepseekApiKey ? 'server' : 'none'),
      // YouTube 数据源是站点级公共配置（用户不需要、也不该看到配置方式），这里只回状态
      youtubeConfigured: isYouTubeConfigured(),
      accountInfo: authed.authUser ? await getUserAccountInfo(authed.authUser.id) : defaultAccountInfo(),
      legacyAnalyticsAvailable: legacy.available,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message, code: 'CLOUD_ERROR' });
  }
});

// 重新翻译全部新闻标题（清掉旧翻译，重新生成）
router.post('/retranslate', async (req, res) => {
  try {
    if (!hasAiKey()) {
      return res.status(400).json({ error: AI_NOT_CONFIGURED_MESSAGE });
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
