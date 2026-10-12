import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { AuthedRequest } from '../middleware/requireAuth.js';
import { decodeAccountKey, setAccountAiKey, viewAccountAiConfig } from '../services/aiConfigStore.js';
import { isAIConfigured } from '../config.js';
import { testApiKey } from '../services/aiService.js';

// ============================================
// 账号级 AI 配置
//
//   GET  /api/ai-config       读取本账号的 AI 配置（只回掩码）
//   PUT  /api/ai-config       写入/清除本账号的 DeepSeek Key
//   POST /api/ai-config/test  用本账号的 Key 探活（不传 key 就用已保存的）
//
// 全部需要 Bearer token；明文 Key 只进不出，响应里只有掩码。
// ============================================

const router = Router();

router.use(requireAuth);

const MAX_KEY_LENGTH = 200;
const MIN_KEY_LENGTH = 12;

function badKey(message: string): { error: string; code: string } {
  return { error: message, code: 'BAD_KEY' };
}

/**
 * 解析请求体里的 apiKey：
 *   undefined = 字段缺失（PUT 视为非法，test 视为「用已保存的 Key」）
 *   ''        = 显式空串（PUT 表示清除）
 *   string    = 可用的 Key
 *   null      = 格式不合法
 */
function parseIncomingKey(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed;
}

const KEY_FORMAT_HINT = `Key 看起来不对：长度应为 ${MIN_KEY_LENGTH}-${MAX_KEY_LENGTH} 且不能含空格`;

router.get('/', (req, res) => {
  const authed = req as AuthedRequest;
  // requireAuth 已经把云端里这个账号的记录读出来了，直接用它算掩码
  res.json({
    ...viewAccountAiConfig(authed.cloudAccount),
    /** 站点是否配了公共 Key（没配账号 Key 时用的是它） */
    serverConfigured: isAIConfigured(),
  });
});

router.put('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const incoming = parseIncomingKey(body.apiKey);
  if (incoming === undefined) {
    res.status(400).json(badKey('缺少 apiKey 字段（传空字符串表示清除本账号的 Key）'));
    return;
  }
  if (incoming === null) {
    res.status(400).json(badKey(KEY_FORMAT_HINT));
    return;
  }

  try {
    const authed = req as AuthedRequest;
    const account = await setAccountAiKey(authed.authUser!.id, incoming);
    res.json({ ...account, serverConfigured: isAIConfigured() });
  } catch (err) {
    console.error('[ai-config] save failed:', err);
    res.status(502).json({ error: '保存 AI 配置失败', code: 'AI_CONFIG_ERROR' });
  }
});

router.post('/test', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const authed = req as AuthedRequest;
  const incoming = parseIncomingKey(body.apiKey);
  if (incoming === null) {
    res.status(400).json(badKey(KEY_FORMAT_HINT));
    return;
  }

  try {
    // 没传新 Key（字段缺失或空串）就测账号里已经保存的那个
    const key = incoming || decodeAccountKey(authed.cloudAccount);
    if (!key) {
      res.status(400).json({ error: '这个账号还没保存 AI Key，请先填写并保存', code: 'NO_KEY' });
      return;
    }

    const result = await testApiKey(key);
    res.json(result);
  } catch (err) {
    console.error('[ai-config] test failed:', err);
    res.status(502).json({ ok: false, message: '测试连接失败，请稍后再试' });
  }
});

export default router;
