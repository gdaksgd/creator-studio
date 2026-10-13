// Mock-Supabase black-box probe for per-account API isolation.
// Usage: node tools/account-isolation-probe.mjs [baseUrl]
const base = process.argv[2] || 'http://127.0.0.1:3001';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, body: await response.json().catch(() => null) };
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  // 用户名有 3–24 字符的长度上限，所以 nonce 必须短：`isoA_` + 这个后缀要留在 24 以内。
  const nonce = `${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 6)}`;
  const [a, b] = await Promise.all([
    request('/api/auth/register', { method: 'POST', body: { username: `isoA_${nonce}`, password: 'ProbePass123!' } }),
    request('/api/auth/register', { method: 'POST', body: { username: `isoB_${nonce}`, password: 'ProbePass123!' } }),
  ]);
  assert(a.response.status === 201 && b.response.status === 201, 'test account registration failed');
  const tokenA = a.body.token;
  const tokenB = b.body.token;
  check('created two isolated test accounts', !!tokenA && !!tokenB);

  const topicA = { id: `probe-A-${nonce}`, title: 'Probe account A', category: 'rpg' };
  const topicB = { id: `probe-B-${nonce}`, title: 'Probe account B', category: 'horror' };
  const assetA = { id: `asset-A-${nonce}`, title: 'A asset', url: 'https://example.com/a', type: 'link', tags: [] };
  const assetB = { id: `asset-B-${nonce}`, title: 'B asset', url: 'https://example.com/b', type: 'link', tags: [] };
  await request('/api/sync/upload', { token: tokenA, method: 'POST', body: { topics: [topicA], scripts: [], assets: [assetA], uploadedAt: Date.now() } });
  await request('/api/sync/upload', { token: tokenB, method: 'POST', body: { topics: [topicB], scripts: [], assets: [assetB], uploadedAt: Date.now() } });
  const [downloadA, downloadB] = await Promise.all([
    request('/api/sync/download', { token: tokenA }),
    request('/api/sync/download', { token: tokenB }),
  ]);
  check('sync download is isolated by token', downloadA.body.topics?.[0]?.id === topicA.id && downloadB.body.topics?.[0]?.id === topicB.id);
  check('asset sync is isolated by token', downloadA.body.assets?.[0]?.id === assetA.id && downloadB.body.assets?.[0]?.id === assetB.id);

  const unauthorizedRead = await request('/api/ai/account');
  const unauthorizedWrite = await request('/api/ai/account', { method: 'POST', body: { bilibiliUid: `uid-${nonce}` } });
  const unauthorizedSync = await request('/api/ai/account/sync', { method: 'POST' });
  check('account write requires an authenticated account', unauthorizedWrite.response.status === 401);
  check('anonymous account read cannot expose shared data', unauthorizedRead.body?.bilibiliUid === '');
  check('account sync is authenticated', unauthorizedSync.response.status === 401);

  await request('/api/ai/account', { token: tokenA, method: 'POST', body: { bilibiliUid: `uid-${nonce}`, contentFocus: 'probe-A' } });
  const [accountA, accountB] = await Promise.all([
    request('/api/ai/account', { token: tokenA }),
    request('/api/ai/account', { token: tokenB }),
  ]);
  check('account analytics are isolated by token', accountA.body.bilibiliUid === `uid-${nonce}` && accountB.body.bilibiliUid === '');
  // 认领旧共享统计只允许最早注册的那个账号：非 owner 会拿到 403 FORBIDDEN，
  // 已配置过账号数据的 owner 会拿到 409 CONFLICT。两者都说明「这个账号认领不了」。
  const claimStatus = (await request('/api/ai/account/claim-legacy', { token: tokenA, method: 'POST' })).response.status;
  check('legacy claim rejects an account that cannot own it', claimStatus === 403 || claimStatus === 409, `status=${claimStatus}`);

  // Remove probe records without touching either account's non-test data.
  await request('/api/sync/upload', { token: tokenA, method: 'POST', body: { topics: [], scripts: [], assets: [], uploadedAt: Date.now() } });
  await request('/api/sync/upload', { token: tokenB, method: 'POST', body: { topics: [], scripts: [], assets: [], uploadedAt: Date.now() } });
  console.log(`RESULT ${results.filter((item) => item.ok).length}/${results.length} checks passed`);
  if (results.some((item) => !item.ok)) process.exitCode = 1;
} catch (error) {
  console.error('PROBE_ABORTED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
