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
import type {
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

/** 当前库里的演示数据条数（选题 + 脚本） */
export async function countDemoData(): Promise<number> {
  const [topics, scripts] = await Promise.all([
    db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).count(),
    db.scripts.filter((s) => s.id.startsWith(DEMO_PREFIX)).count(),
  ]);
  return topics + scripts;
}

/** 清空演示数据（只删 `demo-` 前缀，真实数据不受影响） */
export async function clearDemoData(): Promise<void> {
  await db.transaction('rw', db.topics, db.scripts, async () => {
    await db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).delete();
    await db.scripts.filter((s) => s.id.startsWith(DEMO_PREFIX)).delete();
  });
  setDemoState('off');
  await reloadStores();
}

/** 一键载入演示数据（重复点击会先清空再写入，不会变成两份） */
export async function seedDemoData(): Promise<{ topics: number; scripts: number }> {
  const { topics, scripts } = buildDemoDataset(Date.now());
  await db.transaction('rw', db.topics, db.scripts, async () => {
    await db.topics.filter((t) => t.id.startsWith(DEMO_PREFIX)).delete();
    await db.scripts.filter((s) => s.id.startsWith(DEMO_PREFIX)).delete();
    await db.topics.bulkPut(topics);
    await db.scripts.bulkPut(scripts);
  });
  setDemoState('on');
  await reloadStores();
  return { topics: topics.length, scripts: scripts.length };
}

/**
 * 首次访问自动载入：本地库完全是空的、且用户没主动关掉时才会写入。
 * 这样 HR 打开站点的第一眼看到的不是一片空白。
 */
export async function ensureDemoData(): Promise<boolean> {
  if (getDemoState() === 'off') return false;
  const total = await db.topics.count();
  if (total > 0) return false;
  await seedDemoData();
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
