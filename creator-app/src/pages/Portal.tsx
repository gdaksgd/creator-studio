import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  CodeXml,
  Compass,
  FileChartColumn,
  FileText,
  FlaskConical,
  Mail,
  Megaphone,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CONTACT } from '../config/contact';
import { cn } from '../utils/cn';
import { markEntered } from '../utils/firstVisit';

/**
 * 门户页（/welcome）—— 第一次打开站点的落地页，见 utils/firstVisit.ts。
 * 信息结构：hero（价值宣言 + 真实截图）→ 数字条 → 「问题 → 价值」功能卡 → 界面速览 → CTA。
 * 视觉层：极光漂移背景 / 截图随鼠标倾斜 / 卡片聚光 / 数字滚动 / 滚动入场 / 吸顶毛玻璃导航 /
 * CTA 旋转光边；全部动效在 prefers-reduced-motion 下自动关闭（见 index.css）。
 * 从这里进入即记「已进站」，之后访问直接到选题看板。
 */

interface Feature {
  to: string;
  title: string;
  question: string;
  value: string;
  Icon: LucideIcon;
}

const FEATURES: Feature[] = [
  {
    to: '/',
    title: '选题看板',
    question: '「这个选题值不值得做？」',
    value: '品类播放分位与互动率水位线给依据；样本不足时直接不给结论',
    Icon: Compass,
  },
  {
    to: '/scripts',
    title: '脚本编辑 · 平台适配',
    question: '「这条脚本发 B站 还是抖音？」',
    value: '同一份脚本两个平台给出不同结论，每条建议带出处与 A/B/C 证据等级',
    Icon: FileText,
  },
  {
    to: '/report',
    title: '分析报告',
    question: '「汇报时被问『这数字哪来的』？」',
    value: '770 条公开样本，每个数字绑定来源与样本量，可导出 Markdown',
    Icon: FileChartColumn,
  },
  {
    to: '/',
    title: '发布回填 · 预测校准',
    question: '「发完到底准不准？」',
    value: '粘贴 B站链接精确取数，AI 预估与真实播放逐条对账；缺数据的样本不补 0',
    Icon: Target,
  },
  {
    to: '/experiments',
    title: '内容实验',
    question: '「这次改动真的有效吗？」',
    value: '单一变量、样本门槛与人工复盘；样本不足时不作「成功」判断',
    Icon: FlaskConical,
  },
  {
    to: '/marketing-briefs',
    title: '版本营销简报',
    question: '「版本传播怎么落成方案？」',
    value: '目标 / 受众 / 卖点依据 / 预热·上线·长尾节奏，结构化到可复盘',
    Icon: Megaphone,
  },
];

const STATS = [
  { value: 770, label: '条 B站公开样本' },
  { value: 64, label: '个报告数字全部绑定来源' },
  { value: 4, label: '条平台适配规则 · 证据分级' },
  { value: 10, label: '个工作台页面' },
];

/** 滚动进入视口时触发一次（用于入场动画与数字滚动） */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, shown };
}

/** 入场包装：进入视口后淡入上移，delay 用于列表错落 */
function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const { ref, shown } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn('reveal', shown && 'reveal-in', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** 数字滚动（进入视口后从 0 数到目标值）。
    直接写 textContent 而不是 setState：每帧一次 React 渲染在开发模式下很贵 */
function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const { ref, shown } = useInView<HTMLSpanElement>();

  useEffect(() => {
    const el = ref.current;
    if (!el || !shown) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = String(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(value * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, shown, value, duration]);

  return (
    <span ref={ref} className="num">
      0
    </span>
  );
}

function SectionTitle({ eyebrow, title, hint }: { eyebrow?: string; title: string; hint?: string }) {
  return (
    <div className="mb-6">
      {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
      <h2 className="text-lg font-semibold tracking-tight text-text sm:text-xl">{title}</h2>
      {hint && <p className="mt-1.5 text-sm text-text-muted">{hint}</p>}
    </div>
  );
}

/** 产品截图：随鼠标轻微倾斜 + 双色光晕 + 两枚浮动徽章 */
function HeroShot() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);

  // 高回报率鼠标每秒会发上千次 mousemove：合并为「每帧最多处理一次」，
  // 避免每个事件都读布局 + 写样式造成掉帧
  const tiltRaf = useRef(0);
  const tiltPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(
    () => () => {
      if (tiltRaf.current) cancelAnimationFrame(tiltRaf.current);
    },
    [],
  );

  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (reduced.current) return;
    tiltPoint.current = { x: event.clientX, y: event.clientY };
    if (tiltRaf.current) return;
    tiltRaf.current = requestAnimationFrame(() => {
      tiltRaf.current = 0;
      const el = frameRef.current;
      const point = tiltPoint.current;
      if (!el || !point) return;
      const rect = el.getBoundingClientRect();
      const px = (point.x - rect.left) / rect.width - 0.5;
      const py = (point.y - rect.top) / rect.height - 0.5;
      el.style.setProperty('--rx', `${(-py * 4).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(px * 6).toFixed(2)}deg`);
    });
  };

  const reset = () => {
    const el = frameRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <div className="anim-rise relative mx-auto mt-14 max-w-4xl [animation-delay:220ms]" onMouseMove={onMove} onMouseLeave={reset}>
      {/* 双色光晕（紫 + 青，随主题自适应，见 index.css 的 --glow-*） */}
      <div
        className="pointer-events-none absolute -inset-x-12 -top-12 bottom-2 opacity-45"
        style={{
          background:
            'radial-gradient(50% 55% at 30% 25%, var(--glow-1), transparent 70%), radial-gradient(45% 50% at 72% 30%, var(--glow-2), transparent 70%)',
        }}
        aria-hidden="true"
      />

      {/* 浮动徽章：两个「数据诚实」的设计原则 */}
      <div className="float-soft absolute -right-3 top-16 z-10 hidden rounded-xl border border-border bg-surface/95 px-3.5 py-2.5 shadow-float sm:block">
        <span className="flex items-center gap-2 text-xs font-medium text-text">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          每条建议都带出处
        </span>
      </div>
      <div
        className="float-soft absolute -left-4 bottom-24 z-10 hidden rounded-xl border border-border bg-surface/95 px-3.5 py-2.5 shadow-float sm:block"
        style={{ animationDelay: '-3s' }}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-text">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          样本不足时不下结论
        </span>
      </div>

      <div ref={frameRef} className="tilt-frame relative overflow-hidden rounded-2xl border border-border bg-surface shadow-float">
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-muted/70 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/50" aria-hidden="true" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" aria-hidden="true" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/50" aria-hidden="true" />
          <span className="mx-auto rounded-md bg-bg px-3 py-1 text-[11px] text-text-muted">
            creator.creator-app.xyz
          </span>
        </div>
        <img
          src="/shots/dashboard.webp"
          alt="选题看板界面：热点评分、选题池与本地指标"
          width={1440}
          height={900}
          decoding="async"
          className="block w-full"
        />
      </div>
    </div>
  );
}

/** 功能卡：鼠标聚光 + 抬升 + 问题 → 价值 */
function FeatureCard({ feature }: { feature: Feature }) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const spotRaf = useRef(0);
  const spotPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(
    () => () => {
      if (spotRaf.current) cancelAnimationFrame(spotRaf.current);
    },
    [],
  );

  // 同 HeroShot：把高频 mousemove 合并成每帧最多一次
  const onMove = (event: React.MouseEvent<HTMLAnchorElement>) => {
    spotPoint.current = { x: event.clientX, y: event.clientY };
    if (spotRaf.current) return;
    spotRaf.current = requestAnimationFrame(() => {
      spotRaf.current = 0;
      const el = ref.current;
      const point = spotPoint.current;
      if (!el || !point) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${point.x - rect.left}px`);
      el.style.setProperty('--my', `${point.y - rect.top}px`);
    });
  };

  return (
    <Link
      ref={ref}
      to={feature.to}
      onClick={() => markEntered()}
      onMouseMove={onMove}
      className="spotlight-host group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card-hover"
    >
      <span className="spotlight" aria-hidden="true" />
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary transition-transform duration-200 group-hover:scale-105">
        <feature.Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="mt-3.5 text-sm font-semibold text-text">{feature.title}</span>
      <span className="mt-2 text-xs text-text-muted">{feature.question}</span>
      <span className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-relaxed text-text-secondary">
        <ArrowRight className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        <span>{feature.value}</span>
      </span>
    </Link>
  );
}

/** 界面速览卡：浏览器窗口样式 + 悬停轻推近 */
function ShowcaseFigure({
  src,
  alt,
  path,
  title,
  caption,
}: {
  src: string;
  alt: string;
  path: string;
  title: string;
  caption: string;
}) {
  return (
    <figure className="group h-full overflow-hidden rounded-xl border border-border bg-surface shadow-card transition-shadow duration-200 hover:shadow-card-hover">
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-muted/70 px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-danger/45" aria-hidden="true" />
        <span className="h-2 w-2 rounded-full bg-border-strong" aria-hidden="true" />
        <span className="h-2 w-2 rounded-full bg-success/45" aria-hidden="true" />
        <span className="mx-auto rounded bg-bg px-2 py-0.5 text-[10px] text-text-muted">{path}</span>
      </div>
      <div className="overflow-hidden border-b border-border">
        <img
          src={src}
          alt={alt}
          width={1440}
          height={900}
          loading="lazy"
          className="block w-full transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
      </div>
      <figcaption className="px-4 py-3 text-xs leading-relaxed text-text-secondary">
        <span className="font-medium text-text">{title}</span> · {caption}
      </figcaption>
    </figure>
  );
}

export default function Portal() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const enter = (to: string) => {
    markEntered();
    navigate(to);
  };

  return (
    <div className="relative min-h-screen bg-bg text-text">
      {/* 背景层：网格纹理 + 两团极光（独立容器，避免 overflow-hidden 破坏页头 sticky） */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="texture-grid absolute inset-0 opacity-60" />
        <div
          className="aurora-blob"
          style={{
            width: 640,
            height: 640,
            top: -220,
            left: '4%',
            opacity: 0.55,
            background: 'radial-gradient(closest-side, var(--glow-1), transparent)',
          }}
        />
        <div
          className="aurora-blob"
          style={{
            width: 540,
            height: 540,
            top: -40,
            right: '-10%',
            opacity: 0.45,
            background: 'radial-gradient(closest-side, var(--glow-2), transparent)',
            animationDelay: '-9s',
          }}
        />
      </div>

      {/* 吸顶毛玻璃导航 */}
      <header
        className={cn(
          'sticky top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-300',
          scrolled ? 'border-border bg-bg/85 backdrop-blur-sm' : 'border-transparent',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <span className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 rounded-xl object-cover"
            />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold tracking-tight">Creator Studio</span>
              <span className="text-[11px] text-text-muted">内容工作台</span>
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Link
              to="/about"
              onClick={() => markEntered()}
              className="rounded-lg px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
            >
              关于本站
            </Link>
            <a
              href={CONTACT.github}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
            >
              <CodeXml className="h-4 w-4" aria-hidden="true" />
              GitHub
            </a>
          </span>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl px-6 pb-4 sm:px-8">
        {/* ── Hero：价值宣言 + 真实界面截图 ── */}
        <section className="pt-10 text-center sm:pt-14">
          <div className="stagger-children flex flex-col items-center">
            <Badge variant="outline" size="md" className="gap-2 rounded-full bg-surface px-2.5 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              本地优先 · 数据不出本机
            </Badge>
            <h1 className="mx-auto mt-6 max-w-3xl text-[30px] font-semibold leading-[1.15] tracking-[-0.035em] text-text sm:text-[42px]">
              从选题到复盘，<span className="text-brand">每一步都有依据</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-7 text-text-secondary">
              Creator Studio 是一个内容工作台：选题评估、脚本分镜、平台适配、发布复盘、内容实验与版本营销简报，
              都在同一条工作流里。数据默认只存在你的浏览器，演示数据已就绪，无需注册。
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={() => enter('/')}>
                进入工作台
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="lg" variant="secondary" onClick={() => enter('/report')}>
                先看分析报告
              </Button>
            </div>
          </div>
          <HeroShot />
        </section>

        {/* ── 数字信任条 ── */}
        <Reveal className="mt-14">
          <div className="overflow-hidden rounded-2xl border border-border bg-border shadow-card">
            <dl className="grid grid-cols-2 gap-px lg:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="bg-surface px-5 py-7 text-center transition-colors hover:bg-surface-hover">
                  <dd className="text-[32px] font-semibold tracking-tight">
                    <span className="text-brand">
                      <CountUp value={stat.value} />
                    </span>
                  </dd>
                  <dt className="mt-1.5 text-xs text-text-muted">{stat.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>

        {/* ── 功能块：「问题 → 价值」逐条对应 ── */}
        <section className="mt-16">
          <Reveal>
            <SectionTitle
              eyebrow="功能"
              title="里面有什么，各自解决什么问题"
              hint="点击任意模块直接进入；演示数据已就绪"
            />
          </Reveal>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 70} className="h-full">
                <FeatureCard feature={feature} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── 界面速览 ── */}
        <section className="mt-16">
          <Reveal>
            <SectionTitle eyebrow="界面" title="实际界面长什么样" hint="截图来自当前版本，数据为演示数据" />
          </Reveal>
          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal className="h-full">
              <ShowcaseFigure
                src="/shots/report.webp"
                alt="分析报告界面：品类竞争、时长与互动率等维度的数字都带来源与样本量"
                path="/report"
                title="分析报告"
                caption="每个数字都带来源、样本量与时间窗，结论与统计局限逐条写明，可导出 Markdown"
              />
            </Reveal>
            <Reveal delay={90} className="h-full">
              <ShowcaseFigure
                src="/shots/marketing-briefs.webp"
                alt="版本营销简报界面：目标、受众、卖点依据与预热上线长尾节奏"
                path="/marketing-briefs"
                title="版本营销简报"
                caption="目标 / 受众 / 卖点依据 / 预热·上线·长尾节奏 / 评估指标，计划值不写成结果"
              />
            </Reveal>
          </div>
        </section>

        {/* ── 收尾 CTA（旋转光边） ── */}
        <Reveal className="mt-16">
          <section className="relative rounded-2xl border border-border bg-surface text-center shadow-card">
            {/* 旋转光边：静态锥形渐变 + 只跑 transform 的旋转 */}
            <span className="glow-ring" aria-hidden="true">
              <span className="glow-spin" />
            </span>
            <div className="relative overflow-hidden rounded-[inherit] px-6 py-12">
              <div className="texture-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
              <div
                className="pointer-events-none absolute -top-24 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full opacity-60"
                aria-hidden="true"
                style={{
                  background:
                    'radial-gradient(closest-side, color-mix(in oklab, var(--primary) 25%, transparent), transparent)',
                }}
              />
              <div className="relative">
                <h2 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">打开即是完整工作台</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
                  无需注册；想先了解项目的来龙去脉，可以走一遍「关于本站」的 3 分钟导读。
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Button size="lg" onClick={() => enter('/')}>
                    进入工作台
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button size="lg" variant="secondary" onClick={() => enter('/about')}>
                    关于本站 · 3 分钟导读
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </Reveal>
      </main>

      <footer className="relative mx-auto mt-14 flex w-full max-w-6xl flex-col gap-2 border-t border-border px-6 pb-10 pt-5 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>演示数据仅用于展示功能形态，不构成任何项目实绩。</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="font-medium text-text-secondary">{CONTACT.name}</span>
          <a href={CONTACT.github} target="_blank" rel="noreferrer" className="transition-colors hover:text-text">
            GitHub · {CONTACT.displayName}
          </a>
          <a href={`mailto:${CONTACT.email}`} className="inline-flex items-center gap-1 transition-colors hover:text-text">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            {CONTACT.email}
          </a>
        </span>
      </footer>
    </div>
  );
}
