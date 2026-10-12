import { readCloud, updateCloud, writeCloud } from '../src/services/cloudStore.js';
import { encryptSecret, maskKey } from '../src/services/aiConfigStore.js';

// ============================================
// 云端账号数据的运维小工具（在 server/ 目录下运行）
//
//   npx tsx scripts/cloud-admin.ts stats
//       只读：打印账号数、每个账号的 topic/script 数量、以及迁移前的 legacy 数据量
//
//   npx tsx scripts/cloud-admin.ts prune-prefix selftest
//       删掉用户名以某前缀开头的账号（连同它的云端数据），用于清理测试账号
//
//   npx tsx scripts/cloud-admin.ts adopt-legacy <用户名> [--force]
//       把账号制之前的旧云端数据（legacy）交给某个账号。
//       旧数据是匿名上传的，无法自动判断属于谁；本人注册后用它把数据认领回去。
//       账号里已有数据时必须加 --force 才覆盖。
//
//   npx tsx scripts/cloud-admin.ts set-ai <用户名> --from-env
//   npx tsx scripts/cloud-admin.ts set-ai <用户名> --key sk-xxxxxxxx
//       把 DeepSeek Key 写进某个账号的 AI 配置（加密后落库，命令不回显明文）。
//       --from-env 读 server/.env 里的 DEEPSEEK_API_KEY，用于把站点公共 Key 交给本人账号。
//
// 注意：改动会直接写到 Supabase 那一行，执行前先确认。
// ============================================

function formatTime(value: number): string {
  return value > 0 ? new Date(value).toISOString() : '-';
}

async function stats(): Promise<void> {
  const { blob, uploadedAt } = await readCloud();
  console.log('云端数据总览');
  console.log(`  结构版本: ${blob.version}`);
  console.log(`  行级 uploaded_at: ${formatTime(uploadedAt)}`);
  console.log(`  账号数: ${blob.users.length}`);
  for (const user of blob.users) {
    const account = blob.accounts[user.id];
    console.log(
      `    - ${user.username} (${user.id}) topics=${account?.topics.length ?? 0} scripts=${
        account?.scripts.length ?? 0
      } ai=${account?.ai?.deepseekApiKey ? '本账号已配置' : '无（用站点公共配置）'} updated=${formatTime(
        account?.uploadedAt ?? 0
      )} created=${formatTime(user.createdAt)}`
    );
  }
  if (blob.legacy) {
    console.log(
      `  迁移前的旧数据（已保留，不对外开放）: topics=${blob.legacy.topics.length} scripts=${
        blob.legacy.scripts.length
      } uploadedAt=${formatTime(blob.legacy.uploadedAt)}`
    );
  } else {
    console.log('  迁移前的旧数据: 无');
  }
}

async function prunePrefix(prefix: string): Promise<void> {
  if (!prefix) throw new Error('用法: prune-prefix <用户名前缀>');
  const removed = await updateCloud((blob) => {
    const matched = blob.users.filter((user) => user.usernameKey.startsWith(prefix.toLowerCase()));
    for (const user of matched) {
      delete blob.accounts[user.id];
    }
    blob.users = blob.users.filter((user) => !user.usernameKey.startsWith(prefix.toLowerCase()));
    return matched.map((user) => user.username);
  });
  if (removed.length === 0) {
    console.log(`没有用户名以 "${prefix}" 开头的账号`);
    return;
  }
  console.log(`已删除 ${removed.length} 个账号: ${removed.join(', ')}`);
}

/** 兜底：把当前内存里的 blob 原样写回（用于确认写入链路是否正常） */
export async function rewrite(): Promise<void> {
  const { blob } = await readCloud();
  await writeCloud(blob);
  console.log('已原样写回云端');
}

/**
 * 把 legacy（账号制之前匿名上传的旧数据）交给某个已注册账号。
 * 因为 old row 没有归属信息，只能由本人注册后手动认领。
 */
async function adoptLegacy(username: string, force: boolean): Promise<void> {
  if (!username) throw new Error('用法: adopt-legacy <用户名> [--force]');
  const result = await updateCloud((blob) => {
    const legacy = blob.legacy;
    if (!legacy) throw new Error('云端没有可认领的旧数据（legacy 为空）');
    const key = username.toLowerCase();
    const user = blob.users.find((item) => item.usernameKey === key);
    if (!user) throw new Error(`没有叫 "${username}" 的账号；先让本人注册，再执行本命令`);
    const existing = blob.accounts[user.id];
    const hasData = !!existing && (existing.topics.length > 0 || existing.scripts.length > 0);
    if (hasData && !force) {
      throw new Error(
        `账号 "${user.username}" 已有云端数据（topics=${existing?.topics.length ?? 0} scripts=${
          existing?.scripts.length ?? 0
        }）；确认覆盖请加 --force`
      );
    }
    blob.accounts[user.id] = {
      topics: legacy.topics,
      scripts: legacy.scripts,
      uploadedAt: legacy.uploadedAt > 0 ? legacy.uploadedAt : Date.now(),
    };
    delete blob.legacy;
    return { username: user.username, topics: legacy.topics.length, scripts: legacy.scripts.length };
  });
  console.log(`已把旧数据交给账号 "${result.username}": topics=${result.topics} scripts=${result.scripts}`);
}

/**
 * 把 DeepSeek Key 写进某个账号的 AI 配置（一个账号一份 AI 配置）。
 * 明文不落库：用 AUTH_SECRET 派生的密钥做 AES-256-GCM 加密；命令也不回显明文。
 */
async function setAi(username: string, fromEnv: boolean, keyArg: string): Promise<void> {
  if (!username) throw new Error('用法: set-ai <用户名> [--from-env | --key sk-...]');
  const key = (fromEnv ? process.env.DEEPSEEK_API_KEY || '' : keyArg).trim();
  if (!key) {
    throw new Error(
      '没有可写入的 Key：用 --from-env 读 server/.env 的 DEEPSEEK_API_KEY，或用 --key sk-... 直接指定'
    );
  }

  const result = await updateCloud((blob) => {
    const user = blob.users.find((item) => item.usernameKey === username.toLowerCase());
    if (!user) throw new Error(`没有叫 "${username}" 的账号；先让本人注册，再执行本命令`);
    const account = blob.accounts[user.id] ?? { topics: [], scripts: [], uploadedAt: 0 };
    blob.accounts[user.id] = account;
    account.ai = { deepseekApiKey: encryptSecret(key), updatedAt: Date.now() };
    return { username: user.username, masked: maskKey(key) };
  });

  console.log(`已把 AI Key 写入账号 "${result.username}"：${result.masked}（AES-256-GCM 加密后落库，明文不进仓库）`);
}

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === 'stats' || command === undefined) {
    await stats();
  } else if (command === 'prune-prefix') {
    await prunePrefix(rest[0] ?? '');
  } else if (command === 'adopt-legacy') {
    await adoptLegacy(rest[0] ?? '', rest.includes('--force'));
  } else if (command === 'set-ai') {
    const keyIndex = rest.indexOf('--key');
    await setAi(rest[0] ?? '', rest.includes('--from-env'), keyIndex >= 0 ? rest[keyIndex + 1] ?? '' : '');
  } else if (command === 'rewrite') {
    await rewrite();
  } else {
    console.error(
      `未知命令: ${command}（可用: stats / prune-prefix <前缀> / adopt-legacy <用户名> [--force] / set-ai <用户名> [--from-env|--key sk-...] / rewrite）`
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error('[cloud-admin] 执行失败:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
