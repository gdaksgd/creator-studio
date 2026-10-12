import { useEffect, useState, type ReactNode } from 'react';
import { Cloud, Database, KeyRound, LogIn, LogOut, RefreshCw, ShieldCheck, Trash2, TriangleAlert, UserRound } from 'lucide-react';
import { api, ApiError, type AccountInfo, type AiKeySource } from '../api/client';
import { manualSync } from '../services/syncService';
import { useAuthStore } from '../services/authService';
import { useToast } from '../components/ui/Toast';
import {
  clearDemoData,
  countDemoData,
  getDemoState,
  seedDemoData,
  type DemoState,
} from '../services/demoData';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input } from '../components/ui/Input';

/** 时间戳 → 本地时间（账号卡片里的「云端更新时间」） */
function formatLocalTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN');
}

/** 登录过期（401 / UNAUTHORIZED）不算「同步失败」 */
function isUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) return true;
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'UNAUTHORIZED';
}

/**
 * 分组标签：设置项多了以后，一张卡片挨一张卡片地排下来会显得又长又乱。
 * 用「小标签 + 细线」把卡片分成账号 / 平台与数据源 / 本机数据与备份三组，
 * 每组内部才是两列网格——同一行的卡片高度由 grid 拉伸对齐，不再出现一边高一边空的锯齿。
 */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div data-group-label className="mb-3 flex items-center gap-3">
      <span className="eyebrow">{children}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

/** 键值行：账号卡片和状态卡片共用，保证同一页里的信息行长得一样 */
function StatRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="shrink-0 text-xs text-text-secondary">{label}</span>
      <span className="num min-w-0 truncate text-xs font-medium text-text">{children}</span>
    </div>
  );
}

function StatList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface-muted/40 px-3.5">
      {children}
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const [aiConfigured, setAiConfigured] = useState(false);
  // AI 配置：跟着账号走。aiSource 说明这次实际用的是「账号自己的 Key」还是「站点公共配置」
  const [aiSource, setAiSource] = useState<AiKeySource>('none');
  const [aiMasked, setAiMasked] = useState<string | null>(null);
  const [aiUpdatedAt, setAiUpdatedAt] = useState<number | null>(null);
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authLocalError, setAuthLocalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<boolean | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoCount, setDemoCount] = useState(0);
  const [demoState, setDemoState] = useState<DemoState>('auto');
  const [demoMessage, setDemoMessage] = useState('');
  const [form, setForm] = useState<AccountInfo>({
    bilibiliFollowers: 0,
    bilibiliAvgViews: 0,
    douyinFollowers: 0,
    douyinAvgViews: 0,
    contentFocus: '卡牌游戏 + 恐怖游戏',
    daysActive: 0,
    totalVideos: 0,
    bilibiliUid: '',
    douyinId: '',
    lastSyncAt: 0,
    bilibiliName: '',
    bilibiliTotalLikes: 0,
    douyinName: '',
    douyinTotalVideos: 0,
    douyinTotalLikes: 0,
    syncMessage: '',
  });

  const authUser = useAuthStore((s) => s.user);
  const authToken = useAuthStore((s) => s.token);
  const authCloud = useAuthStore((s) => s.cloud);
  const authLoading = useAuthStore((s) => s.loading);
  const authError = useAuthStore((s) => s.error);
  const authConfigured = useAuthStore((s) => s.authConfigured);
  const register = useAuthStore((s) => s.register);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  const refreshDemoCount = async () => {
    setDemoCount(await countDemoData());
    setDemoState(getDemoState());
  };

  /** 改动输入即清掉上一次的错误提示（否则用户改了用户名还看着旧报错） */
  const updateAuthField = (patch: Partial<{ username: string; password: string }>) => {
    setAuthLocalError('');
    if (authError) useAuthStore.setState({ error: '' });
    setAuthForm((prev) => ({ ...prev, ...patch }));
  };

  /** 注册 / 登录共用：前端先做一次长度校验，错文案交给 store 按 code 映射 */
  const handleAuth = async (mode: 'register' | 'login') => {
    const username = authForm.username.trim();
    const password = authForm.password;
    setAuthLocalError('');

    if (!username) {
      setAuthLocalError('请先填写用户名');
      return;
    }
    if (mode === 'register' && (username.length < 3 || username.length > 24)) {
      setAuthLocalError('用户名需要 3–24 个字符');
      return;
    }
    if (mode === 'register' && password.length < 6) {
      setAuthLocalError('密码至少 6 位');
      return;
    }
    if (mode === 'login' && !password) {
      setAuthLocalError('请先填写密码');
      return;
    }

    try {
      if (mode === 'register') await register(username, password);
      else await login(username, password);
      setAuthForm({ username: '', password: '' });
      // 注册/登录成功会清空演示数据并拉取该账号的云端数据，这里同步刷新卡片上的计数
      await refreshDemoCount();
      toast.success(mode === 'register' ? '注册成功，已清空演示数据' : '登录成功');
    } catch {
      // 失败文案由 useAuthStore.error 按后端 code 给出（409/401/503/网络），这里不重复提示
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.info('已退出登录，本地数据不受影响');
  };

  useEffect(() => {
    api.getStatus().then((data) => {
      setAiConfigured(data.aiConfigured);
      setAiSource(data.aiSource);
      setYoutubeConfigured(data.youtubeConfigured);
      setForm(data.accountInfo);
    }).catch(console.error);
    api.getSyncStatus().then((data) => setSyncStatus(data.syncConfigured)).catch(() => setSyncStatus(false));
    countDemoData().then(setDemoCount).catch(() => setDemoCount(0));
    setDemoState(getDemoState());
  }, []);

  // AI 配置跟着账号切换：登录后读自己账号里的 Key（只回掩码），退出后回到「站点公共配置」
  useEffect(() => {
    let alive = true;
    api.getStatus()
      .then((data) => {
        if (!alive) return;
        setAiSource(data.aiSource);
        setAiConfigured(data.aiConfigured);
        setYoutubeConfigured(data.youtubeConfigured);
      })
      .catch(() => { /* 后端不可用：保留当前状态，不影响本地功能 */ });

    if (!authToken) {
      setAiMasked(null);
      setAiUpdatedAt(null);
      setAiKeyInput('');
      setAiMessage(null);
      return () => { alive = false; };
    }

    api.getAiConfig()
      .then((cfg) => {
        if (!alive) return;
        setAiMasked(cfg.maskedKey);
        setAiUpdatedAt(cfg.updatedAt);
      })
      .catch(() => { /* 未登录或网络问题：卡片按「站点公共配置」展示 */ });

    return () => { alive = false; };
  }, [authToken]);

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const result = await manualSync();
      setSyncMessage(result.uploaded ? '已上传本地数据到云端' : result.downloaded ? '已从云端恢复数据' : '同步完成');
    } catch (err) {
      // 401 是「登录过期」而不是网络/服务器问题，给一句能指导操作的文案
      setSyncMessage(
        isUnauthorized(err) ? '登录已过期，请重新登录' : '同步失败: ' + (err as Error).message,
      );
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(''), 3000);
    }
  };

  const handleSeedDemo = async () => {
    setDemoBusy(true);
    setDemoMessage('');
    try {
      const result = await seedDemoData();
      setDemoCount(await countDemoData());
      setDemoState(getDemoState());
      setDemoMessage(`已载入 ${result.topics} 个选题、${result.scripts} 个脚本`);
    } catch (err) {
      setDemoMessage('载入失败: ' + (err as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };

  const handleClearDemo = async () => {
    setDemoBusy(true);
    setDemoMessage('');
    try {
      await clearDemoData();
      setDemoCount(0);
      setDemoState(getDemoState());
      setDemoMessage('已清空演示数据，其它数据未受影响');
    } catch (err) {
      setDemoMessage('清空失败: ' + (err as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.updateAccount({
        bilibiliUid: form.bilibiliUid,
        douyinId: form.douyinId,
        contentFocus: form.contentFocus,
        daysActive: form.daysActive,
      });
      setForm(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('保存失败: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** 保存本账号的 DeepSeek Key（后端加密落库，只回掩码） */
  const handleSaveAiKey = async () => {
    const key = aiKeyInput.trim();
    setAiMessage(null);
    if (!key) {
      setAiMessage({ text: '请先粘贴你的 DeepSeek Key', ok: false });
      return;
    }
    if (key.length < 12) {
      setAiMessage({ text: 'Key 看起来不完整，请检查是否复制全了', ok: false });
      return;
    }

    setAiBusy(true);
    try {
      const cfg = await api.updateAiConfig(key);
      setAiMasked(cfg.maskedKey);
      setAiUpdatedAt(cfg.updatedAt);
      setAiSource('account');
      setAiConfigured(true);
      setAiKeyInput('');
      setAiMessage({ text: '已保存到你的账号，服务端加密存储', ok: true });
      toast.success('AI 配置已保存到你的账号');
    } catch (err) {
      setAiMessage({
        text:
          err instanceof ApiError && err.status === 400
            ? 'Key 格式不对：长度 12–200 且不能含空格'
            : '保存失败: ' + (err as Error).message,
        ok: false,
      });
    } finally {
      setAiBusy(false);
    }
  };

  /** 探活：输入框里有新 Key 就测它，否则测账号里已保存的那个 */
  const handleTestAiKey = async () => {
    setAiBusy(true);
    setAiMessage(null);
    try {
      const key = aiKeyInput.trim();
      const result = await api.testAiConfig(key || undefined);
      setAiMessage({ text: result.message, ok: result.ok });
    } catch (err) {
      setAiMessage({ text: '测试失败: ' + (err as Error).message, ok: false });
    } finally {
      setAiBusy(false);
    }
  };

  /** 清除本账号的 Key，回到站点公共配置 */
  const handleClearAiKey = async () => {
    setAiBusy(true);
    setAiMessage(null);
    try {
      const cfg = await api.updateAiConfig('');
      setAiMasked(cfg.maskedKey);
      setAiUpdatedAt(cfg.updatedAt);
      setAiKeyInput('');
      setAiSource(cfg.serverConfigured ? 'server' : 'none');
      setAiConfigured(cfg.serverConfigured);
      setAiMessage({
        text: cfg.serverConfigured ? '已清除，本账号改用站点公共配置' : '已清除',
        ok: true,
      });
      toast.info('已清除本账号的 AI Key');
    } catch (err) {
      setAiMessage({ text: '清除失败: ' + (err as Error).message, ok: false });
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="系统 / SETTINGS"
        title="设置"
        description="AI 能力、账号绑定与数据同步。所有创作数据都保存在本机浏览器，云端同步只是可选备份。"
      />

      {/* ───────────────── 账号 ───────────────── */}
      <section>
        <GroupLabel>账号</GroupLabel>
        <Card padding="lg" className="anim-rise">
          <SectionHeading
            title="账号与云端"
            hint="登录后数据跟着账号走，换设备也能恢复"
            action={
              authToken ? (
                <Badge variant="success">已登录</Badge>
              ) : authConfigured ? (
                <Badge variant="neutral">未登录</Badge>
              ) : (
                <Badge variant="warning">云端未启用</Badge>
              )
            }
          />

          {authToken ? (
            /* 已登录：左边是「我在云端有什么」，右边是「能做什么」 */
            <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
              <StatList>
                <StatRow label="登录账号">{authUser?.username ?? '已登录'}</StatRow>
                <StatRow label="云端数据">
                  {authCloud ? `${authCloud.topicCount} 个选题 · ${authCloud.scriptCount} 个脚本` : '—'}
                </StatRow>
                <StatRow label="云端更新时间">{formatLocalTime(authCloud?.uploadedAt)}</StatRow>
              </StatList>

              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-xs leading-relaxed text-text-muted">
                  数据先写本机，再同步到你的账号；退出登录不会删除本机数据。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={syncing}
                    disabled={!syncStatus}
                    onClick={handleManualSync}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    立即同步
                  </Button>
                  <Button variant="dangerGhost" size="sm" onClick={() => void handleLogout()}>
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    退出登录
                  </Button>
                  {syncMessage && <span className="text-xs text-success">{syncMessage}</span>}
                </div>
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-text-muted">
                  <Cloud className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>一次登录，本机与云端保持一致；演示数据不会进入云端。</span>
                </p>
              </div>
            </div>
          ) : (
            /* 未登录：左边说清楚这是什么，右边就是那一个表单 */
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
              <div className="min-w-0 space-y-3">
                <p className="text-xs leading-relaxed text-text-muted">
                  注册后演示数据会自动清空，云端只保存你自己的数据；
                  <span className="text-text">不注册也能继续本地使用</span>，所有创作数据都留在本机。
                </p>
                <ul className="space-y-2 text-xs leading-relaxed text-text-secondary">
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>一人一份云端数据，换设备登录就能恢复</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>数据改动后 5 秒自动上传，也可以手动触发</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>演示数据只写本机，不会进入云端同步</span>
                  </li>
                </ul>
                {!authConfigured && (
                  <p className="text-xs leading-relaxed text-warning">
                    服务端未配置云端账号，本地功能不受影响。
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-surface-muted/40 p-4">
                <div className="grid gap-3">
                  <Field label="用户名" hint="3–24 个字符">
                    <Input
                      type="text"
                      value={authForm.username}
                      autoComplete="username"
                      onChange={(e) => updateAuthField({ username: e.target.value })}
                      placeholder="例如: creator2026"
                    />
                  </Field>
                  <Field label="密码" hint="至少 6 位">
                    <Input
                      type="password"
                      value={authForm.password}
                      autoComplete="current-password"
                      onChange={(e) => updateAuthField({ password: e.target.value })}
                      placeholder="••••••"
                    />
                  </Field>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={authLoading}
                    onClick={() => void handleAuth('register')}
                  >
                    <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                    注册并开始使用
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={authLoading}
                    onClick={() => void handleAuth('login')}
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                    登录
                  </Button>
                </div>

                {(authLocalError || authError) && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-danger">
                      {authLocalError || authError}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* ───────────────── 平台与数据源 ───────────────── */}
      <section>
        <GroupLabel>平台与数据源</GroupLabel>
        <div className="grid gap-5 xl:grid-cols-2">
          {/* 账号绑定配置 */}
          <Card padding="lg" className="anim-rise flex flex-col">
            <SectionHeading
              title="账号绑定"
              hint="填写后每天自动同步账号数据"
              action={
                <a href="/analytics" className="shrink-0 text-xs text-primary hover:underline">
                  查看数据看板 →
                </a>
              }
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="B站 UID" hint={form.bilibiliName ? `✓ ${form.bilibiliName}` : undefined}>
                <Input
                  type="text"
                  value={form.bilibiliUid || ''}
                  onChange={(e) => setForm({ ...form, bilibiliUid: e.target.value })}
                  placeholder="例如: 289518100"
                />
              </Field>
              <Field label="抖音号" hint={form.douyinName ? `✓ ${form.douyinName}` : undefined}>
                <Input
                  type="text"
                  value={form.douyinId || ''}
                  onChange={(e) => setForm({ ...form, douyinId: e.target.value })}
                  placeholder="例如: zgbwngbd"
                />
              </Field>
              <Field label="内容方向">
                <Input
                  type="text"
                  value={form.contentFocus}
                  onChange={(e) => setForm({ ...form, contentFocus: e.target.value })}
                />
              </Field>
              <Field label="活跃天数">
                <Input
                  type="number"
                  value={form.daysActive}
                  onChange={(e) => setForm({ ...form, daysActive: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
                保存配置
              </Button>
              {saved && <Badge variant="success">✓ 已保存</Badge>}
            </div>
          </Card>

          {/* AI 配置：一个账号一份 Key，存进自己的账号（服务端加密），不再教用户去改服务器上的文件 */}
          <Card padding="lg" className="anim-rise flex flex-col">
            <SectionHeading
              title="AI 配置"
              hint="一个账号一份 DeepSeek Key，跟着你的账号走"
              action={
                aiSource === 'account' ? (
                  <Badge variant="success">本账号</Badge>
                ) : aiSource === 'server' ? (
                  <Badge variant="neutral">站点公共配置</Badge>
                ) : (
                  <Badge variant="warning">未配置</Badge>
                )
              }
            />

            <div className="mt-3.5">
              <StatList>
                <StatRow label="本账号 Key">
                  {authToken ? aiMasked ?? '未设置' : '登录后可配置'}
                </StatRow>
                <StatRow label="视频数据源">
                  <Badge variant={youtubeConfigured ? 'success' : 'neutral'} size="sm">
                    {youtubeConfigured ? 'YouTube 已连接' : 'YouTube 未配置'}
                  </Badge>
                </StatRow>
              </StatList>
            </div>

            {authToken ? (
              <div className="mt-4">
                <Field
                  label="DeepSeek API Key"
                  hint={aiUpdatedAt ? `上次更新 ${formatLocalTime(aiUpdatedAt)}` : undefined}
                >
                  <Input
                    type="password"
                    value={aiKeyInput}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => {
                      setAiKeyInput(e.target.value);
                      setAiMessage(null);
                    }}
                    placeholder="sk-..."
                  />
                </Field>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" loading={aiBusy} onClick={() => void handleSaveAiKey()}>
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    保存到我的账号
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={aiBusy || (!aiKeyInput.trim() && !aiMasked)}
                    onClick={() => void handleTestAiKey()}
                  >
                    测试连接
                  </Button>
                  {aiMasked && (
                    <Button variant="ghost" size="sm" disabled={aiBusy} onClick={() => void handleClearAiKey()}>
                      清除
                    </Button>
                  )}
                </div>
                {aiMessage && (
                  <p
                    className={`mt-2.5 text-xs leading-relaxed ${aiMessage.ok ? 'text-success' : 'text-danger'}`}
                  >
                    {aiMessage.text}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-border px-3.5 py-3 text-xs leading-relaxed text-text-secondary">
                {aiConfigured
                  ? '现在用的是站点公共 AI 配置，可以直接用。'
                  : '站点还没有配置公共 AI，'}
                <span className="text-text">登录后</span>
                把你的 DeepSeek Key 存进账号，换设备登录也跟着走。
              </p>
            )}

            <p className="mt-auto flex items-center gap-1.5 border-t border-border pt-4 text-xs text-text-muted">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                只显示掩码，Key 加密存在你的账号里；没有 Key 可以去{' '}
                <a
                  href="https://platform.deepseek.com/"
                  target="_blank"
                  rel="noopener"
                  className="text-primary hover:underline"
                >
                  platform.deepseek.com
                </a>{' '}
                申请。
              </span>
            </p>
          </Card>
        </div>
      </section>

      {/* ───────────────── 本机数据与备份 ───────────────── */}
      <section>
        <GroupLabel>本机数据与备份</GroupLabel>
        <div className="grid gap-5 xl:grid-cols-2">
          {/* 演示数据 */}
          <Card padding="lg" className="anim-rise flex flex-col">
            <SectionHeading
              title="演示数据"
              hint="一键让所有页面进入「有内容」的状态"
              action={
                demoCount > 0 ? (
                  <Badge variant="success">已载入 {demoCount} 条</Badge>
                ) : (
                  <Badge variant="neutral">未载入</Badge>
                )
              }
            />
            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              演示数据包含 9 个选题（含已发布数据、AI 评估、素材方案与 6 份分镜脚本），
              只写入本机 IndexedDB，<span className="text-text">不会进入云端同步</span>，
              随时可以一键清空。第一次打开站点且本地为空时会自动载入。
            </p>
            <div className="mt-3.5">
              <StatList>
                <StatRow label="已载入演示数据">{demoCount} 条</StatRow>
                <StatRow label="自动载入">
                  <Badge variant={demoState === 'off' ? 'neutral' : 'success'} size="sm">
                    {demoState === 'off' ? '已关闭' : '开启'}
                  </Badge>
                </StatRow>
              </StatList>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" loading={demoBusy} onClick={handleSeedDemo}>
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                载入演示数据
              </Button>
              <Button
                variant="dangerGhost"
                size="sm"
                disabled={demoBusy || demoCount === 0}
                onClick={handleClearDemo}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                清空演示数据
              </Button>
            </div>
            {demoMessage && <p className="mt-3 text-xs text-success">{demoMessage}</p>}
          </Card>

          {/* 云端同步 */}
          <Card padding="lg" className="anim-rise flex flex-col">
            <SectionHeading
              title="云端同步"
              hint="数据改动后 5 秒自动上传，换设备可恢复"
              action={
                syncStatus ? (
                  <Badge variant="success">已启用</Badge>
                ) : (
                  <Badge variant="neutral">未配置</Badge>
                )
              }
            />
            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              演示数据不参与同步；真实创作数据会先写本机，再作为可选备份上传云端。
            </p>
            <div className="mt-3.5">
              <StatList>
                <StatRow label="同步开关">
                  <Badge variant={syncStatus ? 'success' : 'neutral'} size="sm">
                    {syncStatus ? '已启用' : '未配置'}
                  </Badge>
                </StatRow>
                <StatRow label="上次同步时间">
                  {form.lastSyncAt ? new Date(form.lastSyncAt).toLocaleString('zh-CN') : '—'}
                </StatRow>
              </StatList>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                loading={syncing}
                disabled={!syncStatus}
                onClick={handleManualSync}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                手动同步
              </Button>
              {syncMessage && <span className="text-xs text-success">{syncMessage}</span>}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
