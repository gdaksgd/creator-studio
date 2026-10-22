import {
  Clapperboard,
  CodeXml,
  FileChartColumn,
  FileText,
  FileUser,
  FlaskConical,
  LayoutDashboard,
  Library,
  Mail,
  Megaphone,
  Package,
  RefreshCw,
  ShieldCheck,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CONTACT } from '../config/contact';

/**
 * 关于 / 项目介绍 —— 详细介绍页：门户页（/welcome）的「3 分钟导读」和侧边栏「关于本站」都到这里。
 * 这个应用本身是工具界面，没有这一页的话，访客不知道该看什么、也不知道作者是谁。
 */

interface TourStop {
  id: string;
  to: string;
  title: string;
  why: string;
  Icon: LucideIcon;
}

/** 与「这个项目是什么」里的生产顺序保持一致：选题 → 脚本 → 适配 → 成片任务 → 工件/媒体包 → 发布校准 → 复盘。 */
const TOUR: TourStop[] = [
  {
    id: 'topic',
    to: '/',
    title: '选题评估',
    why: '先看选题池与评估：品类播放分位、互动率水位线、竞争强度；样本不足的品类直接标缺口，不插值。',
    Icon: Target,
  },
  {
    id: 'script',
    to: '/scripts',
    title: '分镜脚本',
    why: '把标题、开场钩子、逐镜时长与画面方向写成可拍脚本；每个平台/版本对应一个明确的生产动作。',
    Icon: FileText,
  },
  {
    id: 'fit',
    to: '/scripts',
    title: '平台适配',
    why: '打开脚本里的平台适配检查：B站 / 抖音分别给结论，每条建议带出处与 A/B/C 证据分级。',
    Icon: ShieldCheck,
  },
  {
    id: 'run',
    to: '/runs',
    title: '成片任务：预检 / 素材授权 / 配音字幕 / 复核',
    why: '创建任务锁定脚本快照，跑发布前检查；逐镜关联素材与授权，生成配音字幕，最后人工复核。有阻塞项就不能导出。',
    Icon: Clapperboard,
  },
  {
    id: 'artifacts',
    to: '/runs',
    title: '阶段工件 / 媒体包',
    why: '在任务详情单独下载 5 个阶段工件，或导出含 voiceover.mp3 / subtitles.srt 的媒体包；没有 TTS worker 就阻塞，不伪造音频。',
    Icon: Package,
  },
  {
    id: 'publish',
    to: '/runs',
    title: '发布回填与校准',
    why: '在任务详情绑定发布记录，核对真实播放/互动与预测偏差；绑定记录只在本机，不改云端发布记录。',
    Icon: RefreshCw,
  },
  {
    id: 'retro',
    to: '/experiments',
    title: '复盘实验',
    why: '回到内容实验，按单一变量、分组观察和样本门槛复盘；样本不足时工具拒绝给出「成功」结论。',
    Icon: FlaskConical,
  },
];

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="关于 / 项目介绍"
        title="3 分钟了解这个项目"
        description="这是一个内容工作台：从选题、脚本到成片任务、配音字幕、复核交接与发布校准，把内容判断和发布门禁沉淀成一套可复核的工作流。下面是推荐的浏览顺序。"
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={() => navigate('/runs')}>
              <Clapperboard className="h-4 w-4" aria-hidden="true" />
              从成片任务开始
            </Button>
            <Button size="lg" onClick={() => navigate('/')}>
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              进入工作台
            </Button>
          </>
        }
      />

      <Card padding="lg" className="space-y-4">
        <SectionHeading title="推荐浏览路线" hint="时间紧先看 1 → 2 → 4" />
        <ol className="space-y-3">
          {TOUR.map((stop, index) => (
            <li key={stop.id} className="flex gap-3 rounded-xl border border-border bg-surface-muted/30 p-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div className="min-w-0">
                <Link
                  to={stop.to}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  <stop.Icon className="h-4 w-4" aria-hidden="true" />
                  {stop.title}
                </Link>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{stop.why}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="rounded-xl border border-border bg-surface-muted/20 p-3">
          <p className="text-xs font-medium text-text">跨流程入口</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
            这些不是线性流程中的一步，随时可以从侧边栏或这里打开。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              to="/library"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
            >
              <Library className="h-3.5 w-3.5" aria-hidden="true" />
              素材库与版权
            </Link>
            <Link
              to="/report"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
            >
              <FileChartColumn className="h-3.5 w-3.5" aria-hidden="true" />
              分析报告
            </Link>
            <Link
              to="/marketing-briefs"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-hover"
            >
              <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
              版本营销简报
            </Link>
          </div>
        </div>
      </Card>

      <Card padding="lg" className="space-y-3">
        <SectionHeading title="这个项目是什么" />
        <ul className="space-y-2 text-sm leading-relaxed text-text-secondary">
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium text-text">本地优先的创作工作台</span>：选题评估 → 分镜脚本 → 平台适配 → 成片任务（预检 / 素材授权 / 配音字幕 / 复核）→ 阶段工件或媒体包 → 发布回填与校准 → 复盘实验。</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium text-text">数据诚实是设计原则</span>：预测偏差与真实播放对照、演示数据明确标注、目标值与实绩严格分开、样本不足不下结论；成本未记录时显示「未记录」，不补 0。</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium text-text">技术栈</span>：React 19 + TypeScript + Vite + Dexie（IndexedDB，v10）+ Express 后端 + Supabase 云同步；配音通过可选的本地 Python Edge TTS worker 生成，媒体只存本机。</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span>当前页面展示的是<span className="text-text">演示数据</span>（选题池 9 个、脚本 6 份、成片任务 1 条、简报 2 份、实验 2 个，均标注「演示」）；注册登录后会获得独立于演示数据的账号空间。</span>
          </li>
        </ul>
      </Card>

      <Card padding="lg" className="space-y-3">
        <SectionHeading title="联系我" hint="源码与 README 在 GitHub" />
        <p className="text-sm font-semibold text-text">{CONTACT.name}</p>
        <div className="flex flex-wrap gap-2.5">
          <a
            href={CONTACT.github}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
          >
            <CodeXml className="h-4 w-4" aria-hidden="true" />
            GitHub · {CONTACT.displayName}
          </a>
          {CONTACT.email && (
            <a
              href={`mailto:${CONTACT.email}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {CONTACT.email}
            </a>
          )}
          {CONTACT.resumeUrl && (
            <a
              href={CONTACT.resumeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
            >
              <FileUser className="h-4 w-4" aria-hidden="true" />
              更多资料
            </a>
          )}
        </div>
        <p className="text-xs leading-relaxed text-text-muted">
          本站所有演示数据仅用于展示功能形态，不构成任何项目实绩；简报与实验模块会在显著位置标注「演示案例 / 非实绩」。
        </p>
      </Card>
    </div>
  );
}
