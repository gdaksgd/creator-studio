import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderPlus, Heart, Plus, Search, Trash2 } from 'lucide-react';
import { CATEGORIES, categoryLabel } from '../config/categories';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '../components/ui/Input';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { useToast } from '../components/ui/Toast';
import { useAssetStore } from '../store/assetStore';
import { useScriptStore } from '../store/scriptStore';
import type { LibraryAssetType } from '../types';

const TYPE_LABELS: Record<LibraryAssetType, string> = {
  image: '图片', video: '视频', audio: '音频', link: '网页链接', document: '文档',
};
const TYPE_OPTIONS = Object.entries(TYPE_LABELS) as Array<[LibraryAssetType, string]>;

function inferType(url: string): LibraryAssetType {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return 'image';
  if (/\.(mp4|mov|webm|m3u8)$/.test(path) || /bilibili\.com|youtube\.com|youtu\.be|douyin\.com/.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)$/.test(path)) return 'audio';
  if (/\.(pdf|docx?|pptx?|xlsx?)$/.test(path)) return 'document';
  return 'link';
}

export default function MaterialLibrary() {
  const { assets, loading, loadAssets, addAsset, updateAsset, deleteAsset, touchAsset } = useAssetStore();
  const scripts = useScriptStore((state) => state.scripts);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | LibraryAssetType>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [folderFilter, setFolderFilter] = useState('all');
  const [scriptFilter, setScriptFilter] = useState('all');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'updated' | 'used' | 'created'>('updated');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [organizingAsset, setOrganizingAsset] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [scriptDraft, setScriptDraft] = useState('');
  const [form, setForm] = useState({ title: '', type: 'link' as LibraryAssetType, url: '', category: CATEGORIES[0]?.id ?? 'general', tags: '', note: '' });

  useEffect(() => { void loadAssets(); void useScriptStore.getState().loadScripts(); }, [loadAssets]);
  useEffect(() => {
    const handleFocus = () => void loadAssets();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadAssets]);

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return assets.filter((asset) => {
      if (typeFilter !== 'all' && asset.type !== typeFilter) return false;
      if (categoryFilter !== 'all' && asset.category !== categoryFilter) return false;
      if (folderFilter !== 'all' && (asset.folder || '未分组') !== folderFilter) return false;
      if (scriptFilter === 'unlinked' && asset.relatedScriptId) return false;
      if (scriptFilter !== 'all' && scriptFilter !== 'unlinked' && asset.relatedScriptId !== scriptFilter) return false;
      if (favoriteOnly && !asset.favorite) return false;
      if (!needle) return true;
      return `${asset.title} ${asset.url} ${asset.note} ${asset.tags.join(' ')}`.toLocaleLowerCase().includes(needle);
    }).sort((a, b) => {
      if (favoriteOnly && !!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      if (sortMode === 'used') return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || b.updatedAt - a.updatedAt;
      if (sortMode === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
  }, [assets, categoryFilter, favoriteOnly, folderFilter, query, scriptFilter, sortMode, typeFilter]);
  const folders = useMemo(() => [...new Set(assets.map((asset) => asset.folder || '未分组'))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [assets]);

  const openAddForm = () => {
    setForm({ title: '', type: 'link', url: '', category: CATEGORIES[0]?.id ?? 'general', tags: '', note: '' });
    setShowForm(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const url = form.url.trim();
    if (!url) return;
    try { new URL(url); } catch { toast.error('请输入有效的完整 URL（需包含 https://）'); return; }
    setSaving(true);
    try {
      await addAsset({
        title: form.title.trim() || url,
        type: form.type,
        url,
        category: form.category,
        tags: [...new Set(form.tags.split(/[，,\n]/).map((tag) => tag.trim()).filter(Boolean))],
        note: form.note.trim(),
        folder: '默认收藏夹',
      });
      toast.success('素材已收藏到本机素材库');
      setShowForm(false);
    } catch (error) {
      toast.error((error as Error).message || '保存素材失败');
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-5">
    <PageHeader eyebrow="创作台 / LIBRARY" title="素材库" description="收藏、检索和复用参考素材链接；数据保存在本机，并随账号同步。" actions={<Button onClick={openAddForm}><Plus className="h-4 w-4" />收藏素材</Button>} />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card padding="md"><p className="eyebrow">收藏总数</p><p className="num mt-2 text-2xl font-semibold text-text">{assets.length}</p></Card>
      {TYPE_OPTIONS.slice(0, 3).map(([type, label]) => <Card key={type} padding="md"><p className="eyebrow">{label}</p><p className="num mt-2 text-2xl font-semibold text-text">{assets.filter((asset) => asset.type === type).length}</p></Card>)}
    </div>
    <Card padding="md" className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="relative min-w-0 flex-1"><span className="sr-only">搜索素材</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><Input className="pl-9" type="search" placeholder="搜索名称、标签、备注或链接…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <Select className="sm:w-36" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | LibraryAssetType)}><option value="all">全部类型</option>{TYPE_OPTIONS.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</Select>
      <Select className="sm:w-44" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">全部品类</option>{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</Select>
      <Select className="sm:w-40" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}><option value="all">全部收藏夹</option>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</Select>
      <Select className="sm:w-44" value={scriptFilter} onChange={(event) => setScriptFilter(event.target.value)}><option value="all">全部脚本</option><option value="unlinked">未关联脚本</option>{scripts.map((script) => <option key={script.id} value={script.id}>{script.title || '无标题脚本'}</option>)}</Select>
      <Select className="sm:w-36" value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}><option value="updated">最近更新</option><option value="used">最近使用</option><option value="created">最近收藏</option></Select>
      <Button size="sm" variant={favoriteOnly ? 'soft' : 'ghost'} onClick={() => setFavoriteOnly((value) => !value)}><Heart className={`h-3.5 w-3.5 ${favoriteOnly ? 'fill-current' : ''}`}/>{favoriteOnly ? '只看收藏' : '收藏筛选'}</Button>
    </Card>

    {loading ? <Card padding="lg"><p className="text-sm text-text-muted">正在读取素材库…</p></Card> : filteredAssets.length === 0 ? <EmptyState title={assets.length ? '没有符合筛选条件的素材' : '素材库还是空的'} description={assets.length ? '调整搜索词或筛选条件，或者清除筛选。' : '从素材工坊收藏推荐链接，或手动添加图片、视频、音频与文档链接。'} action={assets.length ? <Button variant="secondary" onClick={() => { setQuery(''); setTypeFilter('all'); setCategoryFilter('all'); }}>清除筛选</Button> : <Button onClick={openAddForm}><Plus className="h-4 w-4" />添加第一条素材</Button>} /> : <section>
      <SectionHeading title="已收藏素材" hint={`${filteredAssets.length} / ${assets.length} 条`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filteredAssets.map((asset) => <Card key={asset.id} padding="md" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-1.5"><Badge variant="primary" size="sm">{TYPE_LABELS[asset.type]}</Badge><Badge variant="neutral" size="sm">{categoryLabel(asset.category)}</Badge></div><h3 className="mt-2 truncate text-sm font-semibold text-text" title={asset.title}>{asset.title}</h3></div><button type="button" onClick={() => setDeleteTarget(asset.id)} className="rounded-lg p-1.5 text-text-muted hover:bg-danger-soft hover:text-danger" aria-label={`删除素材 ${asset.title}`}><Trash2 className="h-4 w-4" /></button></div>
          {asset.note && <p className="line-clamp-3 text-xs leading-relaxed text-text-secondary">{asset.note}</p>}
          {asset.tags.length > 0 && <div className="flex flex-wrap gap-1">{asset.tags.map((tag) => <Badge key={tag} variant="outline" size="sm">#{tag}</Badge>)}</div>}
            <p className="text-[10px] text-text-muted">{asset.folder || '未分组'}{asset.relatedScriptId ? ` · ${scripts.find((script) => script.id === asset.relatedScriptId)?.title || '已关联脚本'}` : ''}{asset.lastUsedAt ? ` · 最近使用 ${new Date(asset.lastUsedAt).toLocaleDateString('zh-CN')}` : ''}</p>
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2"><span className="truncate text-[10px] text-text-muted" title={asset.url}>{new URL(asset.url).hostname}</span><div className="flex items-center gap-1"><button type="button" onClick={() => void updateAsset(asset.id, { favorite: !asset.favorite })} className={`rounded-md p-1.5 ${asset.favorite ? 'text-danger' : 'text-text-muted hover:text-danger'}`} title={asset.favorite ? '取消收藏' : '标记收藏'} aria-label={asset.favorite ? '取消收藏' : '标记收藏'}><Heart className={`h-3.5 w-3.5 ${asset.favorite ? 'fill-current' : ''}`}/></button><button type="button" onClick={() => { setOrganizingAsset(asset.id); setFolderDraft(asset.folder || ''); setScriptDraft(asset.relatedScriptId || ''); }} className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-primary" title="收藏夹与脚本关联"><FolderPlus className="h-3.5 w-3.5" /></button><a href={asset.url} target="_blank" rel="noopener noreferrer" onClick={() => void touchAsset(asset.id)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft"><ExternalLink className="h-3.5 w-3.5" />打开来源</a></div></div>
        </Card>)}
      </div>
    </section>}

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><Card padding="none" className="w-full max-w-xl overflow-hidden"><form onSubmit={(event) => void handleSave(event)}><div className="border-b border-border px-5 py-4"><h2 className="text-base font-semibold text-text">收藏到素材库</h2><p className="mt-1 text-xs text-text-muted">只保存引用链接与说明，不会把外部文件上传到服务器。</p></div><div className="space-y-4 px-5 py-4"><Field label="素材链接" required hint="支持图片、视频、音频、文档和网页链接"><Input autoFocus type="url" required value={form.url} onChange={(event) => { const url = event.target.value; const type = inferType(url); setForm((current) => ({ ...current, url, type: current.type === 'link' ? type : current.type })); }} placeholder="https://…" /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="名称"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="便于之后搜索的名称" /></Field><Field label="素材类型"><Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as LibraryAssetType })}>{TYPE_OPTIONS.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</Select></Field><Field label="关联品类"><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</Select></Field><Field label="标签" hint="逗号分隔"><Input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="封面参考, UI, 音乐" /></Field></div><Field label="备注"><Textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="来源、使用场景、授权说明或灵感备注…" /></Field></div><div className="flex justify-end gap-2 border-t border-border bg-surface-muted/40 px-5 py-3"><Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button><Button type="submit" size="sm" loading={saving}>保存素材</Button></div></form></Card></div>}
    <Modal open={!!organizingAsset} onClose={() => setOrganizingAsset(null)} title="素材复用设置" description="加入收藏夹或关联到脚本，便于创作时回找。" size="sm" footer={<><Button size="sm" variant="ghost" onClick={() => setOrganizingAsset(null)}>取消</Button><Button size="sm" onClick={() => { if (organizingAsset) void updateAsset(organizingAsset, { folder: folderDraft.trim() || undefined, relatedScriptId: scriptDraft || undefined }).then(() => { setOrganizingAsset(null); toast.success('素材归类已更新'); }); }}>保存</Button></>}>
      <div className="space-y-3"><Field label="收藏夹"><Input list="asset-folders" value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} placeholder="例如：赛博朋克 UI / BGM 灵感" /><datalist id="asset-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist></Field><Field label="关联脚本" hint="选填，可之后变更"><Select value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)}><option value="">不关联</option>{scripts.map((script) => <option key={script.id} value={script.id}>{script.title || '无标题脚本'} · {script.platform === 'bilibili' ? 'B站' : '抖音'}</option>)}</Select></Field></div>
    </Modal>
    <ConfirmDialog open={!!deleteTarget} title="从素材库删除？" description="删除收藏记录不会影响原始链接或文件。" confirmLabel="删除收藏" onConfirm={() => { if (deleteTarget) void deleteAsset(deleteTarget).then(() => { setDeleteTarget(null); toast.success('已从素材库删除'); }); }} onClose={() => setDeleteTarget(null)} />
  </div>;
}
