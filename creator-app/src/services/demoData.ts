// ============================================================
//  演示数据 —— 让「作品集演示」第一次打开就有内容
//
//  ★ 只写本机 IndexedDB，**不触发云端上传**（避免把演示数据混进真实备份）
//  ★ 所有条目 id 都以 `demo-` 开头，可一键精确清空
//  ★ 用 localStorage 记住用户的选择：载入过 / 主动关闭后不再自动载入
// ============================================================

import { db } from '../db';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { hasToken } from './authService';
import type {
  CampaignPlanItem,
  ContentExperiment,
  GameMarketingBrief,
  MaterialPlan,
  PublishedRecord,
  Script,
  Storyboard,
  Topic,
  TopicEvaluation,
} from '../types';

const FLAG_KEY = 'creator-studio-demo';
const DEMO_PREFIX = 'demo-';
const DAY = 24 * 60 * 60 * 1000;

export type DemoState = 'on' | 'off' | 'auto';

export function getDemoState(): DemoState {
  try {
    const v = localStorage.getItem(FLAG_KEY);
    if (v === 'on' || v === 'off') return v;
  } catch {
    /* localStorage 不可用时走 auto */
  }
  return 'auto';
}

function setDemoState(state: DemoState) {
  try {
    localStorage.setItem(FLAG_KEY, state);
  } catch {
    /* ignore */
  }
}

async function reloadStores() {
  await Promise.all([
    useTopicStore.getState().loadTopics(),
    useScriptStore.getState().loadScripts(),
  ]);
}

/** 当前库里的演示数据条数（选题 + 脚本 + 简报 + 实验） */
export async function countDemoData(): Promise<number> {
  const [topics, scripts, workbench] = await Promise.all([
    db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).count(),
    db.scripts.filter((s) => s.id.startsWith(DEMO_PREFIX)).count(),
    db.marketingWorkbench.get('workspace'),
  ]);
  const briefs = workbench?.briefs.filter((b) => b.id.startsWith(DEMO_PREFIX)).length ?? 0;
  const experiments =
    workbench?.experiments.filter((e) => e.id.startsWith(DEMO_PREFIX)).length ?? 0;
  return topics + scripts + briefs + experiments;
}

/** 清空演示数据（只删 `demo-` 前缀，真实数据不受影响；营销工作台是单记录混合存储，按条目过滤） */
export async function clearDemoData(): Promise<void> {
  await db.transaction('rw', db.topics, db.scripts, db.marketingWorkbench, async () => {
    await db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).delete();
    await db.scripts.filter((s) => s.id.startsWith(DEMO_PREFIX)).delete();
    const workbench = await db.marketingWorkbench.get('workspace');
    if (workbench) {
      await db.marketingWorkbench.put({
        ...workbench,
        experiments: workbench.experiments.filter((e) => !e.id.startsWith(DEMO_PREFIX)),
        briefs: workbench.briefs.filter((b) => !b.id.startsWith(DEMO_PREFIX)),
        updatedAt: Date.now(),
      });
    }
  });
  setDemoState('off');
  await reloadStores();
}

/** 一键载入演示数据（重复点击会先清空再写入，不会变成两份） */
export async function seedDemoData(): Promise<{
  topics: number;
  scripts: number;
  briefs: number;
  experiments: number;
}> {
  const { topics, scripts } = buildDemoDataset(Date.now());
  const { experiments, briefs } = buildDemoMarketing(Date.now());
  await db.transaction('rw', db.topics, db.scripts, db.marketingWorkbench, async () => {
    await db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).delete();
    await db.scripts.filter((s) => s.id.startsWith(DEMO_PREFIX)).delete();
    // 营销工作台里简报/实验与真实数据混在同一条记录里：只替换 `demo-` 前缀条目
    const workbench = await db.marketingWorkbench.get('workspace');
    await db.marketingWorkbench.put({
      id: 'workspace',
      experiments: [...experiments, ...(workbench?.experiments ?? []).filter((e) => !e.id.startsWith(DEMO_PREFIX))],
      briefs: [...briefs, ...(workbench?.briefs ?? []).filter((b) => !b.id.startsWith(DEMO_PREFIX))],
      updatedAt: Date.now(),
    });
    await db.topics.bulkPut(topics);
    await db.scripts.bulkPut(scripts);
  });
  setDemoState('on');
  await reloadStores();
  return { topics: topics.length, scripts: scripts.length, briefs: briefs.length, experiments: experiments.length };
}

/**
 * 首次访问自动载入：本地库完全是空的、且用户没主动关掉时才会写入。
 * 这样 HR 打开站点的第一眼看到的不是一片空白。
 */
export async function ensureDemoData(): Promise<boolean> {
  // 已登录（有 token）时不再自动播种：登录用户看到自己的空库不会被塞演示数据。
  if (hasToken()) return false;
  if (getDemoState() === 'off') return false;
  const total = await db.topics.count();
  if (total === 0) {
    await seedDemoData();
    return true;
  }
  // 老访客升级路径：此前载入过演示选题、但营销工作台还没有演示简报/实验时补齐，
  // 保证更新上线后回访的浏览器也能在简报/实验页看到内容。
  const demoTopics = await db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).count();
  if (demoTopics === 0) return false; // 本机是真实创作数据，不注入演示内容
  return await ensureMarketingDemo();
}

/** 只补营销工作台缺的演示简报/实验；真实简报/实验原样保留。 */
async function ensureMarketingDemo(): Promise<boolean> {
  const workbench = await db.marketingWorkbench.get('workspace');
  const hasDemoBrief = (workbench?.briefs ?? []).some((b) => b.id.startsWith(DEMO_PREFIX));
  const hasDemoExperiment = (workbench?.experiments ?? []).some((e) => e.id.startsWith(DEMO_PREFIX));
  if (hasDemoBrief && hasDemoExperiment) return false;
  const { experiments, briefs } = buildDemoMarketing(Date.now());
  await db.transaction('rw', db.marketingWorkbench, async () => {
    const current = await db.marketingWorkbench.get('workspace');
    await db.marketingWorkbench.put({
      id: 'workspace',
      experiments: hasDemoExperiment ? current?.experiments ?? [] : [...experiments, ...(current?.experiments ?? [])],
      briefs: hasDemoBrief ? current?.briefs ?? [] : [...briefs, ...(current?.briefs ?? [])],
      updatedAt: Date.now(),
    });
  });
  return true;
}

// ───────────────────────── 数据构造 ─────────────────────────

let boardSeq = 0;
function board(
  sceneNumber: number,
  description: string,
  dialogue: string,
  duration: number,
  visualDirection: string,
  notes = '',
): Storyboard {
  boardSeq += 1;
  return {
    id: `${DEMO_PREFIX}board-${boardSeq}`,
    sceneNumber,
    description,
    dialogue,
    duration,
    notes,
    visualDirection,
  };
}

function published(
  platform: 'bilibili' | 'douyin',
  title: string,
  publishedAt: number,
  data: Omit<PublishedRecord, 'platform' | 'title' | 'publishedAt' | 'fetchedAt' | 'source'>,
): PublishedRecord {
  return {
    platform,
    title,
    publishedAt,
    fetchedAt: publishedAt + DAY,
    source: 'auto',
    ...data,
  };
}

function evaluation(partial: Partial<TopicEvaluation> & { score: number }): TopicEvaluation {
  return {
    heatLevel: 70,
    competitionLevel: 60,
    difficulty: '中等',
    estimatedViews: '5w - 10w',
    suggestions: '标题前置年份与版本号，封面用对比图，前 15 秒给出结论。',
    titleSuggestions: [],
    risks: '同类选题饱和度偏高，需要靠实测数据做出差异。',
    bestPlatform: 'B站',
    bestTime: '周五 19:00 - 22:00',
    evaluatedAt: Date.now() - 3 * DAY,
    ...partial,
  };
}

function materialPlan(scriptId: string, scenes: MaterialPlan['scenes']): MaterialPlan {
  return { scenes, analyzedAt: Date.now() - 2 * DAY, scriptId };
}

function buildDemoDataset(now: number): { topics: Topic[]; scripts: Script[] } {
  boardSeq = 0;
  const scripts: Script[] = [];

  // ── 1. 已发布（B站）：独立游戏实测，数据最好的一条，撑起首页 KPI 与趋势图
  const t1: Topic = {
    id: `${DEMO_PREFIX}topic-1`,
    title: '《空洞骑士：丝之歌》首发 6 小时实测',
    category: 'indie',
    status: 'published',
    difficulty: 3,
    estimatedViews: 120000,
    urgency: 'high',
    notes: '发售当天抢首发，避开周末的测评大部队。',
    productionIdea: '用「6 小时能走多远」当主线，穿插战斗手感与地图设计的主观评价。',
    gameDescription:
      'Team Cherry 时隔多年的续作，主角换成大黄蜂，节奏比前作更快，地图更立体。',
    createdAt: now - 38 * DAY,
    updatedAt: now - 2 * DAY,
    evaluation: evaluation({
      score: 88,
      heatLevel: 92,
      competitionLevel: 78,
      difficulty: '偏高',
      estimatedViews: '10w - 20w',
      suggestions: '首发窗口只有 48 小时，务必在发售当天上传；标题带「首发实测」提高点击。',
      titleSuggestions: [
        '《丝之歌》首发 6 小时：手感比前作快了多少？',
        '首发实测《空洞骑士：丝之歌》，6 小时能打到哪',
      ],
      risks: '大 UP 同期撞车，需要靠实测进度与操作细节取胜。',
      bestTime: '发售日 12:00 前',
    }),
    titleEvaluation: {
      score: 84,
      analysis: '标题包含作品名 + 时间量词，信息密度高，但缺少情绪钩子。',
      strengths: ['有具体数字「6 小时」，可信度高', '「首发」有时效性'],
      weaknesses: ['缺少悬念或冲突', '关键词偏中性，点击驱动弱'],
      alternativeTitles: [
        '首发 6 小时，我把《丝之歌》打到了第一个 Boss',
        '《丝之歌》首发实测：这次的手感真的变了',
      ],
      evaluatedAt: now - 36 * DAY,
    },
    published: published('bilibili', '《空洞骑士：丝之歌》首发 6 小时实测', now - 30 * DAY, {
      bvid: 'BV1demo0001',
      url: 'https://www.bilibili.com/video/BV1demo0001',
      duration: 742,
      views: 186000,
      likes: 12400,
      coins: 3800,
      favorites: 9100,
      shares: 620,
      comments: 830,
      danmaku: 2400,
    }),
  };
  scripts.push({
    id: `${DEMO_PREFIX}script-1`,
    topicId: t1.id,
    platform: 'bilibili',
    version: 'long',
    title: '首发 6 小时，我把《丝之歌》打到了第一个 Boss',
    hook: '发售 6 小时，180 万人已经在跑图了——这一作到底难在哪？',
    notes: '口播为主，实机画面铺底，避免长段静止画面。',
    createdAt: now - 37 * DAY,
    updatedAt: now - 31 * DAY,
    storyboards: [
      board(1, '开场：发售当天服务器抢修画面 + 实机第一刀', '发售 6 小时，在线人数直接顶到了历史峰值。', 25, '实机画面快剪，右上角挂计时器', '前 3 秒必须出现游戏画面'),
      board(2, '体感对比：大黄蜂 vs 小骑士的移动与冲刺', '先说结论：这一作的节奏比前作快了大概三成。', 70, '左右分屏对比，标注帧数', '分屏时统一 60fps 输出'),
      board(3, '地图设计：立体化之后迷路成本变高', '立体地图好看，但第一次进图基本必迷路。', 90, '地图界面缩放 + 手绘路线标注', '标注三个必经捷径'),
      board(4, 'Boss 战：第一个 Boss 的三个阶段', '这个 Boss 教会我的一件事是——别贪第二刀。', 180, 'Boss 战实机 + 倒地次数统计', '保留一次完整失败过程'),
      board(5, '结论与购买建议', '如果你喜欢前作，这一作没有理由不买。', 60, '回到实机静止画面 + 评分板', '给出 9/10 的明确结论'),
    ],
  });
  scripts.push({
    id: `${DEMO_PREFIX}script-2`,
    topicId: t1.id,
    platform: 'douyin',
    version: 'short',
    title: '丝之歌首发实测：手感快了多少？',
    hook: '发售 6 小时，我先说三个变化。',
    notes: '竖屏，字幕加大，单镜头不超过 4 秒。',
    createdAt: now - 37 * DAY,
    updatedAt: now - 32 * DAY,
    storyboards: [
      board(1, '竖屏开场：游戏 LOGO + 计时器', '首发 6 小时，三个变化。', 6, '竖屏实机 + 大字幕'),
      board(2, '变化一：节奏更快', '冲刺和攻击的前后摇都短了。', 18, '慢动作对比'),
      board(3, '变化二：地图更立体', '好看，但更容易迷路。', 16, '地图缩放'),
      board(4, '变化三：Boss 更凶', '第一个 Boss 就教你别贪刀。', 20, 'Boss 战高光'),
      board(5, '结尾引导', '完整评测在主页，评论区聊聊你打到哪了。', 8, '竖屏结束卡'),
    ],
  });

  // ── 2. 已发布（抖音）：短平快，给平台对比留数据
  const t2: Topic = {
    id: `${DEMO_PREFIX}topic-2`,
    title: '恐怖新作《寂静岭 f》前 90 分钟',
    category: 'horror',
    status: 'published',
    difficulty: 2,
    estimatedViews: 80000,
    urgency: 'medium',
    notes: '恐怖游戏更适合短版切片，长版放 B站。',
    productionIdea: '剪「jump scare 密度」为切口，统计前 90 分钟的吓人次数。',
    gameDescription: '以日本乡村为舞台的系列新作，主打心理恐怖与雾中探索。',
    createdAt: now - 27 * DAY,
    updatedAt: now - 21 * DAY,
    evaluation: evaluation({
      score: 81,
      heatLevel: 86,
      competitionLevel: 64,
      difficulty: '中等',
      estimatedViews: '5w - 12w',
      bestPlatform: '抖音',
      suggestions: '短版把惊吓点前置到第 2 秒，长版保留完整叙事。',
      titleSuggestions: ['90 分钟被吓了 11 次，这款恐怖新作值得吗'],
    }),
    published: published('douyin', '《寂静岭 f》前 90 分钟：被吓了 11 次', now - 20 * DAY, {
      url: 'https://www.douyin.com/video/demo0002',
      duration: 118,
      views: 96000,
      likes: 8700,
      comments: 410,
      shares: 1500,
      favorites: 2300,
    }),
  };
  scripts.push({
    id: `${DEMO_PREFIX}script-3`,
    topicId: t2.id,
    platform: 'douyin',
    version: 'short',
    title: '90 分钟被吓 11 次，这作恐怖游戏够狠',
    hook: '第 2 秒就有东西从雾里出来。',
    notes: '竖屏，惊吓点卡在 2s / 14s / 31s。',
    createdAt: now - 26 * DAY,
    updatedAt: now - 22 * DAY,
    storyboards: [
      board(1, '雾中开门，第一声异响', '第 2 秒，它来了。', 4, '竖屏低照度画面', '亮度拉高但保留雾感'),
      board(2, '三个惊吓点连播', '90 分钟，我被吓了 11 次。', 26, '惊吓点快剪 + 计数角标'),
      board(3, '氛围对比：老版 vs 新版', '新版更安静，所以更吓人。', 30, '左右分屏'),
      board(4, '结尾追问', '敢一个人在夜里玩吗？', 8, '竖屏结束卡'),
    ],
  });

  // ── 3. 写稿中：卡牌选题，带动脚本页与素材页
  const t3: Topic = {
    id: `${DEMO_PREFIX}topic-3`,
    title: '炉石传说新版本 30 套卡组强度梯队',
    category: 'card',
    status: 'scripting',
    difficulty: 4,
    estimatedViews: 60000,
    urgency: 'high',
    notes: '版本更新首周做梯队，第二周做环境变化。',
    productionIdea: '按 T1/T2/T3 分档，每档配一套代表卡组的实战录像。',
    gameDescription: '新版本上线后环境尚未稳定，快攻与中速卡组并存。',
    createdAt: now - 9 * DAY,
    updatedAt: now - 1 * DAY,
    evaluation: evaluation({
      score: 76,
      heatLevel: 74,
      competitionLevel: 82,
      difficulty: '偏高',
      estimatedViews: '3w - 8w',
      suggestions: '梯队类内容同质化严重，用「上分实测胜率」做区分度。',
      risks: '版本首周数据波动大，结论容易被后续补丁推翻。',
    }),
    materialPlan: materialPlan(`${DEMO_PREFIX}script-4`, [
      {
        sceneNumber: 1,
        sceneDescription: '开场：新版本环境概览',
        dialogue: '版本刚更新三天，天梯已经变成了快攻的天下。',
        bgm: {
          needed: true,
          mood: '轻快、有推进感',
          keywords: '轻电子 节奏 卡牌',
          recommendations: [
            {
              title: '轻电子节奏 BGM（无版权）',
              description: '循环电子鼓点，适合卡牌讲解铺底。',
              reason: 'BPM 110 左右，不会盖过口播。',
              source: '免版权音乐库',
              searchLinks: [{ platform: '网易云音乐', url: 'https://music.163.com/' }],
              selected: true,
            },
          ],
        },
        sfx: {
          needed: true,
          mood: '清脆',
          keywords: '卡牌 翻页 抽卡音效',
          recommendations: [
            {
              title: '卡牌翻面与抽卡音效包',
              description: '包含抽卡、打出、攻击三类短音效。',
              reason: '与卡牌画面强关联，增强节奏。',
              source: '音效素材站',
              searchLinks: [{ platform: '爱给网', url: 'https://www.aigei.com/' }],
              selected: true,
            },
          ],
        },
        meme: { needed: false, mood: '', keywords: '', recommendations: [] },
        animation: {
          needed: true,
          mood: '简洁',
          keywords: '卡牌 特写 扫光',
          recommendations: [
            {
              title: '卡面扫光动效',
              description: '给卡面加一次高光扫过，强调单卡强度。',
              reason: '突出核心单卡，观众一眼看到重点。',
              source: 'AE 模板站',
              searchLinks: [{ platform: '新CG儿', url: 'https://www.newcger.com/' }],
              selected: true,
            },
          ],
        },
      },
      {
        sceneNumber: 2,
        sceneDescription: 'T1 卡组实战片段',
        dialogue: '先看第一梯队，这两套在钻石以上胜率都过了 55%。',
        bgm: {
          needed: true,
          mood: '紧张',
          keywords: '电子 紧张 对局',
          recommendations: [],
        },
        sfx: { needed: true, mood: '低沉', keywords: '对局 提示音', recommendations: [] },
        meme: {
          needed: true,
          mood: '搞笑',
          keywords: '上分 表情包',
          recommendations: [
            {
              title: '「上分失败」表情包',
              description: '连败时的自嘲表情，用于转场。',
              reason: '缓和教学内容的枯燥感。',
              source: '表情包素材',
              searchLinks: [{ platform: '斗图啦', url: 'https://www.doutula.com/' }],
              selected: false,
            },
          ],
        },
        animation: { needed: false, mood: '', keywords: '', recommendations: [] },
      },
    ]),
  };
  scripts.push({
    id: `${DEMO_PREFIX}script-4`,
    topicId: t3.id,
    platform: 'bilibili',
    version: 'long',
    title: '新版本 30 套卡组强度梯队（附上分实测胜率）',
    hook: '版本更新三天，天梯已经被两套卡组统治了。',
    notes: '需要补录 T1 卡组的三局实战素材。',
    createdAt: now - 8 * DAY,
    updatedAt: now - 1 * DAY,
    storyboards: [
      board(1, '开场：环境概览与数据来源', '三天时间，我打了 60 局，这是结论。', 30, '数据表格 + 天梯截图', '标注样本量与段位'),
      board(2, 'T1：两套统治级卡组', '这两套的胜率都在 55% 以上。', 140, '实机对局 + 关键回合回放', '每套给一套起手留牌'),
      board(3, 'T2：能上分但吃熟练度', '第二梯队更适合已经熟悉环境的玩家。', 120, '实机对局'),
      board(4, 'T3：娱乐向与针对卡组', '想上分就别碰这三套。', 90, '实机对局 + 胜率角标'),
      board(5, '总结与留牌速查表', '结尾这张表建议截图保存。', 45, '速查表全屏展示'),
    ],
  });
  scripts.push({
    id: `${DEMO_PREFIX}script-5`,
    topicId: t3.id,
    platform: 'douyin',
    version: 'short',
    title: '新版本两套无脑上分卡组',
    hook: '抄这两套，版本首周就能上分。',
    notes: '竖屏，卡组代码放在评论区。',
    createdAt: now - 8 * DAY,
    updatedAt: now - 3 * DAY,
    storyboards: [
      board(1, '开场亮卡组', '版本首周，这两套直接抄。', 5, '竖屏卡组展示'),
      board(2, '第一套：起手留牌', '留牌记住一句话：一费必留。', 22, '实机 + 手牌高亮'),
      board(3, '第二套：对局节奏', '这套不打后期，八费前结束。', 24, '实机快剪'),
      board(4, '结尾', '卡组代码在评论区，记得点赞。', 7, '竖屏结束卡'),
    ],
  });

  // ── 4. 已写完待发：动作游戏攻略
  const t4: Topic = {
    id: `${DEMO_PREFIX}topic-4`,
    title: '《艾尔登法环》DLC 隐藏 BOSS 逃课攻略',
    category: 'action',
    status: 'done',
    difficulty: 3,
    estimatedViews: 45000,
    urgency: 'medium',
    notes: '攻略类长尾流量稳定，适合排在工作日。',
    productionIdea: '一个 BOSS 一期，控制在 8 分钟内，结尾给逃课流总结。',
    gameDescription: 'DLC 新增的隐藏 BOSS 难度极高，存在地形与武器逃课解法。',
    createdAt: now - 15 * DAY,
    updatedAt: now - 3 * DAY,
    evaluation: evaluation({
      score: 72,
      heatLevel: 66,
      competitionLevel: 71,
      estimatedViews: '2w - 6w',
      suggestions: '攻略要把路线画清楚，观众最怕看半天找不到入口。',
    }),
  };
  scripts.push({
    id: `${DEMO_PREFIX}script-6`,
    topicId: t4.id,
    platform: 'bilibili',
    version: 'long',
    title: 'DLC 隐藏 BOSS 三种逃课打法（含路线图）',
    hook: '这个 BOSS 我死了 40 次，直到发现它能被地形卡住。',
    notes: '需要补一张手绘路线图。',
    createdAt: now - 6 * DAY,
    updatedAt: now - 3 * DAY,
    storyboards: [
      board(1, '开场：死亡合集', '死 40 次之后，我换了个思路。', 25, '死亡剪辑快切'),
      board(2, '路线图：怎么进隐藏区域', '入口在这里，很多人第一次都走错。', 60, '地图标注 + 实机走路'),
      board(3, '逃课一：地形卡位', '站在这个位置，它的 AI 就废了。', 90, '实机演示 + 站位标注'),
      board(4, '逃课二：武器与配装', '换一把出血武器，难度直接减半。', 70, '配装界面 + 伤害对比'),
      board(5, '逃课三：召唤与药水节奏', '别开局就召唤，等它进二阶段。', 55, '实机演示'),
    ],
  });

  // ── 5. 已批准：独立游戏选题
  const t5: Topic = {
    id: `${DEMO_PREFIX}topic-5`,
    title: '《潜水员戴夫》为什么让人停不下来',
    category: 'indie',
    status: 'approved',
    difficulty: 2,
    estimatedViews: 40000,
    urgency: 'low',
    notes: '偏「为什么好玩」的分析向，节奏可以慢一点。',
    productionIdea: '用「白天打鱼 / 晚上开店」的双循环解释成瘾机制。',
    gameDescription: '海洋探索 + 寿司店经营的双循环独立游戏，节奏轻快。',
    createdAt: now - 12 * DAY,
    updatedAt: now - 5 * DAY,
  };

  // ── 6. 调研中：手游行业观察
  const t6: Topic = {
    id: `${DEMO_PREFIX}topic-6`,
    title: '2026 年 Q1 手游氪金榜的三个变化',
    category: 'mobile',
    status: 'researching',
    difficulty: 3,
    estimatedViews: 35000,
    urgency: 'medium',
    notes: '等第三方榜单数据更新后再定稿。',
    productionIdea: '用榜单数据做动画图表，对比去年同期。',
    gameDescription: '需要横向对比多个数据源的统计口径。',
    createdAt: now - 6 * DAY,
    updatedAt: now - 2 * DAY,
    ideaEvaluation: {
      feasibilityScore: 68,
      strengths: ['数据驱动，容易做出可信度', '行业向内容容易被转载'],
      weaknesses: ['数据源口径不统一', '缺少一手信息，容易被质疑'],
      suggestions: '优先使用官方财报与第三方榜单交叉验证，所有数字标注来源与样本量。',
      recommendedApproach: '先把三个变化各写一句话结论，再补数据展开。',
      scriptFocus: '聚焦变化本身，不做全行业综述。',
      evaluatedAt: now - 5 * DAY,
    },
  };

  // ── 7. 想法阶段：行业资讯
  const t7: Topic = {
    id: `${DEMO_PREFIX}topic-7`,
    title: '主机厂商上调定价，对内容创作者意味着什么',
    category: 'industry',
    status: 'idea',
    difficulty: 2,
    estimatedViews: 25000,
    urgency: 'low',
    notes: '需要等官方口径确认后再做。',
    productionIdea: '从创作者成本结构切入，而不是单纯复述新闻。',
    gameDescription: '主机与游戏定价上涨，硬件成本上升引发讨论。',
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * DAY,
  };

  // ── 8. 本周新增：给首页「本周新增」与趋势图留出环比
  const t8: Topic = {
    id: `${DEMO_PREFIX}topic-8`,
    title: '《星露谷物语》1.7 更新前瞻',
    category: 'sim',
    status: 'researching',
    difficulty: 2,
    estimatedViews: 30000,
    urgency: 'medium',
    notes: '更新公告出来后 24 小时内出稿。',
    productionIdea: '逐条解读更新公告，标注对现有存档的影响。',
    gameDescription: '农场模拟经典作品，1.7 更新主要围绕 NPC 与节庆内容。',
    createdAt: now - 3 * DAY,
    updatedAt: now - 1 * DAY,
  };

  const t9: Topic = {
    id: `${DEMO_PREFIX}topic-9`,
    title: '《怪物猎人：荒野》大剑改动实测',
    category: 'action',
    status: 'published',
    difficulty: 3,
    estimatedViews: 70000,
    urgency: 'high',
    notes: '武器改动类内容适合做成对比视频。',
    productionIdea: '同一套连招在改动前后各打一遍，用伤害数字说话。',
    gameDescription: '大剑在本次更新中调整了蓄力与真蓄的判定时机。',
    createdAt: now - 18 * DAY,
    updatedAt: now - 11 * DAY,
    published: published('bilibili', '大剑改动实测：真蓄伤害提高了多少', now - 11 * DAY, {
      bvid: 'BV1demo0003',
      url: 'https://www.bilibili.com/video/BV1demo0003',
      duration: 486,
      views: 73000,
      likes: 5200,
      coins: 1400,
      favorites: 3100,
      shares: 280,
      comments: 360,
      danmaku: 900,
    }),
  };

  return {
    topics: [t1, t2, t3, t4, t5, t6, t7, t8, t9],
    scripts,
  };
}

// ───────────────────────── 营销工作台演示数据（简报 + 内容实验） ─────────────────────────
//
// 设计原则：
//  ★ 数据模式一律标「演示案例 / 非实绩」，与全站的数据诚实原则一致
//  ★ 实验状态只到「进行中」：工具会把演示实验强制显示为不可判定（样本门槛），
//    这正好向读者展示「样本不足不下结论」的守门机制，而不是绕过它
//  ★ 简报引用的传播触点与演示选题 / 脚本互相咬合（title 里能对上的都是同一批数据）

let planSeq = 0;
function touchPoint(partial: Omit<CampaignPlanItem, 'id'>): CampaignPlanItem {
  planSeq += 1;
  return { id: `${DEMO_PREFIX}plan-${planSeq}`, ...partial };
}

function buildDemoMarketing(now: number): {
  experiments: ContentExperiment[];
  briefs: GameMarketingBrief[];
} {
  planSeq = 0;

  // ── 实验 1：开场钩子结构。3 条已发布演示样本都挂进来，展示分组均值与混杂局限
  const exp1: ContentExperiment = {
    id: `${DEMO_PREFIX}exp-1`,
    title: '开场钩子：先给结论 vs 先铺氛围',
    hypothesis:
      '对游戏实机类视频，开场 3 秒先抛结论或数字（「死 40 次」「180 万人」）的开头，播放表现可能好于先铺氛围的开头。',
    variable: '开场钩子结构；品类、时长与发布平台尽量保持既有习惯（本组样本平台混杂，见结论）',
    metric: 'views',
    successThreshold: 100000,
    status: 'running',
    topicIds: [`${DEMO_PREFIX}topic-1`, `${DEMO_PREFIX}topic-2`, `${DEMO_PREFIX}topic-9`],
    assignments: [
      { topicId: `${DEMO_PREFIX}topic-1`, group: 'variant' },
      { topicId: `${DEMO_PREFIX}topic-9`, group: 'variant' },
      { topicId: `${DEMO_PREFIX}topic-2`, group: 'control' },
    ],
    conclusion:
      '观察：两条「先给结论」的 B站样本均值（约 13.0 万）高于「先铺氛围」的抖音样本（9.6 万），但平台与品类同时不同，属于混杂变量，不能把差异归因于钩子结构。',
    nextAction:
      '下一条恐怖游戏长版沿用「先给结论」钩子并与本组同平台样本对比；抖音侧保持原结构不变，避免同时改两个变量。',
    evidenceMode: 'demo',
    minimumSampleSize: 3,
    startedAt: now - 20 * DAY,
    updatedAt: now - 4 * DAY,
  };

  // ── 实验 2：标题句式。只挂 2 条 B站样本，故意低于门槛，展示「样本不足不判定」的守门逻辑
  const exp2: ContentExperiment = {
    id: `${DEMO_PREFIX}exp-2`,
    title: '标题疑问句 vs 陈述句：B站点击对比',
    hypothesis:
      '《科普研究》2023 的 B站研究（A 级证据）显示疑问句标题对点击有正向影响；在游戏区实测是否同样成立。',
    variable: '标题句式（疑问句 / 陈述句）；封面与发布时间保持既有习惯',
    metric: 'likes',
    status: 'running',
    topicIds: [`${DEMO_PREFIX}topic-1`, `${DEMO_PREFIX}topic-9`],
    assignments: [
      { topicId: `${DEMO_PREFIX}topic-1`, group: 'variant' },
      { topicId: `${DEMO_PREFIX}topic-9`, group: 'control' },
    ],
    conclusion:
      '样本 2 条，低于最低样本数 3，暂不判定。当前点赞观察：疑问句样本 1.24 万 vs 陈述句样本 0.52 万，仅作记录，不作为结论引用。',
    nextAction:
      '下一条 B站长版发布时用疑问句标题，回填数据凑满 3 条样本后再复盘；在此之前不改封面等其他变量。',
    evidenceMode: 'demo',
    minimumSampleSize: 3,
    startedAt: now - 30 * DAY,
    updatedAt: now - 4 * DAY,
  };

  // ── 简报 1：寂静岭 f 发售期传播计划（与已发布的抖音演示选题 t2 对应）
  const brief1: GameMarketingBrief = {
    id: `${DEMO_PREFIX}brief-1`,
    title: '寂静岭 f · 发售期「惊吓密度实测」传播计划',
    gameTitle: '寂静岭 f（Silent Hill f）',
    versionName: '全球发售窗口',
    objective:
      '在恐怖新品发售窗口建立「量化惊吓密度」的内容差异点，服务不敢盲买的观望玩家与云玩家：让「吓不吓人、值不值得首发入」有一个可引用的实测答案。业务目标：发售首两周内成为「寂静岭 f 实测」相关搜索的高相关结果，并为恐怖品类沉淀一个可复用的栏目形制。',
    targetAudience:
      '系列老粉与恐怖游戏爱好者：一部分是「想玩但不敢独自玩」的云玩家，一部分在观望首发是否值得入手；两类人共同的决策问题是「到底有多吓人」。',
    audienceInsight:
      '本站分析报告显示恐怖品类是 B站游戏区当前播放水位最高的品类（播放中位 147.7 万，n=30，快照口径，不能外推全体）；同类视频评论区高频问题集中在「吓不吓人」「要不要首发买」。待验证假设：把 jump scare 次数做成可计数的角标，能同时服务云玩家（安心看）与老粉（判断强度）。',
    keySellingPoints: [
      '前 90 分钟被吓 11 次：把「吓人程度」量化成可截图传播的数字',
      '老版 vs 新版氛围分屏对比：给系列老粉的判断依据',
      '第 2 秒第一个惊吓点：短版切片直接前置高潮',
    ],
    evidenceNotes:
      '官方发售公告与试玩报道（公开资料）；品类水位来自本站分析报告（自采样快照，A 级口径）；「第 2 秒惊吓点」为个人经验假设，发布后依评论区反馈修正。',
    budgetNote:
      '个人创作者：无买量预算，制作窗口 48 小时；素材为自录实机画面，剪辑需避免纯 jump scare 堆砌带来的观感风险。',
    successDefinition:
      '上线后 7 天回填数据：抖音短版播放 ≥ 10 万（触点预设目标，非预测）；长版评论区收集到 ≥ 20 条有效购买决策讨论。目标值为预设，实际以复盘为准。',
    plan: [
      touchPoint({
        phase: 'teaser',
        publishAt: now - 22 * DAY,
        channel: 'B站动态 + 抖音',
        contentAngle: '发售倒计时：这作凭什么让系列老粉等了 13 年——逐帧拆预告片里的怪设计与心理恐怖基调',
        targetMetric: '动态互动',
        targetValue: 500,
        status: 'published',
      }),
      touchPoint({
        phase: 'launch',
        publishAt: now - 20 * DAY,
        channel: '抖音',
        contentAngle: '短版切片《前 90 分钟被吓 11 次》：惊吓点计数角标 + 老新版分屏，高潮前置到第 2 秒',
        targetMetric: '播放',
        targetValue: 100000,
        status: 'published',
        linkedTopicId: `${DEMO_PREFIX}topic-2`,
      }),
      touchPoint({
        phase: 'launch',
        publishAt: now - 19 * DAY,
        channel: 'B站',
        contentAngle: '长版完整实测：惊吓点逐个标注时间戳，结尾给「首发 / 观望 / 云」三类人群各自的购买建议',
        targetMetric: '播放',
        targetValue: 80000,
        status: 'planned',
      }),
      touchPoint({
        phase: 'sustain',
        publishAt: now - 6 * DAY,
        channel: 'B站 + 社群',
        contentAngle: '汇总评论区高频问题做「值不值得买」追踪一期，把购买决策讨论沉淀成固定栏目',
        targetMetric: '涨粉',
        status: 'planned',
      }),
    ],
    retrospective:
      '演示复盘：抖音短版实际播放 9.6 万，高于 AI 预测（8 万）20%，低于触点预设目标（10 万）4%；「数吓了几次」成为评论区记忆点，量化角标的方向得到初步印证——但样本只有 1 条，不构成结论。B站长版尚未发布，发布后补充同渠道对照。',
    linkedExperimentId: `${DEMO_PREFIX}exp-1`,
    dataMode: 'demo',
    createdAt: now - 24 * DAY,
    updatedAt: now - 4 * DAY,
  };

  // ── 简报 2：星露谷 1.7 更新解读计划（与调研中的选题 t8 对应，尚未执行所以无复盘）
  const brief2: GameMarketingBrief = {
    id: `${DEMO_PREFIX}brief-2`,
    title: '星露谷物语 1.7 · 更新解读内容计划',
    gameTitle: '星露谷物语（Stardew Valley）',
    versionName: '1.7 更新',
    objective:
      '抢「更新公告解读」的时效窗口：公告发布后 24 小时内发布逐条解读，重点回答官方公告不直接回答的问题——「现有存档还能不能玩」。目标：让这条视频成为本账号在模拟经营品类的第一条过 5 万播放的内容（品类水位参考线，预设目标非预测）。',
    targetAudience:
      '有存档的老玩家（担心更新破坏存档）、考虑回坑的流失玩家（想知道 1.7 值不值得回坑）；前者决定首发互动，后者决定长尾搜索。',
    audienceInsight:
      '公告解读类内容的时效窗口约 48 小时，搜索意图集中在「改动列表」「存档兼容」；官方公告通常不覆盖存档影响，社区 Wiki 更新有滞后（来源：过往版本更新期的观察，经验假设，待本次发布验证）。',
    keySellingPoints: [
      '逐条标注「对现有存档的影响」——公告没写的部分实机验证后补充',
      '回坑成本一图流：可继承 / 需重开 / 受影响玩法',
      '节庆与 NPC 内容变化对照表',
    ],
    evidenceNotes:
      '官方更新公告（待发布，发布后逐条核对）；模拟经营品类水位来自本站分析报告（播放中位 52.9 万，n=30，自采样快照）；存档影响判断以实机测试为准，发布前先标注「待验证」。',
    budgetNote: '个人创作者：时效内容把制作时长压在 24 小时内；无额外预算，素材以公告截图 + 实机验证为主。',
    successDefinition:
      '发布后 7 天播放 ≥ 5 万（模拟经营品类水位线的自定义参考，非行业标准）；评论区收集 ≥ 15 个存档相关问题，回填进选题池作为后续选题。',
    plan: [
      touchPoint({
        phase: 'teaser',
        publishAt: now + 2 * DAY,
        channel: 'B站动态',
        contentAngle: '更新倒计时投票：你最关心 1.7 的哪个改动——用投票结果决定解读的侧重顺序',
        targetMetric: '投票参与',
        targetValue: 300,
        status: 'planned',
      }),
      touchPoint({
        phase: 'launch',
        publishAt: now + 4 * DAY,
        channel: 'B站',
        contentAngle: '逐条解读公告：每个改动标注「对存档的影响」，结尾给回坑 / 观望 / 重开三类建议',
        targetMetric: '播放',
        targetValue: 50000,
        status: 'planned',
        linkedTopicId: `${DEMO_PREFIX}topic-8`,
      }),
      touchPoint({
        phase: 'sustain',
        publishAt: now + 11 * DAY,
        channel: 'B站 + 抖音',
        contentAngle: '存档迁移指南：回答评论区高频问题，做成可长尾搜索的攻略向内容',
        targetMetric: '搜索流量',
        status: 'planned',
      }),
    ],
    retrospective: '',
    dataMode: 'demo',
    createdAt: now - 3 * DAY,
    updatedAt: now - 1 * DAY,
  };

  return { experiments: [exp1, exp2], briefs: [brief1, brief2] };
}
