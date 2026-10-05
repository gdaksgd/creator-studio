import { useEffect, useState } from 'react';
import { api, type AccountInfo } from '../api/client';
import { manualSync } from '../services/syncService';

export default function Settings() {
  const [aiConfigured, setAiConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<boolean | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
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
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-text mb-6">设置</h1>

      {/* AI 配置状态 */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-5">
        <h2 className="text-sm font-bold text-text mb-3">AI 配置状态</h2>
        <div className={`flex items-center gap-2 p-3 rounded-lg ${
          aiConfigured ? 'bg-green-50' : 'bg-amber-50'
        }`}>
          <span className={`w-2 h-2 rounded-full ${aiConfigured ? 'bg-green-500' : 'bg-amber-500'}`} />
          <span className={`text-sm font-medium ${aiConfigured ? 'text-green-800' : 'text-amber-800'}`}>
            {aiConfigured ? 'AI 已连接 (DeepSeek)' : 'AI 未配置'}
          </span>
        </div>
        {!aiConfigured && (
          <div className="mt-3 text-xs text-text-secondary space-y-2">
            <p className="font-medium text-text">配置步骤：</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>注册 DeepSeek 平台账号: <a href="https://platform.deepseek.com/" target="_blank" rel="noopener" className="text-primary hover:underline">platform.deepseek.com</a></li>
              <li>在 API Keys 页面创建一个新的 Key</li>
              <li>打开 <code className="bg-gray-100 px-1 rounded">D:\自媒体之路\server\.env</code> 文件</li>
              <li>填入: <code className="bg-gray-100 px-1 rounded">DEEPSEEK_API_KEY=你的key</code></li>
              <li>重启后端服务器（双击 start-dev.bat）</li>
            </ol>
          </div>
        )}
      </section>

      {/* YouTube API 配置 */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-5">
        <h2 className="text-sm font-bold text-text mb-3">YouTube Data API</h2>
        <div className="text-xs text-text-secondary space-y-2">
          <p>YouTube API 用于收集恐怖游戏热门视频。配置步骤：</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>打开 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener" className="text-primary hover:underline">Google Cloud Console</a></li>
            <li>创建一个新项目（或选择已有项目）</li>
            <li>在「API 和服务」中启用「YouTube Data API v3」</li>
            <li>在「凭据」中创建 API Key</li>
            <li>填入 <code className="bg-gray-100 px-1 rounded">D:\自媒体之路\server\.env</code> 文件: <code className="bg-gray-100 px-1 rounded">YOUTUBE_API_KEY=你的key</code></li>
            <li>重启后端服务器</li>
          </ol>
          <p className="mt-2 text-amber-600">注意: 每天免费额度 10,000 单位，足够日常使用。</p>
        </div>
      </section>

      {/* 账号绑定配置 */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-5">
        <h2 className="text-sm font-bold text-text mb-1">账号绑定</h2>
        <p className="text-xs text-text-secondary mb-4">
          填写B站UID和抖音号后，系统每天自动同步账号数据。详细数据分析请前往
          <a href="/analytics" className="text-primary hover:underline ml-1">数据看板</a>。
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="block">
            <span className="text-xs font-medium text-text">B站 UID</span>
            <input
              type="text"
              value={form.bilibiliUid || ''}
              onChange={(e) => setForm({ ...form, bilibiliUid: e.target.value })}
              placeholder="例如: 289518100"
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {form.bilibiliName && (
              <span className="text-xs text-green-600 mt-1 block">✓ {form.bilibiliName}</span>
            )}
          </label>

          <label className="block">
            <span className="text-xs font-medium text-text">抖音号</span>
            <input
              type="text"
              value={form.douyinId || ''}
              onChange={(e) => setForm({ ...form, douyinId: e.target.value })}
              placeholder="例如: zgbwngbd"
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="block">
            <span className="text-xs font-medium text-text">内容方向</span>
            <input
              type="text"
              value={form.contentFocus}
              onChange={(e) => setForm({ ...form, contentFocus: e.target.value })}
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-text">活跃天数</span>
            <input
              type="number"
              value={form.daysActive}
              onChange={(e) => setForm({ ...form, daysActive: Number(e.target.value) })}
              className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
          {saved && <span className="text-xs text-green-600">✓ 已保存</span>}
        </div>
      </section>

      {/* 云端同步 */}
      <section className="bg-surface border border-border rounded-xl p-5 mb-5">
        <h2 className="text-sm font-bold text-text mb-1">云端同步</h2>
        <p className="text-xs text-text-secondary mb-4">
          数据自动同步到云端，换设备时可恢复。修改数据后5秒自动上传。
        </p>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
            syncStatus ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <span className={`w-2 h-2 rounded-full ${syncStatus ? 'bg-green-500' : 'bg-gray-400'}`} />
            {syncStatus ? '云端同步已启用' : '云端同步未配置'}
          </div>
          <button
            onClick={handleManualSync}
            disabled={syncing || !syncStatus}
            className="px-4 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {syncing ? '同步中...' : '手动同步'}
          </button>
          {syncMessage && <span className="text-xs text-green-600">{syncMessage}</span>}
        </div>
      </section>
    </div>
  );
}
