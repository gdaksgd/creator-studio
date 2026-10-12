import { useEffect, useState } from 'react';
import { Database, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { api, type AccountInfo } from '../api/client';
import { manualSync } from '../services/syncService';
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

export default function Settings() {
  const [aiConfigured, setAiConfigured] = useState(false);
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

  useEffect(() => {
    api.getStatus().then((data) => {
      setAiConfigured(data.aiConfigured);
      setForm(data.accountInfo);
    }).catch(console.error);
    api.getSyncStatus().then((data) => setSyncStatus(data.syncConfigured)).catch(() => setSyncStatus(false));
    countDemoData().then(setDemoCount).catch(() => setDemoCount(0));
    setDemoState(getDemoState());
  }, []);

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const result = await manualSync();
      setSyncMessage(result.uploaded ? '已上传本地数据到云端' : result.downloaded ? '已从云端恢复数据' : '同步完成');
    } catch (err) {
      setSyncMessage('同步失败: ' + (err as Error).message);
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

  return (
    <div>
      <PageHeader
        eyebrow="系统 / SETTINGS"
        title="设置"
        description="AI 能力、账号绑定与数据同步。所有创作数据都保存在本机浏览器，云端同步只是可选备份。"
      />

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        {/* 演示数据 */}
        <Card padding="lg" className="anim-rise">
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
          <div className="mt-3.5 divide-y divide-border rounded-xl border border-border bg-surface-muted/40 px-3.5">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-text-secondary">已载入演示数据</span>
              <span className="num text-xs font-medium text-text">{demoCount} 条</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-text-secondary">自动载入</span>
              <Badge variant={demoState === 'off' ? 'neutral' : 'success'} size="sm">
                {demoState === 'off' ? '已关闭' : '开启'}
              </Badge>
            </div>
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
          {demoMessage && (
            <p className="mt-3 text-xs text-success">{demoMessage}</p>
          )}
        </Card>

        {/* AI 配置状态 */}
        <Card padding="lg" className="anim-rise">
          <SectionHeading
            title="AI 配置状态"
            hint="选题评估、脚本生成与素材推荐都依赖它"
            action={
              aiConfigured ? (
                <Badge variant="success">已连接</Badge>
              ) : (
                <Badge variant="warning">未配置</Badge>
              )
            }
          />
          <div className="mt-3.5 divide-y divide-border rounded-xl border border-border bg-surface-muted/40 px-3.5">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-text-secondary">AI 服务</span>
              <span className="text-xs font-medium text-text">DeepSeek</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-text-secondary">连接状态</span>
              <Badge variant={aiConfigured ? 'success' : 'warning'} size="sm">
                {aiConfigured ? '已连接' : '未配置'}
              </Badge>
            </div>
          </div>
          {!aiConfigured && (
            <div className="mt-4 space-y-2 text-xs leading-relaxed text-text-secondary">
              <p className="font-medium text-text">配置步骤：</p>
              <ol className="list-inside list-decimal space-y-1">
                <li>
                  注册 DeepSeek 平台账号:{' '}
                  <a href="https://platform.deepseek.com/" target="_blank" rel="noopener" className="text-primary hover:underline">
                    platform.deepseek.com
                  </a>
                </li>
                <li>在 API Keys 页面创建一个新的 Key</li>
                <li>
                  打开 <code className="num rounded bg-surface-muted px-1 text-text">D:\自媒体之路\server\.env</code> 文件
                </li>
                <li>
                  填入: <code className="num rounded bg-surface-muted px-1 text-text">DEEPSEEK_API_KEY=你的key</code>
                </li>
                <li>重启后端服务</li>
              </ol>
            </div>
          )}
        </Card>

        {/* 账号绑定配置 */}
        <Card padding="lg" className="anim-rise">
          <SectionHeading
            title="账号绑定"
            hint="填写后每天自动同步账号数据"
            action={
              <a href="/analytics" className="text-xs text-primary hover:underline">
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
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button variant="primary" size="sm" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
            {saved && <Badge variant="success">✓ 已保存</Badge>}
          </div>
        </Card>

        {/* 云端同步 */}
        <Card padding="lg" className="anim-rise">
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
          <div className="mt-3.5 divide-y divide-border rounded-xl border border-border bg-surface-muted/40 px-3.5">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-text-secondary">同步开关</span>
              <Badge variant={syncStatus ? 'success' : 'neutral'} size="sm">
                {syncStatus ? '已启用' : '未配置'}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="shrink-0 text-xs text-text-secondary">上次同步时间</span>
              <span className="num text-xs font-medium text-text">
                {form.lastSyncAt ? new Date(form.lastSyncAt).toLocaleString('zh-CN') : '—'}
              </span>
            </div>
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

        {/* YouTube API 配置 */}
        <Card padding="lg" className="anim-rise xl:col-span-2">
          <SectionHeading title="YouTube Data API" hint="用于收集恐怖游戏热门视频（可选）" />
          <div className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
            <ol className="list-inside list-decimal space-y-1.5">
              <li>
                打开{' '}
                <a href="https://console.cloud.google.com/" target="_blank" rel="noopener" className="text-primary hover:underline">
                  Google Cloud Console
                </a>
              </li>
              <li>创建一个新项目（或选择已有项目）</li>
              <li>在「API 和服务」中启用「YouTube Data API v3」</li>
              <li>在「凭据」中创建 API Key</li>
              <li>
                填入 <code className="num rounded bg-surface-muted px-1 text-text">D:\自媒体之路\server\.env</code>:{' '}
                <code className="num rounded bg-surface-muted px-1 text-text">YOUTUBE_API_KEY=你的key</code>
              </li>
              <li>重启后端服务</li>
            </ol>
            <p className="flex items-start gap-1.5 text-warning">
              <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                每天免费额度 <span className="num">10,000</span> 单位，足够日常使用。
              </span>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
