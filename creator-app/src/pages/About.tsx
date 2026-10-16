import {
  CodeXml,
  FileChartColumn,
  FileText,
  FileUser,
  FlaskConical,
  LayoutDashboard,
  Mail,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, SectionHeading } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CONTACT } from '../config/contact';

/**
 * 关于 / 项目介绍 —— 第一次打开站点的访客默认先看到这一页（见 utils/firstVisit.ts）。
 * 这个应用本身是工具界面，没有这一页的话，访客不知道该看什么、也不知道作者是谁。
 */

interface TourStop {
  to: string;
  title: string;
  why: string;
  Icon: LucideIcon;
}

const TOUR: TourStop[] = [
  {
    to: '/marketing-briefs',
    title: '版本营销简报',
    why: '策划结构化：目标 → 受众与洞察 → 卖点依据 → 预热 / 上线 / 长尾传播计划 → 复盘回填，两份演示简报展示完整工作流。',
    Icon: Megaphone,
  },
  {
    to: '/scripts',
    title: '脚本编辑 · 平台适配检查',
    why: '平台理解：同一份脚本在 B站 / 抖音得到不同结论，每条建议都带出处与 A/B/C 证据分级，打开任意一篇脚本即可看到。',
    Icon: FileText,
  },
  {
    to: '/report',
    title: '分析报告',
    why: '数据能力：抓取 B站游戏区 770 条公开样本，64 个数字全部绑定来源与口径，统计局限逐条写明，可导出 Markdown。',
    Icon: FileChartColumn,
  },
  {
    to: '/experiments',
    title: '内容实验',
    why: '验证习惯：假设 → 单一变量 → 分组观察 → 样本门槛；样本不足时工具会拒绝给出「成功」结论。',
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
        description="这是一个自媒体创作工具：不是「做了一个网站」，而是把内容判断沉淀成一套可复核的工作流。下面是推荐的浏览顺序。"
        actions={
          <Button size="lg" onClick={() => navigate('/')}>
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            进入工作台
          </Button>
        }
      />

      <Card padding="lg" className="space-y-4">
        <SectionHeading title="推荐浏览路线" hint="按「策划 → 平台 → 数据 → 验证」排的，时间紧只看前两个" />
        <ol className="space-y-3">
          {TOUR.map((stop, index) => (
            <li key={stop.to} className="flex gap-3 rounded-xl border border-border bg-surface-muted/30 p-3.5">
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
      </Card>

      <Card padding="lg" className="space-y-3">
        <SectionHeading title="这个项目是什么" />
        <ul className="space-y-2 text-sm leading-relaxed text-text-secondary">
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium text-text">本地优先的创作工作台</span>：选题评估 → 分镜脚本 → 平台适配 → 发布回填 → 复盘实验，覆盖内容生产的完整闭环。</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium text-text">数据诚实是设计原则</span>：预测偏差自动回填对比、演示数据明确标注、目标值与实绩严格分开、样本不足不下结论。</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span><span className="font-medium text-text">技术栈</span>：React 19 + TypeScript + Vite + Dexie（IndexedDB）+ Express 后端 + Supabase 云同步，全部独立完成。</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span>当前页面展示的是<span className="text-text">演示数据</span>（选题池 9 个、脚本 6 份、简报 2 份、实验 2 个，均标注「演示」）；注册登录后会获得独立于演示数据的账号空间。</span>
          </li>
        </ul>
      </Card>

      <Card padding="lg" className="space-y-3">
        <SectionHeading title="联系我" hint="源码、提交历史与完整 README 都在 GitHub" />
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
