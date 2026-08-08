import { useEffect, useState, useMemo } from 'react';
import { api, type AccountInfo, type SyncResult, type SyncHistoryEntry } from '../api/client';

// ─── Chart Components ──────────────────────────────────────

/** Line chart for trend data */
function TrendChart({ data, labels, color, height = 160 }: {
  data: number[];
  labels: string[];
  color: string;
  height?: number;
}) {
  const width = 520;
  const pad = { top: 20, right: 16, bottom: 28, left: 40 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const range = maxVal - minVal || 1;

  const points = data.map((v, i) => {
    const x = pad.left + (data.length === 1 ? chartW / 2 : (i / (data.length - 1)) * chartW);
    const y = pad.top + chartH - ((v - minVal) / range) * chartH;
    return { x, y, value: v };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${pad.top + chartH} L ${points[0].x} ${pad.top + chartH} Z`
    : '';

  // Y-axis labels (3 ticks)
  const yTicks = [0, 0.5, 1].map(t => {
    const val = minVal + range * t;
    const y = pad.top + chartH - t * chartH;
    return { y, val: Math.round(val) };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height }}>
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.left} y1={t.y} x2={width - pad.right} y2={t.y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
          <text x={pad.left - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{t.val}</text>
        </g>
      ))}
      {/* Area */}
      {areaPath && <path d={areaPath} fill={`url(#grad-${color.replace('#', '')})`} />}
      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill="white" stroke={color} strokeWidth="2" />
          {data.length <= 10 && (
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="10" fill="#6b7280" fontWeight="600">{p.value}</text>
          )}
        </g>
      ))}
      {/* X-axis labels */}
      {labels.map((label, i) => {
        const x = data.length === 1 ? pad.left + chartW / 2 : pad.left + (i / (data.length - 1)) * chartW;
        return (
          <text key={i} x={x} y={height - 8} textAnchor="middle" fontSize="10" fill="#9ca3af">{label}</text>
        );
      })}
    </svg>
  );
}

/** Horizontal bar comparison */
function ComparisonBars({ items }: {
  items: { label: string; bili: number; douyin: number; unit?: string }[];
}) {
  const maxVal = Math.max(...items.flatMap(i => [i.bili, i.douyin]), 1);

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-text">{item.label}</span>
            <span className="text-text-secondary">{item.unit || ''}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-pink-600 w-8 text-right font-medium">B站</span>
              <div className="flex-1 h-5 bg-gray-100 rounded relative overflow-hidden">
                <div
                  className="h-full rounded bg-gradient-to-r from-pink-400 to-pink-500 flex items-center justify-end pr-2 transition-all duration-500"
                  style={{ width: `${(item.bili / maxVal) * 100}%` }}
                >
                  <span className="text-[10px] text-white font-bold">{item.bili.toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-700 w-8 text-right font-medium">抖音</span>
              <div className="flex-1 h-5 bg-gray-100 rounded relative overflow-hidden">
                <div
                  className="h-full rounded bg-gradient-to-r from-gray-700 to-gray-900 flex items-center justify-end pr-2 transition-all duration-500"
                  style={{ width: `${(item.douyin / maxVal) * 100}%` }}
                >
                  <span className="text-[10px] text-white font-bold">{item.douyin.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stat card */
function StatCard({ label, value, sublabel, accent }: {
  label: string;
  value: string | number;
  sublabel?: string;
  accent: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="text-xs text-text-secondary mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color: accent }}>{value}</div>
      {sublabel && <div className="text-[10px] text-text-secondary mt-1">{sublabel}</div>}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────

export default function Analytics() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [history, setHistory] = useState<SyncHistoryEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [editingDouyin, setEditingDouyin] = useState(false);
  const [douyinForm, setDouyinForm] = useState({ followers: 0, avgViews: 0, totalVideos: 0, totalLikes: 0 });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'bilibili' | 'douyin'>('overview');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [status, hist] = await Promise.all([
        api.getStatus(),
        api.getSyncHistory(),
      ]);
      setAccount(status.accountInfo);
      setHistory(hist);
      setDouyinForm({
        followers: status.accountInfo.douyinFollowers || 0,
        avgViews: status.accountInfo.douyinAvgViews || 0,
        totalVideos: status.accountInfo.douyinTotalVideos || 0,
        totalLikes: status.accountInfo.douyinTotalLikes || 0,
      });
    } catch (err) {
      console.error('Failed to load analytics:', err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.syncAccount();
      setSyncResult(result);
      setAccount(result.accountInfo);
      const hist = await api.getSyncHistory();
      setHistory(hist);
    } catch (err) {
      alert('同步失败: ' + (err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveDouyin = async () => {
    setSaving(true);
    try {
      const updated = await api.updateAccount({
        douyinFollowers: douyinForm.followers,
        douyinAvgViews: douyinForm.avgViews,
        douyinTotalVideos: douyinForm.totalVideos,
        douyinTotalLikes: douyinForm.totalLikes,
      });
      setAccount(updated);
      setEditingDouyin(false);
    } catch (err) {
      alert('保存失败: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const formatSyncTime = (ts?: number) => {
    if (!ts) return '从未同步';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  // Chart data from history
  const chartData = useMemo(() => {
    const recent = history.slice(-15);
    const labels = recent.map(h => {
      const d = new Date(h.timestamp);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    });
    return {
      labels,
      biliFollowers: recent.map(h => h.bilibiliFollowers),
      biliAvgViews: recent.map(h => h.bilibiliAvgViews),
      biliLikes: recent.map(h => h.bilibiliTotalLikes),
      douyinFollowers: recent.map(h => h.douyinFollowers),
      douyinAvgViews: recent.map(h => h.douyinAvgViews),
    };
  }, [history]);

  if (!account) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-text-secondary text-sm">加载中...</div>
      </div>
    );
  }

  const totalFollowers = account.bilibiliFollowers + account.douyinFollowers;
  const totalLikes = (account.bilibiliTotalLikes || 0) + (account.douyinTotalLikes || 0);
  const totalVideos = account.totalVideos + (account.douyinTotalVideos || 0);
  const totalAvgViews = account.bilibiliAvgViews + account.douyinAvgViews;

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">数据看板</h1>
          <p className="text-xs text-text-secondary mt-1">
            上次同步: {formatSyncTime(account.lastSyncAt)}
            {account.syncMessage && ` | ${account.syncMessage.slice(0, 60)}`}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {syncing ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              同步中...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-9-9c2.5 0 4.5 1 6 2.5L21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              立即同步
            </>
          )}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`p-3 rounded-lg mb-5 text-xs ${syncResult.success ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
          <span className="font-medium">{syncResult.success ? '✅ 同步完成' : '⚠️ 同步部分失败'}</span>
          {syncResult.syncedFields.length > 0 && ` — 已更新: ${syncResult.syncedFields.join('、')}`}
          {syncResult.failedFields.length > 0 && ` | 未更新: ${syncResult.failedFields.join('；')}`}
        </div>
      )}

      {/* Tab selector */}
      <div className="flex gap-1 mb-6 bg-surface border border-border rounded-lg p-1 w-fit">
        {([
          { key: 'overview', label: '总览', icon: '📊' },
          { key: 'bilibili', label: 'B站', icon: '📺' },
          { key: 'douyin', label: '抖音', icon: '🎵' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-primary text-white'
                : 'text-text-secondary hover:text-text hover:bg-gray-50'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Combined stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="总粉丝数" value={totalFollowers.toLocaleString()} sublabel="B站 + 抖音" accent="#7c3aed" />
            <StatCard label="总视频数" value={totalVideos.toLocaleString()} sublabel="已发布" accent="#059669" />
            <StatCard label="总获赞数" value={totalLikes.toLocaleString()} sublabel="B站 + 抖音" accent="#d97706" />
            <StatCard label="平均播放量" value={totalAvgViews.toLocaleString()} sublabel="两平台合计" accent="#dc2626" />
          </div>

          {/* Platform comparison */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">平台数据对比</h2>
            <ComparisonBars items={[
              { label: '粉丝数', bili: account.bilibiliFollowers, douyin: account.douyinFollowers, unit: '人' },
              { label: '平均播放量', bili: account.bilibiliAvgViews, douyin: account.douyinAvgViews, unit: '次' },
              { label: '视频数', bili: account.totalVideos, douyin: account.douyinTotalVideos || 0, unit: '个' },
              { label: '总获赞', bili: account.bilibiliTotalLikes || 0, douyin: account.douyinTotalLikes || 0, unit: '个' },
            ]} />
          </section>

          {/* Account info summary */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">账号信息</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-text-secondary block">内容方向</span>
                <span className="text-text font-medium">{account.contentFocus}</span>
              </div>
              <div>
                <span className="text-xs text-text-secondary block">活跃天数</span>
                <span className="text-text font-medium">{account.daysActive} 天</span>
              </div>
              <div>
                <span className="text-xs text-text-secondary block">B站账号</span>
                <span className="text-text font-medium">{account.bilibiliName || '未配置'}</span>
              </div>
              <div>
                <span className="text-xs text-text-secondary block">B站 UID</span>
                <span className="text-text font-medium">{account.bilibiliUid || '未配置'}</span>
              </div>
              <div>
                <span className="text-xs text-text-secondary block">抖音号</span>
                <span className="text-text font-medium">{account.douyinId || '未配置'}</span>
              </div>
              <div>
                <span className="text-xs text-text-secondary block">抖音名称</span>
                <span className="text-text font-medium">{account.douyinName || '未填写'}</span>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ─── Bilibili Tab ─── */}
      {activeTab === 'bilibili' && (
        <div className="space-y-6">
          {/* B站 stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="粉丝数" value={account.bilibiliFollowers.toLocaleString()} sublabel={account.bilibiliName || ''} accent="#e8367c" />
            <StatCard label="视频数" value={account.totalVideos.toLocaleString()} sublabel="已发布" accent="#e8367c" />
            <StatCard label="总获赞" value={(account.bilibiliTotalLikes || 0).toLocaleString()} sublabel="累计" accent="#e8367c" />
            <StatCard label="平均播放" value={account.bilibiliAvgViews.toLocaleString()} sublabel="近30条视频" accent="#e8367c" />
          </div>

          {/* Follower trend */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">粉丝增长趋势</h2>
            {chartData.biliFollowers.length > 0 ? (
              <TrendChart data={chartData.biliFollowers} labels={chartData.labels} color="#e8367c" />
            ) : (
              <div className="py-12 text-center text-sm text-text-secondary">
                暂无历史数据，点击「立即同步」开始记录
              </div>
            )}
          </section>

          {/* Avg views trend */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">平均播放量趋势</h2>
            {chartData.biliAvgViews.length > 0 ? (
              <TrendChart data={chartData.biliAvgViews} labels={chartData.labels} color="#f59e0b" />
            ) : (
              <div className="py-12 text-center text-sm text-text-secondary">暂无历史数据</div>
            )}
          </section>

          {/* Likes trend */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">总获赞趋势</h2>
            {chartData.biliLikes.length > 0 ? (
              <TrendChart data={chartData.biliLikes} labels={chartData.labels} color="#10b981" />
            ) : (
              <div className="py-12 text-center text-sm text-text-secondary">暂无历史数据</div>
            )}
          </section>

          {/* B站 sync info */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-pink-500" />
              <h2 className="text-sm font-bold text-text">B站同步状态</h2>
            </div>
            <div className="text-xs text-text-secondary space-y-2">
              <p>UID: {account.bilibiliUid || '未配置'}</p>
              <p>账号名: {account.bilibiliName || '未同步'}</p>
              <p>上次同步: {formatSyncTime(account.lastSyncAt)}</p>
              <p className="text-[11px] text-text-secondary/70 mt-2">
                B站数据通过 card API 自动获取（粉丝数、视频数、点赞数）。视频列表API可能因风控限制偶尔失败，平均播放量将保留上次成功值。
              </p>
            </div>
          </section>
        </div>
      )}

      {/* ─── Douyin Tab ─── */}
      {activeTab === 'douyin' && (
        <div className="space-y-6">
          {/* 抖音 stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="粉丝数" value={account.douyinFollowers.toLocaleString()} sublabel={account.douyinName || ''} accent="#1a1a1a" />
            <StatCard label="视频数" value={(account.douyinTotalVideos || 0).toLocaleString()} sublabel="已发布" accent="#1a1a1a" />
            <StatCard label="总获赞" value={(account.douyinTotalLikes || 0).toLocaleString()} sublabel="累计" accent="#1a1a1a" />
            <StatCard label="平均播放" value={account.douyinAvgViews.toLocaleString()} sublabel="估算" accent="#1a1a1a" />
          </div>

          {/* Follower trend */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">粉丝增长趋势</h2>
            {chartData.douyinFollowers.length > 0 ? (
              <TrendChart data={chartData.douyinFollowers} labels={chartData.labels} color="#1a1a1a" />
            ) : (
              <div className="py-12 text-center text-sm text-text-secondary">
                暂无历史数据，同步后会自动记录
              </div>
            )}
          </section>

          {/* Avg views trend */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <h2 className="text-sm font-bold text-text mb-4">平均播放量趋势</h2>
            {chartData.douyinAvgViews.length > 0 ? (
              <TrendChart data={chartData.douyinAvgViews} labels={chartData.labels} color="#8b5cf6" />
            ) : (
              <div className="py-12 text-center text-sm text-text-secondary">暂无历史数据</div>
            )}
          </section>

          {/* Manual data entry */}
          <section className="bg-surface border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-gray-800" />
                <h2 className="text-sm font-bold text-text">抖音数据管理</h2>
              </div>
              {!editingDouyin && (
                <button
                  onClick={() => setEditingDouyin(true)}
                  className="text-xs text-primary hover:underline"
                >
                  编辑数据
                </button>
              )}
            </div>

            <div className="p-3 bg-amber-50 rounded-lg mb-4 text-xs text-amber-700">
              抖音因反爬机制暂不支持自动获取数据。每次同步时，系统会自动保存当前手动填写的数据到历史记录中，用于趋势追踪。
            </div>

            {editingDouyin ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-medium text-text">粉丝数</span>
                    <input
                      type="number"
                      value={douyinForm.followers}
                      onChange={(e) => setDouyinForm({ ...douyinForm, followers: Number(e.target.value) })}
                      className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-text">平均播放量</span>
                    <input
                      type="number"
                      value={douyinForm.avgViews}
                      onChange={(e) => setDouyinForm({ ...douyinForm, avgViews: Number(e.target.value) })}
                      className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-text">视频数</span>
                    <input
                      type="number"
                      value={douyinForm.totalVideos}
                      onChange={(e) => setDouyinForm({ ...douyinForm, totalVideos: Number(e.target.value) })}
                      className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-text">总获赞</span>
                    <input
                      type="number"
                      value={douyinForm.totalLikes}
                      onChange={(e) => setDouyinForm({ ...douyinForm, totalLikes: Number(e.target.value) })}
                      className="w-full mt-1 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveDouyin}
                    disabled={saving}
                    className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                  <button
                    onClick={() => {
                      setEditingDouyin(false);
                      setDouyinForm({
                        followers: account.douyinFollowers || 0,
                        avgViews: account.douyinAvgViews || 0,
                        totalVideos: account.douyinTotalVideos || 0,
                        totalLikes: account.douyinTotalLikes || 0,
                      });
                    }}
                    className="px-4 py-2 border border-border text-text rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-text-secondary block">抖音号</span>
                  <span className="text-text font-medium">{account.douyinId || '未配置'}</span>
                </div>
                <div>
                  <span className="text-xs text-text-secondary block">上次同步</span>
                  <span className="text-text font-medium">{formatSyncTime(account.lastSyncAt)}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
