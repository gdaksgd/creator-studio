import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getAuthSecret } from './authStore.js';
import { updateCloud } from './cloudStore.js';
import type { CloudAccountData, CloudAiConfig } from './cloudStore.js';

// ============================================
// 账号级 AI 配置（一个账号一份 DeepSeek Key）
//
// 存储：cloud blob 里 `accounts[userId].ai`，随账号数据一起放在 Supabase 那一行。
// 因为那一行的 anon key 一旦泄露就能被人直接读走内容，Key 不能明文落库 ——
// 用 AUTH_SECRET（或 server/data/auth-secret.txt）派生的密钥做 AES-256-GCM 加密，
// 存储格式 `enc.v1.<iv>.<tag>.<ciphertext>`（base64url），IV 每次随机。
// 接口对外只回掩码（sk-abc****wxyz），明文只存在于服务端内存。
// ============================================

const ENC_PREFIX = 'enc.v1.';

let cachedEncryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (!cachedEncryptionKey) {
    cachedEncryptionKey = createHash('sha256').update(getAuthSecret()).update('|ai-config-v1').digest();
  }
  return cachedEncryptionKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${[iv, tag, ciphertext].map((buf) => buf.toString('base64url')).join('.')}`;
}

export function decryptSecret(stored: string): string | null {
  if (!stored) return null;
  // 兼容历史明文（理论上不存在，但读旧数据时不要因此崩掉）
  if (!stored.startsWith(ENC_PREFIX)) return stored.trim() || null;

  const parts = stored.slice(ENC_PREFIX.length).split('.');
  if (parts.length !== 3) return null;
  const [ivPart, tagPart, cipherPart] = parts;

  try {
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(cipherPart, 'base64url')), decipher.final()]);
    return plain.toString('utf8').trim() || null;
  } catch {
    console.error('[ai-config] 解密账号 AI Key 失败（AUTH_SECRET 是否变过？）');
    return null;
  }
}

/** 对外展示用的掩码：sk-abc****wxyz */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 5)}****${trimmed.slice(-4)}`;
}

/** 从「已经读到的账号记录」里解出明文 Key —— requireAuth / optionalAuth 刚读过云端时用它，省一次往返 */
export function decodeAccountKey(account: CloudAccountData | undefined): string {
  const stored = account?.ai?.deepseekApiKey;
  if (!stored) return '';
  return decryptSecret(stored) ?? '';
}

export interface AccountAiConfigView {
  /** 账号自己配了 Key */
  configured: boolean;
  /** 掩码后的 Key（没配则为 null） */
  maskedKey: string | null;
  updatedAt: number | null;
}

/** 只读视图（掩码），给 GET /api/ai-config 用；传入 requireAuth 已经读到的账号记录 */
export function viewAccountAiConfig(account: CloudAccountData | undefined): AccountAiConfigView {
  const masked = account?.ai?.deepseekApiKey ? maskKey(decodeAccountKey(account)) : null;
  return {
    configured: !!masked,
    maskedKey: masked,
    updatedAt: account?.ai?.updatedAt ?? null,
  };
}

/** 写入或清除账号的 AI Key；传入 null / 空串表示清除（回到站点公共配置） */
export async function setAccountAiKey(userId: string, plainKey: string | null): Promise<AccountAiConfigView> {
  return updateCloud((blob) => {
    // 账号记录理论上注册时就有了；万一没有（老数据/手工改过云端），这里补一条空的
    const account = blob.accounts[userId] ?? { topics: [], scripts: [], uploadedAt: 0 };
    blob.accounts[userId] = account;
    if (!plainKey) {
      delete account.ai;
    } else {
      const ai: CloudAiConfig = { deepseekApiKey: encryptSecret(plainKey), updatedAt: Date.now() };
      account.ai = ai;
    }
    return viewAccountAiConfig(account);
  });
}
