import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { CloudError, readCloud, updateCloud } from './cloudStore.js';
import type { CloudUserRecord } from './cloudStore.js';

// ============================================
// 账号体系（注册 / 登录 / 无状态 token）
//
// - 口令只存 scrypt 摘要，明文不落盘、不写日志
// - token 是无状态 HMAC：`<base64url(userId)>.<exp>.<sig>`，服务端不存会话表
// - 签名密钥优先取 AUTH_SECRET；没配就生成一份存到 server/data/auth-secret.txt
//   （保证重启后已发出的 token 仍然有效）
// ============================================

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEM = 64 * 1024 * 1024;

const USERNAME_PATTERN = /^[A-Za-z0-9_\u4e00-\u9fa5-]{3,24}$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 72;

/** token 有效期：90 天 */
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

export interface PublicUser {
  id: string;
  username: string;
  createdAt: number;
}

export interface TokenPayload {
  userId: string;
  exp: number;
}

export function toPublicUser(user: CloudUserRecord): PublicUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

// ---------- 密钥 ----------

let cachedSecret: Buffer | null = null;

export function getAuthSecret(): Buffer {
  if (cachedSecret) return cachedSecret;

  const configured = (config.authSecret || '').trim();
  if (configured.length >= 16) {
    cachedSecret = Buffer.from(configured, 'utf8');
    return cachedSecret;
  }

  const secretPath = path.join(config.dataDir, 'auth-secret.txt');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) {
      cachedSecret = Buffer.from(existing, 'utf8');
      return cachedSecret;
    }
  } catch {
    // 第一次运行还没有这个文件，下面生成
  }

  const generated = randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(secretPath, generated + '\n', { encoding: 'utf8', mode: 0o600 });
    console.log('[auth] 未配置 AUTH_SECRET，已自动生成一份：server/data/auth-secret.txt');
  } catch (err) {
    console.warn('[auth] AUTH_SECRET 无法持久化，重启后已有登录态会失效:', err);
  }
  cachedSecret = Buffer.from(generated, 'utf8');
  return cachedSecret;
}

// ---------- 口令 ----------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: SCRYPT_MAX_MEM,
  });
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    base64url(salt),
    base64url(derived),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelism)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  const actual = await scrypt(password, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: SCRYPT_MAX_MEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- token ----------

export function signToken(userId: string, now = Date.now()): string {
  const exp = now + TOKEN_TTL_MS;
  const payload = `${base64url(userId)}.${exp}`;
  const signature = createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedId, expText, signature] = parts;
  const expected = createHmac('sha256', getAuthSecret()).update(`${encodedId}.${expText}`).digest('base64url');
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp <= Date.now()) return null;

  let userId = '';
  try {
    userId = Buffer.from(encodedId, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!userId) return null;
  return { userId, exp };
}

// ---------- 注册 / 登录 ----------

export function validateCredentials(
  usernameRaw: unknown,
  passwordRaw: unknown
): { username: string; password: string } {
  const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';

  if (!USERNAME_PATTERN.test(username)) {
    throw new CloudError(400, 'BAD_REQUEST', '用户名需要 3-24 位：中英文、数字、下划线或短横线');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new CloudError(400, 'BAD_REQUEST', `密码长度需要 ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 位`);
  }
  return { username, password };
}

export async function registerUser(
  usernameRaw: unknown,
  passwordRaw: unknown
): Promise<{ token: string; user: PublicUser }> {
  const { username, password } = validateCredentials(usernameRaw, passwordRaw);
  const usernameKey = username.toLowerCase();
  // 哈希在锁外算（scrypt 是 CPU 密集的，别占着写锁）
  const passwordHash = await hashPassword(password);

  return updateCloud((blob) => {
    if (blob.users.some((user) => user.usernameKey === usernameKey)) {
      throw new CloudError(409, 'USERNAME_TAKEN', '这个用户名已经被注册了');
    }
    const user: CloudUserRecord = {
      id: randomUUID(),
      username,
      usernameKey,
      passwordHash,
      createdAt: Date.now(),
    };
    blob.users.push(user);
    blob.accounts[user.id] = { topics: [], scripts: [], uploadedAt: 0 };
    return { token: signToken(user.id), user: toPublicUser(user) };
  });
}

export async function loginUser(
  usernameRaw: unknown,
  passwordRaw: unknown
): Promise<{ token: string; user: PublicUser }> {
  const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';
  if (!username || !password) {
    throw new CloudError(401, 'BAD_CREDENTIALS', '用户名或密码不对');
  }

  const { blob } = await readCloud();
  const usernameKey = username.toLowerCase();
  const user = blob.users.find((candidate) => candidate.usernameKey === usernameKey);

  if (!user) {
    // 用户不存在也走一遍 scrypt，避免通过响应时间枚举用户名
    await hashPassword(password);
    throw new CloudError(401, 'BAD_CREDENTIALS', '用户名或密码不对');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new CloudError(401, 'BAD_CREDENTIALS', '用户名或密码不对');
  }
  return { token: signToken(user.id), user: toPublicUser(user) };
}

export async function findUserById(userId: string): Promise<CloudUserRecord | null> {
  const { blob } = await readCloud();
  return blob.users.find((user) => user.id === userId) ?? null;
}
