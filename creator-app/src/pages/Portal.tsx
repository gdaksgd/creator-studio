import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowRight, ArrowUpRight, CodeXml, Mail } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { CONTACT } from '../config/contact';
import { cn } from '../utils/cn';
import { prefetchRoute, schedulePagePrefetch } from '../utils/prefetch';
import { markEntered } from '../utils/firstVisit';

/**
 * 门户页（/welcome）· 与工作台同一套设计令牌的轻量落地页
 *
 * 结构：Hero → 问题 → 五步工作台 → 依据 → 界面 → 收束。
 * 桌面端每节高度 100svh，滚轮轻滑即进入下一节；触屏与减弱动效走原生滚动。
 * 五步内容用点击切换，不再用长距离钉住滚动换阶段。
 * 所有阶段配图都是对应功能的真实界面截图。
 */

interface Stage {
  id: string;
  index: string;
  label: string;
  short: string;
  hint: string;
  title: string;
  desc: string;
  proof: string;
  shot: string;
  alt: string;
  origin: string;
  zoom: number;
}

const STAGES: Stage[] = [
  {
    id: 'topic',
    index: '01',
    label: '选题评估',
    short: '选题',
    hint: '品类分位 · 样本门槛',
    title: '先判断值不值得做。',
    desc: '品类播放分位、互动率水位线、竞争强度放在同一张表里。样本不足时，工具拒绝给结论。',
    proof: '依据：品类基准线 · 样本门槛',
    shot: 'eval',
    alt: 'AI 选题评估弹窗：综合评分、话题热度、竞争程度、预估播放与推荐平台',
    origin: '50% 50%',
    zoom: 1,
  },
  {
    id: 'script',
    index: '02',
    label: '脚本与分镜',
    short: '脚本',
    hint: '标题 · 钩子 · 分镜',
    title: '把想法拆成可拍的动作。',
    desc: '标题、开场钩子、逐镜时长与画面方向写在同一份脚本里。每个版本对应一个明确的制作动作。',
    proof: '依据：分镜时长 · 平台版本',
    shot: 'storyboard',
    alt: '分镜脚本界面：5 个分镜、逐镜时长与开场钩子',
    origin: '50% 50%',
    zoom: 1,
  },
  {
    id: 'gate',
    index: '03',
    label: '成片任务',
    short: '门禁',
    hint: '预检 · 素材授权 · 阻塞',
    title: '能不能发，先过门禁。',
    desc: '创建任务时锁定脚本快照；发布前检查、逐镜素材、版权/授权与配音字幕门禁分开记录。有阻塞项就不能导出发布包。',
    proof: '依据：阻塞 / 提醒 / 通过 · 授权状态',
    shot: 'portal-assets',
    alt: '成片任务素材清单：镜 1 已关联素材库并显示授权可核验、来源与允许平台',
    origin: '50% 50%',
    zoom: 1,
  },
  {
    id: 'voice',
    index: '04',
    label: '配音与字幕',
    short: '配音字幕',
    hint: 'TTS · 句级时间戳 · SRT',
    title: '配音和字幕，也在任务里。',
    desc: '本地 Edge TTS worker 生成配音与句级时间戳，按 B站/抖音预设生成 SRT，检查行宽、语速与台词覆盖率；没有 worker 就阻塞，不伪造音频。',
    proof: '依据：TTS 句级时间戳 · 字幕质量检查',
    shot: 'portal-voice',
    alt: '成片任务配音与字幕卡：Edge TTS 已连接、21.2 秒音频、B站字幕预设与行宽/语速统计',
    origin: '50% 50%',
    zoom: 1,
  },
  {
    id: 'publish',
    index: '05',
    label: '复核与校准',
    short: '校准',
    hint: '阶段工件 · 媒体包 · 发布偏差',
    title: '发完不是结束，是对账。',
    desc: '复核通过后导出阶段工件或含配音/字幕的媒体包；发布后把真实播放与预测对照，绑定记录、导出和每一次修改都留在运行时间线里。',
    proof: '依据：复核门禁 · 发布绑定 · 事件时间线',
    shot: 'portal-publish',
    alt: '发布回填与校准卡：实际播放 18.6 万、预测 12 万、偏差 +55%，已绑定本次发布',
    origin: '50% 50%',
    zoom: 1,
  },
];

const RAIL = [
  { id: 'top', label: '入口' },
  { id: 'problem', label: '问题' },
  { id: 'pipeline', label: '流水线' },
  { id: 'evidence', label: '依据' },
  { id: 'interfaces', label: '界面' },
  { id: 'enter', label: '开始' },
];

const INTERFACES = [
  {
    base: 'portal-campaign',
    title: '同组任务',
    short: 'B站 / 抖音 · 组合包',
    alt: '同组任务卡：B站长版与抖音短版并列，展示阻塞、素材、导出与发布绑定状态',
    caption: '同一选题的 B站/抖音版本成组创建，检查、素材与复核互不影响；组合包按 run 目录归档。',
  },
  {
    base: 'portal-library',
    title: '素材库与版权',
    short: '来源 · 授权 · 到期 · 平台',
    alt: '素材库界面：素材卡片显示授权可核验、授权已过期、旧记录未记录授权与允许平台',
    caption: '素材记录来源、授权、到期与允许平台；任务槽位关联素材库，授权未记录/过期/平台不符会阻塞发布包。',
  },
  {
    base: 'portal-batch',
    title: '批量与成本',
    short: '并发预检 · 成本账本',
    alt: '成片任务页批量任务卡：5 条任务已完成预检，下方是 5 条阻塞任务的阶段与阻塞项',
    caption: '批量创建与并发预检，失败项可重试；配音成本与供应商口径记入任务成本卡。',
  },
  {
    base: 'report',
    title: '分析报告',
    short: '来源 · 样本量 · 统计局限',
    alt: '分析报告界面：品类竞争、时长与互动率等维度的数字都带来源与样本量',
    caption: '每个数字都带来源、样本量与时间窗，结论与统计局限逐条写明，可导出 Markdown。',
  },
];

const HERO_CHAPTERS = [
  { href: '#problem', index: '01', label: '问题', hint: '为什么总是反复猜' },
  { href: '#pipeline', index: '02', label: '流水线', hint: '从选题到发布校准' },
  { href: '#evidence', index: '03', label: '依据', hint: '每个数字有出处' },
  { href: '#interfaces', index: '04', label: '界面', hint: '真实工作台' },
  { href: '#enter', index: '05', label: '开始', hint: '打开即用' },
];

/** 进入视口触发一次，用于入场与数字滚动 */
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
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, shown };
}

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
      className={cn('p-reveal', shown && 'is-in', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

function CountUp({ value, duration = 1200 }: { value: number; duration?: number }) {
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

function ShotImage({
  base,
  alt,
  sizes,
  priority = false,
  origin,
  zoom = 1,
  className,
}: {
  base: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  origin?: string;
  zoom?: number;
  className?: string;
}) {
  return (
    <img
      src={`/shots/${base}.webp?v=4`}
      srcSet={`/shots/${base}-640.webp?v=4 640w, /shots/${base}-1080.webp?v=4 1080w, /shots/${base}.webp?v=4 1440w`}
      sizes={sizes}
      alt={alt}
      width={1440}
      height={900}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={className}
      style={
        zoom !== 1 || origin
          ? { transform: `scale(${zoom})`, transformOrigin: origin ?? '50% 50%' }
          : undefined
      }
    />
  );
}

/**
 * 页面级 UI 状态：只保留导航底色与右侧章节轨。
 * 滚动不再驱动大段内容，章节高亮交给 IntersectionObserver，避免每帧读布局。
 */
function usePortalChrome(
  rootRef: RefObject<HTMLDivElement | null>,
  heroArtRef: RefObject<HTMLDivElement | null>,
) {
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('top');

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let lastScrolled = false;
    const onScroll = () => {
      const next = window.scrollY > 24;
      if (next !== lastScrolled) {
        lastScrolled = next;
        setScrolled(next);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-portal-section]'));
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const id = (entry.target as HTMLElement).dataset.portalSection;
                if (id) setActiveSection(id);
              }
            },
            // 只认视口中段的一条窄带：同一时间只会有一个章节在这里
            { rootMargin: '-42% 0px -52% 0px', threshold: 0 },
          );
    sections.forEach((section) => io?.observe(section));

    return () => {
      window.removeEventListener('scroll', onScroll);
      io?.disconnect();
    };
  }, [rootRef]);

  // Hero 界面层只跟随鼠标做很轻的视差，不参与滚动计算
  useEffect(() => {
    const art = heroArtRef.current;
    if (!art) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (!(window.matchMedia?.('(pointer: fine)').matches ?? false)) return;

    let raf = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      art.style.setProperty('--mx', px.toFixed(4));
      art.style.setProperty('--my', py.toFixed(4));
    };
    const onMove = (event: PointerEvent) => {
      px = event.clientX / window.innerWidth - 0.5;
      py = event.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [heroArtRef]);

  return { scrolled, activeSection };
}

/**
 * 桌面端滚轮按节翻页：
 * - 短章节（≈一屏）任意位置轻滑即进入下一节；
 * - 长章节（证据 / 界面）保留正常滚动，到章节边界才翻页；
 * - 触屏、减弱动效、缩放操作全部交还浏览器。
 */
function useWheelPager(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (!(window.matchMedia?.('(pointer: fine)').matches ?? false)) return;

    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-portal-section]'));
    if (sections.length < 2) return;

    let lockedUntil = 0;
    const NAV = 76;
    const sectionAt = (y: number) => {
      let current = sections[0];
      for (const section of sections) {
        if (section.offsetTop <= y + 8) current = section;
        else break;
      }
      return current;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      // 鼠标滚轮是像素，部分浏览器/触控板给的是行或页，统一成像素再判断
      const deltaY =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * window.innerHeight
            : event.deltaY;
      if (Math.abs(deltaY) < 16) return;
      if (Math.abs(event.deltaX) > Math.abs(deltaY)) return;

      if (performance.now() < lockedUntil) {
        event.preventDefault();
        return;
      }

      const vh = window.innerHeight;
      const y = window.scrollY;
      const max = Math.max(1, document.documentElement.scrollHeight - vh);
      const down = deltaY > 0;
      const current = sectionAt(y + NAV + 2);
      const index = sections.indexOf(current);

      const nextIndex = down ? index + 1 : index - 1;
      if (nextIndex < 0 || nextIndex >= sections.length) return;

      const targetSection = sections[nextIndex];
      const target = Math.max(0, Math.min(max, targetSection.offsetTop));
      if (Math.abs(target - y) < 8) return;

      event.preventDefault();
      window.scrollTo({ top: target, behavior: 'smooth' });
      lockedUntil = performance.now() + 700;
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [rootRef]);
}

function SectionRule({ label, english }: { label: string; english: string }) {
  return (
    <div className="section-rule">
      <span>{label}</span>
      <span className="section-rule-line" aria-hidden="true" />
      <span>{english}</span>
    </div>
  );
}

/** 一屏工作台：点一步看一步，不再用 500vh 的钉住滚动换阶段 */
function Workbench({
  stage,
  onSelect,
}: {
  stage: number;
  onSelect: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const item = STAGES[stage];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const dir = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const next = (stage + dir + STAGES.length) % STAGES.length;
    onSelect(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>('.workbench-step')[next]?.focus();
  };

  return (
    <section
      id="pipeline"
      data-portal-section="pipeline"
      className="portal-section portal-workbench"
      aria-label="五步内容流水线"
    >
      <SectionRule label="流水线" english="FIVE PASSES" />

      <div className="workbench-grid">
        <div className="workbench-left">
          <h2 className="workbench-title">
            一条内容，
            <br />
            五道工序。
          </h2>
          <p className="workbench-lede">
            点任意一步，查看这一步的真实界面和判断依据。滚动不再替你做决定。
          </p>

          <div
            ref={listRef}
            className="workbench-steps"
            role="tablist"
            aria-label="内容流水线阶段"
            onKeyDown={onKeyDown}
          >
            {STAGES.map((step, index) => (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={stage === index}
                tabIndex={stage === index ? 0 : -1}
                className={cn('workbench-step', stage === index && 'is-active')}
                onClick={() => onSelect(index)}
              >
                <span className="workbench-step-index">{step.index}</span>
                <span className="workbench-step-text">
                  <span className="workbench-step-label">{step.label}</span>
                  <span className="workbench-step-short">{step.short}</span>
                  <span className="workbench-step-hint">{step.hint}</span>
                </span>
                <ArrowRight className="workbench-step-arrow h-4 w-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className="workbench-right">
          <figure className="workbench-shot">
            {STAGES.map((shot, index) => (
              <div
                key={shot.id}
                className={cn('workbench-shot-layer', stage === index && 'is-active')}
                aria-hidden={stage !== index}
              >
                <ShotImage
                  base={shot.shot}
                  alt={shot.alt}
                  sizes="(min-width: 1200px) 760px, (min-width: 900px) 60vw, 92vw"
                  origin={shot.origin}
                  zoom={shot.zoom}
                  priority={index === 0}
                />
              </div>
            ))}
          </figure>

          <div key={item.id} className="workbench-copy anim-fade" aria-live="polite">
            <div className="stage-index">
              <span>{item.index} / 05</span>
              <span className="stage-index-line" aria-hidden="true" />
              <span>{item.label}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.desc}</p>
            <p className="stage-proof">{item.proof}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Portal() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const heroArtRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState(0);
  const [interfaceIndex, setInterfaceIndex] = useState(0);
  const { scrolled, activeSection } = usePortalChrome(rootRef, heroArtRef);
  useWheelPager(rootRef);
  const close = useInView<HTMLElement>();
  const interfaceItem = INTERFACES[interfaceIndex];

  useEffect(() => {
    document.title = 'Creator Studio · 内容工作台';
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // 在门户停留时预热工作台页面；进入后第一次切页不用等 chunk
  useEffect(() => {
    schedulePagePrefetch(1200);
  }, []);

  const enter = (to: string) => {
    prefetchRoute(to);
    markEntered();
    navigate(to);
  };

  return (
    <div ref={rootRef} className="portal">
      <div className="portal-world" aria-hidden="true">
        <div className="world-moon" />
        <div className="world-warm" />
        <div className="world-grid" />
        <div className="world-seam" />
        <div className="world-haze" />
      </div>
      <div className="portal-vignette" aria-hidden="true" />

      <header className={cn('portal-nav', scrolled && 'is-solid')}>
        <Link to="/welcome" className="portal-brand" aria-label="Creator Studio 首页">
          <img src="/logo.png" alt="" aria-hidden="true" className="portal-logo" />
          <span className="portal-brand-text">
            <b>Creator Studio</b>
            <i>内容工作台</i>
          </span>
        </Link>

        <nav className="portal-nav-links" aria-label="站内导航">
          <a href="#pipeline">流程</a>
          <a href="#evidence">依据</a>
          <a href="#interfaces">界面</a>
          <Link to="/about" onClick={() => markEntered()}>
            关于
          </Link>
          <a href={CONTACT.github} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>

        <button type="button" className="p-btn p-btn--primary p-btn--nav" onClick={() => enter('/')}>
          进入工作台
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <aside className="portal-rail" aria-label="页面章节">
        {RAIL.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={cn('rail-item', activeSection === item.id && 'is-active')}
          >
            <i aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        ))}
      </aside>

      <main className="portal-main">
        {/* ── Hero：环境层 / 文字层 / 界面层 / 前景层 ── */}
        <section
          id="top"
          data-portal-section="top"
          className={cn('portal-hero', ready && 'is-ready')}
        >
          <div className="hero-scene" aria-hidden="true">
            <div className="hero-orbit hero-orbit--one" />
            <div className="hero-orbit hero-orbit--two" />
          </div>
          <div className="hero-spine" aria-hidden="true">
            内容有据 · CONTENT WITH EVIDENCE
          </div>

          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="hero-kicker-dot" aria-hidden="true" />
              CONTENT OPERATIONS · LOCAL FIRST
            </div>
            <h1 className="hero-title">
              <span className="line">
                <span>把每一次</span>
              </span>
              <span className="line">
                <span className="hero-accent">内容判断</span>
              </span>
              <span className="line">
                <span>都留下证据。</span>
              </span>
            </h1>
            <p className="hero-sub">
              选题、脚本、成片任务、配音字幕、复核交接与发布校准，收在同一条工作流里。
              数据默认只存在你的浏览器，演示数据已就绪，无需注册。
            </p>
            <div className="hero-actions">
              <button type="button" className="p-btn p-btn--primary" onClick={() => enter('/')}>
                进入工作台
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="p-btn p-btn--ghost"
                onClick={() => enter('/runs')}
              >
                先看成片任务
              </button>
            </div>
          </div>

          <div className="hero-art" ref={heroArtRef} aria-hidden="true">
            <figure className="hero-plate hero-plate--main">
              <ShotImage base="portal-run" alt="" sizes="(min-width: 1200px) 820px, 60vw" priority />
            </figure>
            <div className="hero-art-halo" />
          </div>

          <div className="hero-floor" aria-hidden="true" />

          <nav className="hero-chapters" aria-label="页面章节">
            {HERO_CHAPTERS.map((item) => (
              <a key={item.href} href={item.href} className="hero-chapter">
                <span className="hero-chapter-index">{item.index}</span>
                <span className="hero-chapter-label">{item.label}</span>
                <span className="hero-chapter-hint">{item.hint}</span>
                <ArrowUpRight className="hero-chapter-arrow h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ))}
          </nav>
        </section>

        {/* ── 问题：峰值前的安静段 ── */}
        <section
          id="problem"
          data-portal-section="problem"
          className="portal-section portal-problem"
        >
          <Reveal>
            <SectionRule label="问题" english="THE COST OF GUESSING" />
          </Reveal>
          <Reveal delay={60}>
            <h2 className="section-title problem-title">
              内容运营最贵的成本，
              <br />
              不是制作，是<span className="problem-accent">反复猜</span>。
            </h2>
          </Reveal>
          <div className="problem-lines">
            <Reveal delay={80}>
              <div className="problem-line">
                <b>01</b>
                <span>选题和脚本靠直觉，做完才发现方向不对。</span>
              </div>
            </Reveal>
            <Reveal delay={140}>
              <div className="problem-line">
                <b>02</b>
                <span>素材、授权、配音、字幕散在各处，发布前才补门禁。</span>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="problem-line">
                <b>03</b>
                <span>发布后数据回来了，预测和实际没有对账，下次还是重来。</span>
              </div>
            </Reveal>
          </div>
          <Reveal delay={260}>
            <p className="problem-foot">
              把这三件事变成可查的记录，是 Creator Studio 存在的理由。
            </p>
          </Reveal>
        </section>

        {/* ── 流水线：页面峰值，滚动条就是产线进度 ── */}
        <Workbench stage={stage} onSelect={setStage} />

        {/* ── 依据：非对称数字编排 ── */}
        {/* ── 依据：一屏内的非对称数字版面 ── */}
        <section
          id="evidence"
          data-portal-section="evidence"
          className="portal-section portal-evidence"
        >
          <Reveal>
            <SectionRule label="依据" english="NUMBERS WITH SOURCES" />
          </Reveal>
          <div className="evidence-grid">
            <Reveal>
              <div className="evidence-lead">
                <div className="evidence-big">
                  <CountUp value={64} />
                  <small>个报告数字 · 全部绑定来源</small>
                </div>
                <p className="evidence-lead-copy">
                  B站游戏区公开样本构成基准线。每个数字都带来源、样本量与时间窗；
                  样本不足的品类直接标缺口，不插值、不补 0。
                </p>
                <blockquote className="evidence-quote">
                  样本不足时，工具会拒绝给结论。
                </blockquote>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <dl className="evidence-rows">
                <div className="evidence-row">
                  <dt>
                    <CountUp value={8} />
                  </dt>
                  <dd>
                    <b>个品类基准线</b>
                    样本不足的品类不插值，直接标缺口；报告数字全部能回到具体样本与口径。
                  </dd>
                </div>
                <div className="evidence-row">
                  <dt>
                    <CountUp value={3} />
                  </dt>
                  <dd>
                    <b>条成片流水线</b>
                    B站长解说、抖音短切片、版本营销素材包；阶段轨与导出文件由流水线定义。
                  </dd>
                </div>
                <div className="evidence-row">
                  <dt>
                    <CountUp value={5} />
                  </dt>
                  <dd>
                    <b>个阶段工件可单独下载</b>
                    脚本、分镜、素材、检查、发布说明；运行事件最多保留 200 条，支持追溯。
                  </dd>
                </div>
              </dl>
            </Reveal>
          </div>
        </section>

        {/* ── 界面：大图 + 缩略图，一屏内完成切换 ── */}
        <section
          id="interfaces"
          data-portal-section="interfaces"
          className="portal-section portal-interfaces"
        >
          <div className="interfaces-layout">
            <div className="interfaces-info">
              <Reveal className="interfaces-rule">
                <SectionRule label="界面" english="THE ACTUAL WORKBENCH" />
              </Reveal>
              <Reveal delay={60} className="interfaces-heading">
                <h2 className="section-title interfaces-title">
                  真实界面，
                  <br />
                  不是概念稿。
                </h2>
              </Reveal>
              <Reveal delay={100} className="interfaces-caption">
                <div className="interface-caption-block anim-fade" key={`${interfaceItem.base}-caption`}>
                  <span className="interface-index">
                    {String(interfaceIndex + 1).padStart(2, '0')} / {String(INTERFACES.length).padStart(2, '0')}
                  </span>
                  <div className="interface-cap">
                    <b>{interfaceItem.title}</b>
                    {interfaceItem.caption}
                  </div>
                </div>
              </Reveal>
              <Reveal delay={140} className="interfaces-thumbs-wrap">
                <div className="interface-thumbs" role="tablist" aria-label="界面预览">
                  {INTERFACES.map((item, index) => (
                    <button
                      key={item.base}
                      type="button"
                      role="tab"
                      aria-selected={interfaceIndex === index}
                      className={cn('interface-thumb', interfaceIndex === index && 'is-active')}
                      onClick={() => setInterfaceIndex(index)}
                    >
                      <span className="interface-thumb-frame">
                        <ShotImage base={item.base} alt="" sizes="200px" />
                      </span>
                      <span className="interface-thumb-text">
                        <b>{item.title}</b>
                        <small>{item.short}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={80} className="interfaces-image">
              <figure className="interface-main">
                <div className="interface-main-frame">
                  <ShotImage
                    key={interfaceItem.base}
                    base={interfaceItem.base}
                    alt={interfaceItem.alt}
                    sizes="(min-width: 1200px) 760px, (min-width: 900px) 56vw, 92vw"
                  />
                </div>
              </figure>
            </Reveal>
          </div>
        </section>

        {/* ── 收束：门缝里的光落下来，CTA 停住 ── */}
        <section
          id="enter"
          data-portal-section="enter"
          ref={close.ref}
          className={cn('portal-close', close.shown && 'is-in')}
        >
          <div className="close-glow" aria-hidden="true" />
          <div className="close-door" aria-hidden="true" />

          <div className="close-inner">
            <div className="close-kicker">
              <span className="hero-kicker-dot" aria-hidden="true" />
              开始
            </div>
            <h2 className="close-title">
              打开工作台，
              <br />
              把下一条内容做得
              <span className="close-accent">有据可查</span>。
            </h2>
            <p className="close-sub">
              无需注册。演示数据已就绪，所有数据默认只存在你的浏览器。
              想先了解项目的来龙去脉，可以走一遍「关于本站」的三分钟导读。
            </p>
            <div className="close-actions">
              <button type="button" className="p-btn p-btn--primary" onClick={() => enter('/')}>
                进入工作台
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="p-btn p-btn--ghost"
                onClick={() => enter('/about')}
              >
                关于本站 · 三分钟导读
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <footer className="portal-footer">
            <span>演示数据仅用于展示功能形态，不构成任何项目实绩。</span>
            <span className="portal-footer-links">
              <span>{CONTACT.name}</span>
              <a href={CONTACT.github} target="_blank" rel="noreferrer">
                <CodeXml className="h-3.5 w-3.5" aria-hidden="true" />
                GitHub · {CONTACT.displayName}
              </a>
              <a href={`mailto:${CONTACT.email}`}>
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {CONTACT.email}
              </a>
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}
