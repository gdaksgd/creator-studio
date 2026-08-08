import OpenAI from 'openai';
import { config, isAIConfigured } from '../config.js';
import { db } from '../db.js';
import type { TopicEvaluation, ScriptSuggestion, NewsItem, IdeaEvaluation, TitleEvaluation, MaterialAnalysisResponse, AnimeSource } from '../types.js';

function getClient(): OpenAI {
  return new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: config.deepseekApiKey,
  });
}

export async function evaluateTopic(
  topicTitle: string,
  category: string,
  notes: string,
  gameDescription?: string
): Promise<TopicEvaluation> {
  if (!isAIConfigured()) {
    throw new Error('AI 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
  }

  const accountInfo = db.getAccountInfo();
  const recentNews = db.getNews()
    .filter((n) => n.category === category)
    .slice(0, 10);

  const newsContext = recentNews
    .map((n) => `- ${n.title}（来源: ${n.source}，${n.metrics?.views ? n.metrics.views + '播放' : ''}）`)
    .join('\n');

  const isHorror = category === 'horror';
  const gameInfoSection = isHorror && gameDescription && gameDescription.trim()
    ? `\n## 游戏信息\n游戏标题: ${topicTitle}\n游戏简介: ${gameDescription}\n`
    : '';

  const horrorPrompt = isHorror
    ? `## 评估重点
你正在评估一款恐怖游戏作为视频选题的可行性。请严格基于上面提供的游戏标题和游戏简介来分析，不要引用、对比或提及其他未在简介中出现的游戏作品（如寂静岭、生化危机、逃生等）。

如果你不熟悉这款游戏，请基于提供的简介内容进行推断分析，不要臆想游戏的具体内容、机制或场景。

分析要点：
1. 根据简介描述，这款游戏有哪些适合做视频的恐怖元素（Jump Scare、心理恐怖、氛围营造等）
2. 游戏的观赏性如何？观众看别人玩会觉得有趣吗？
3. 这个游戏目前在B站/抖音上的热度如何？是否值得追热点？
4. 适合做什么类型的视频（实况reaction、剧情解说、恐怖游戏合集等）`
    : '';

  const prompt = `你是一个B站和抖音游戏视频自媒体运营专家，擅长分析选题可行性。

## 当前选题
标题: ${topicTitle}
分类: ${isHorror ? '恐怖游戏' : '卡牌游戏'}
${isHorror ? '' : `备注: ${notes || '无'}`}
${gameInfoSection}
## 创作者账号情况
- B站粉丝: ${accountInfo.bilibiliFollowers}
- B站平均播放: ${accountInfo.bilibiliAvgViews}
- 抖音粉丝: ${accountInfo.douyinFollowers}
- 抖音平均播放: ${accountInfo.douyinAvgViews}
- 已发布视频数: ${accountInfo.totalVideos}
- 活跃天数: ${accountInfo.daysActive}
- 内容方向: ${accountInfo.contentFocus}

## 最近相关热门资讯
${newsContext || '暂无数据'}

${horrorPrompt}

## 请评估
请严格按以下JSON格式返回，不要有任何其他文字：

{
  "score": 1-100的整数,
  "heatLevel": 1-10的整数,
  "competitionLevel": 1-10的整数,
  "difficulty": "制作难度描述",
  "estimatedViews": "预估播放量区间",
  "suggestions": "具体建议，${isHorror ? '包括适合的视频类型和切入角度' : '包括切入角度和内容方向'}",
  "titleSuggestions": ["建议视频标题1", "建议视频标题2", "建议视频标题3"],
  "risks": "潜在风险和注意事项",
  "bestPlatform": "B站/抖音/双平台",
  "bestTime": "最佳发布时间建议"
}`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      score: 0,
      heatLevel: 0,
      competitionLevel: 0,
      difficulty: '解析失败',
      estimatedViews: '未知',
      suggestions: content,
      titleSuggestions: [],
      risks: '未知',
      bestPlatform: '未知',
      bestTime: '未知',
    };
  }
}

export async function evaluateProductionIdea(
  topicTitle: string,
  category: string,
  productionIdea: string,
  gameDescription?: string
): Promise<IdeaEvaluation> {
  if (!isAIConfigured()) {
    throw new Error('AI 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
  }

  if (!productionIdea || !productionIdea.trim()) {
    throw new Error('请先填写制作思路');
  }

  const accountInfo = db.getAccountInfo();
  const recentNews = db.getNews()
    .filter((n) => n.category === category)
    .slice(0, 5);

  const newsContext = recentNews
    .map((n) => `- ${n.title}（${n.metrics?.views ? n.metrics.views + '播放' : ''}）`)
    .join('\n');

  const isHorror = category === 'horror';
  const gameInfoSection = isHorror && gameDescription && gameDescription.trim()
    ? `\n## 游戏信息\n游戏标题: ${topicTitle}\n游戏简介: ${gameDescription}\n`
    : '';

  const prompt = `你是一个B站和抖音游戏视频制作资深顾问，擅长评估视频制作思路的可行性。

## 选题信息
标题: ${topicTitle}
分类: ${category === 'card' ? '卡牌游戏' : '恐怖游戏'}
${gameInfoSection}
## 创作者的制作思路
${productionIdea}

## 创作者账号情况
- B站粉丝: ${accountInfo.bilibiliFollowers}，平均播放: ${accountInfo.bilibiliAvgViews}
- 抖音粉丝: ${accountInfo.douyinFollowers}，平均播放: ${accountInfo.douyinAvgViews}
- 已发布视频: ${accountInfo.totalVideos}个，活跃${accountInfo.daysActive}天

## 最近相关热门内容
${newsContext || '暂无数据'}

${isHorror ? `## 重要提示
- 请仅根据上面提供的游戏标题和游戏简介来分析这款游戏，不要引用、对比或提及其他未在简介中出现的游戏作品（如寂静岭、生化危机等）。
- 如果你不熟悉这款游戏，请基于提供的简介内容进行推断分析，不要臆想游戏的具体内容或机制。
- 所有建议都必须针对这款具体游戏，而不是泛泛的恐怖游戏通用建议。
` : ''}
## 请评估这个制作思路
请从以下角度分析：
1. 这个思路是否可行？适合创作者当前阶段吗？
2. 有哪些亮点和优势？
3. 有哪些潜在问题或风险？
4. 如何改进和优化？
5. 对后续脚本编写有什么具体指导？

请严格按以下JSON格式返回，不要有任何其他文字：

{
  "feasibilityScore": 1-100的整数,
  "strengths": ["亮点1", "亮点2", "亮点3"],
  "weaknesses": ["问题1", "问题2"],
  "suggestions": "具体的改进建议和优化方向",
  "recommendedApproach": "推荐的最终制作方向和切入角度",
  "scriptFocus": "脚本编写时需要重点关注的核心要素"
}`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content || '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      feasibilityScore: 0,
      strengths: [],
      weaknesses: [],
      suggestions: content || '解析失败',
      recommendedApproach: '未知',
      scriptFocus: '未知',
    };
  }
}

export async function suggestScript(
  topicTitle: string,
  category: string,
  platform: string,
  version: string,
  scriptTitle: string,
  hook: string,
  storyboards: any[]
): Promise<ScriptSuggestion> {
  if (!isAIConfigured()) {
    throw new Error('AI 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
  }

  const scriptContent = storyboards.length > 0
    ? storyboards.map((b) => `第${b.sceneNumber}镜 (${b.duration}秒): ${b.description} | 台词: ${b.dialogue}`).join('\n')
    : '（空脚本）';

  const platformDesc = platform === 'bilibili'
    ? 'B站（3-15分钟长视频，需要深度和节奏感）'
    : '抖音（15-60秒短视频，需要快节奏和高密度）';

  const prompt = `你是一个B站和抖音游戏视频脚本专家。请根据以下信息给出脚本建议。

## 视频信息
选题: ${topicTitle}
分类: ${category === 'card' ? '卡牌游戏' : '恐怖游戏'}
平台: ${platformDesc}
版本: ${version === 'long' ? '长版' : '短版'}
当前标题: ${scriptTitle || '未设定'}
开场钩子: ${hook || '未设定'}

## 当前脚本内容
${scriptContent}

## 请给出建议
请严格按以下JSON格式返回，不要有任何其他文字：

{
  "hookSuggestions": ["钩子建议1", "钩子建议2", "钩子建议3"],
  "structureAdvice": "结构建议，包括整体框架和段落安排",
  "pacingAdvice": "节奏控制建议，包括快慢搭配和情绪起伏",
  "dialogueTips": ["台词技巧1", "台词技巧2", "台词技巧3"],
  "improvementPoints": ["改进点1", "改进点2", "改进点3"],
  "b-rollIdeas": ["B-roll画面建议1", "B-roll画面建议2", "B-roll画面建议3"]
}`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 1000,
  });

  const content = response.choices[0]?.message?.content || '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      hookSuggestions: [],
      structureAdvice: content,
      pacingAdvice: '',
      dialogueTips: [],
      improvementPoints: [],
      'b-rollIdeas': [],
    };
  }
}

/**
 * 评估恐怖游戏视频标题的可行性，并给出吸睛备选标题
 */
export async function evaluateScriptTitle(
  gameTitle: string,
  gameDescription: string,
  scriptTitle: string,
  category: string
): Promise<TitleEvaluation> {
  if (!isAIConfigured()) {
    throw new Error('AI 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
  }

  if (!scriptTitle || !scriptTitle.trim()) {
    throw new Error('请先输入视频标题');
  }

  const recentNews = db.getNews()
    .filter((n) => n.category === 'horror')
    .slice(0, 5);
  const newsContext = recentNews
    .map((n) => `- ${n.title}（${n.metrics?.views ? n.metrics.views + '播放' : ''}）`)
    .join('\n');

  const prompt = `你是B站和抖音恐怖游戏视频的标题优化专家，擅长写出高点击率、吸睛但不标题党的视频标题。

## 游戏信息
游戏标题: ${gameTitle}
游戏简介: ${gameDescription || '暂无'}
分类: ${category === 'horror' ? '恐怖游戏' : '卡牌游戏'}

## 创作者的视频标题
${scriptTitle}

## 最近恐怖游戏热门视频标题参考
${newsContext || '暂无数据'}

## 重要提示
- 请仅根据上面提供的游戏标题和游戏简介来分析这款游戏，不要引用、对比或提及其他未在简介中出现的游戏作品（如寂静岭、生化危机、逃生等）。
- 如果你不熟悉这款游戏，请基于提供的简介内容进行推断分析，不要臆想游戏的具体内容或机制。
- 备选标题必须与这款具体游戏相关，不要出现其他游戏的名字。

## 请评估这个标题
从以下角度分析：
1. 这个标题是否吸睛？能否在前3秒抓住观众注意力？
2. 标题是否准确反映了视频内容？有没有误导或标题党嫌疑？
3. 标题在搜索和推荐中的表现会如何？（关键词、SEO）
4. 给出5个更吸睛的备选标题，风格可以多样（悬念型、挑战型、reaction型等），但必须与这款游戏直接相关

请严格按以下JSON格式返回，不要有任何其他文字：

{
  "score": 1-100的整数，表示标题吸引力评分,
  "analysis": "对当前标题的详细分析，包括优点和不足",
  "strengths": ["标题优点1", "标题优点2"],
  "weaknesses": ["标题不足1", "标题不足2"],
  "alternativeTitles": ["备选标题1", "备选标题2", "备选标题3", "备选标题4", "备选标题5"]
}`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content || '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      score: 0,
      analysis: content || '解析失败',
      strengths: [],
      weaknesses: [],
      alternativeTitles: [],
    };
  }
}

/**
 * 批量翻译英文标题为中文
 * 仅翻译主要含英文字符的标题，中文标题跳过
 */
export async function translateTitles(items: { id: string; title: string }[]): Promise<Map<string, string>> {
  if (!isAIConfigured()) {
    console.log('[AI] Translation skipped: AI not configured');
    return new Map();
  }

  // Only translate items with predominantly English text
  const toTranslate = items.filter((item) => {
    const chineseChars = (item.title.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = item.title.replace(/\s/g, '').length;
    return totalChars > 0 && chineseChars / totalChars < 0.3; // less than 30% Chinese
  });

  if (toTranslate.length === 0) {
    console.log('[AI] No English titles to translate');
    return new Map();
  }

  console.log(`[AI] Translating ${toTranslate.length} English titles...`);

  const titles = toTranslate.map((t, i) => `${i + 1}. ${t.title}`).join('\n');

  const prompt = `你是一个游戏新闻翻译助手。请将以下英文游戏新闻标题翻译成简洁流畅的中文。
保持游戏术语的准确性（如游戏名、专业术语保留原名或用通用译名）。
只返回翻译结果，每行一个，格式为 "序号. 中文翻译"，不要添加任何解释。

${titles}`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || '';
  const translations = new Map<string, string>();

  // Parse numbered list
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.+)/);
    if (match) {
      const idx = parseInt(match[1]) - 1;
      if (idx >= 0 && idx < toTranslate.length) {
        translations.set(toTranslate[idx].id, match[2].trim());
      }
    }
  }

  console.log(`[AI] Translated ${translations.size} titles`);
  return translations;
}

export async function generateScriptDraft(
  topicTitle: string,
  category: string,
  platform: string,
  version: string,
  productionIdea?: string,
  gameDescription?: string
): Promise<{ hook: string; storyboards: any[] }> {
  if (!isAIConfigured()) {
    throw new Error('AI 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
  }

  const isCard = category === 'card';
  const isBilibili = platform === 'bilibili';
  const isLong = version === 'long';

  const duration = isBilibili ? (isLong ? '5-10分钟' : '1-3分钟') : (isLong ? '60秒' : '30秒');
  const boardCount = isBilibili && isLong ? 8 : isBilibili ? 4 : 3;

  const ideaSection = productionIdea && productionIdea.trim()
    ? `\n## 创作者的制作思路（请务必参考这个方向来生成脚本）\n${productionIdea}\n`
    : '';

  const gameInfoSection = !isCard && gameDescription && gameDescription.trim()
    ? `\n## 游戏简介\n${gameDescription}\n`
    : '';

  const horrorConstraint = !isCard
    ? `\n## 重要提示\n- 请仅根据上面提供的游戏标题和简介来生成脚本，不要引用或提及其他未在简介中出现的游戏作品。\n- 脚本中的画面描述和台词必须与这款具体游戏相关。\n`
    : '';

  const prompt = `你是一个B站和抖音游戏视频脚本专家。请为以下选题生成一个完整的分镜脚本框架。

## 选题信息
选题: ${topicTitle}
分类: ${isCard ? '卡牌游戏' : '恐怖游戏'}
平台: ${isBilibili ? 'B站' : '抖音'}
版本: ${isLong ? '长版' : '短版'}
预计时长: ${duration}
分镜数量: ${boardCount}个
${gameInfoSection}${ideaSection}
${isCard ? '## 卡牌游戏脚本要点\n- 需要清晰的策略分析\n- 展示卡组构筑思路或对局思路\n- 用数据支撑观点\n- 适合深度内容' : '## 恐怖游戏脚本要点\n- 前几秒必须有强冲击力的画面或声音\n- 情绪节奏：紧张→释放→紧张→高潮\n- 适当加入reaction和吐槽\n- 氛围营造很重要'}${horrorConstraint}

请严格按以下JSON格式返回，不要有任何其他文字：

{
  "hook": "开场3-5秒的钩子台词",
  "storyboards": [
    {
      "sceneNumber": 1,
      "description": "画面描述",
      "dialogue": "台词内容",
      "duration": 秒数,
      "visualDirection": "视觉方向",
      "notes": "备注"
    }
  ]
}

确保生成 ${boardCount} 个分镜，总时长在 ${duration} 范围内。${ideaSection ? '脚本内容要与创作者的制作思路保持一致。' : ''}`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      hook: parsed.hook || '',
      storyboards: (parsed.storyboards || []).map((b: any, i: number) => ({
        id: crypto.randomUUID(),
        sceneNumber: i + 1,
        description: b.description || '',
        dialogue: b.dialogue || '',
        duration: b.duration || 30,
        visualDirection: b.visualDirection || '',
        notes: b.notes || '',
      })),
    };
  } catch {
    return { hook: '', storyboards: [] };
  }
}

// ===== 素材工坊 =====

function detectAnimeGame(topicTitle: string): { hasAnime: boolean; animeName: string; animeSeries: string[] } {
  const title = topicTitle.toLowerCase();
  if (title.includes('游戏王') || title.includes('yu-gi-oh') || title.includes('遊戯王') || title.includes('yugioh')) {
    return {
      hasAnime: true,
      animeName: '游戏王',
      animeSeries: ['游戏王DM', '游戏王GX', "游戏王5D's", '游戏王ZEXAL', '游戏王ARC-V', '游戏王VRAINS', '游戏王SEVENS', '游戏王GO RUSH!!'],
    };
  }
  if (title.includes('影之诗') || title.includes('shadowverse')) {
    return {
      hasAnime: true,
      animeName: '影之诗',
      animeSeries: ['影之诗动画'],
    };
  }
  return { hasAnime: false, animeName: '', animeSeries: [] };
}

function buildAnimeBgmSearchLinks(animeName: string, trackTitle: string, animeSource?: AnimeSource): { platform: string; url: string }[] {
  const seriesPart = animeSource?.series || animeName;
  const encoded = encodeURIComponent(`${seriesPart} BGM ${trackTitle}`);
  const encodedJp = encodeURIComponent(`${animeName} OST ${trackTitle}`);
  return [
    { platform: 'B站搜索', url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(seriesPart + ' BGM ' + trackTitle)}` },
    { platform: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodedJp}+OST` },
    { platform: '网易云', url: `https://music.163.com/#/search/m/?s=${encodeURIComponent(animeName + ' ' + trackTitle)}` },
  ];
}

function buildAnimeClipSearchLinks(animeName: string, animeSource?: AnimeSource): { platform: string; url: string }[] {
  if (animeSource) {
    const query = `${animeSource.series} ${animeSource.episode}`;
    return [
      { platform: 'B站搜索', url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}` },
      { platform: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(animeSource.series + ' ' + animeSource.episode)}` },
    ];
  }
  return [
    { platform: 'B站搜索', url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(animeName + ' 名场面')}` },
    { platform: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(animeName + ' anime scene')}` },
  ];
}

function buildSearchLinks(type: string, keywords: string): { platform: string; url: string }[] {
  const encoded = encodeURIComponent(keywords);
  switch (type) {
    case 'bgm':
      return [
        { platform: 'Pixabay Music', url: `https://pixabay.com/music/search/${encoded}/` },
        { platform: 'Mixkit Music', url: `https://mixkit.co/free-stock-music/?q=${encoded}` },
        { platform: 'YouTube', url: `https://www.youtube.com/results?search_query=${encoded}+royalty+free+music` },
      ];
    case 'sfx':
      return [
        { platform: 'Freesound', url: `https://freesound.org/search/?q=${encoded}` },
        { platform: 'Pixabay SFX', url: `https://pixabay.com/sound-effects/search/${encoded}/` },
        { platform: 'Mixkit SFX', url: `https://mixkit.co/free-sound-effects/?q=${encoded}` },
      ];
    case 'meme':
      return [
        { platform: 'B站搜索', url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keywords + ' 表情包')}` },
        { platform: '抖音搜索', url: `https://www.douyin.com/search/${encodeURIComponent(keywords + ' 表情包')}` },
        { platform: 'Google图片', url: `https://www.google.com/search?q=${encodeURIComponent(keywords + ' meme 表情包')}&tbm=isch` },
      ];
    case 'animation':
      return [
        { platform: 'Mixkit Video', url: `https://mixkit.co/free-stock-video/?q=${encoded}` },
        { platform: 'Pixabay Video', url: `https://pixabay.com/videos/search/${encoded}/` },
        { platform: 'Coverr', url: `https://coverr.co/s/${encoded}` },
      ];
    default:
      return [];
  }
}

function processRecommendations(
  type: string,
  recs: any[],
  animeName?: string
): any[] {
  if (!Array.isArray(recs)) return [];
  return recs.map((r) => {
    const isOfficial = r.isOfficial === true;
    const animeSource = r.animeSource || undefined;
    let searchLinks: { platform: string; url: string }[];

    if (isOfficial && animeName) {
      if (type === 'bgm') {
        searchLinks = buildAnimeBgmSearchLinks(animeName, r.title || r.searchKeywords || r.keywords || '', animeSource);
      } else if (type === 'animation') {
        searchLinks = buildAnimeClipSearchLinks(animeName, animeSource);
      } else {
        searchLinks = buildSearchLinks(type, r.searchKeywords || r.keywords || r.title || '');
      }
    } else {
      searchLinks = buildSearchLinks(type, r.searchKeywords || r.keywords || r.title || '');
    }

    return {
      title: r.title || r.name || '未命名素材',
      description: r.description || r.desc || '',
      reason: r.reason || r.why || '',
      source: r.source || '',
      searchLinks,
      selected: false,
      isOfficial,
      animeSource,
    };
  });
}

export async function analyzeMaterialNeeds(
  topicTitle: string,
  category: string,
  productionIdea: string,
  gameDescription: string,
  scriptTitle: string,
  hook: string,
  storyboards: any[]
): Promise<MaterialAnalysisResponse> {
  if (!isAIConfigured()) {
    throw new Error('AI 未配置，请在 .env 中设置 DEEPSEEK_API_KEY');
  }

  if (!storyboards || storyboards.length === 0) {
    throw new Error('脚本没有分镜，无法分析素材需求');
  }

  const isHorror = category === 'horror';
  const animeInfo = detectAnimeGame(topicTitle);

  const storyboardText = storyboards
    .map((b) => `第${b.sceneNumber}镜 (${b.duration}秒): ${b.description} | 台词: ${b.dialogue} | 视觉方向: ${b.visualDirection || '无'}`)
    .join('\n');

  const gameInfoSection = isHorror && gameDescription && gameDescription.trim()
    ? `\n## 游戏简介\n${gameDescription}\n`
    : '';

  const ideaSection = productionIdea && productionIdea.trim()
    ? `\n## 创作者的制作思路\n${productionIdea}\n`
    : '';

  const horrorConstraint = isHorror
    ? `\n## 重要提示\n- 请仅根据上面提供的游戏标题和简介来分析，不要引用或提及其他未在简介中出现的游戏作品。\n- 所有素材推荐必须与这款具体游戏的相关场景匹配。\n`
    : '';

  const animeSection = animeInfo.hasAnime
    ? `\n## 官方动画素材优先规则
本视频的游戏《${topicTitle}》有官方动画作品（${animeInfo.animeSeries.join('、')}）。
在推荐BGM和动画素材时，必须优先使用官方动画中的素材：

### BGM优先规则：
1. 根据每个分镜的场景内容，回忆该游戏动画中类似场景使用的BGM
2. 动画BGM推荐必须包含 isOfficial: true 和 animeSource 字段
3. animeSource 格式：{ "series": "动画系列名", "episode": "集数", "timestamp": "大致时间点" }
   - series 示例："游戏王DM"、"游戏王GX"、"游戏王5D's" 等
   - episode 示例："第96集" 或 "EP96"
   - timestamp 示例："18:30" 或 "约18分钟处"
4. title 填写BGM曲名（如知道）或场景描述（如"激戦 - 热血决斗BGM"）
5. 动画BGM推荐排在 recommendations 数组前面
6. 如果某个分镜的场景在动画中找不到对应BGM，再推荐通用免费BGM（isOfficial: false，不需要animeSource）
7. BGM推荐可增加到3个（1-2个动画BGM + 1个通用fallback）

### 动画素材优先规则：
1. 如果场景适合引用动画中的名场面/片段，优先推荐官方动画片段
2. 动画片段推荐也要包含 isOfficial: true 和 animeSource
3. 同时保留转场动画效果（如故障转场、缩放等）作为补充，isOfficial: false
`
    : '';

  const prompt = `你是B站和抖音游戏视频的素材顾问，擅长根据脚本分镜为每个场景匹配合适的素材。

## 视频信息
选题: ${topicTitle}
分类: ${isHorror ? '恐怖游戏' : '卡牌游戏'}
视频标题: ${scriptTitle || '未设定'}
开场钩子: ${hook || '无'}
${gameInfoSection}${ideaSection}
## 脚本分镜
${storyboardText}
${horrorConstraint}${animeSection}
## 任务
请为每个分镜分析以下四类素材的需求：

### 1. BGM（背景音乐）
分析该场景需要什么风格/情绪的BGM。${animeInfo.hasAnime ? '优先推荐该游戏官方动画中使用过的BGM（isOfficial: true，附带animeSource），如果找不到合适的动画BGM再推荐通用免费音乐。' : '推荐具体的免费音乐资源，给出搜索关键词（英文优先，便于在Pixabay/Mixkit等平台搜索）。'}
推荐示例：${animeInfo.hasAnime ? '标题"激戦 - 热血决斗BGM"，animeSource: { series: "游戏王DM", episode: "第96集", timestamp: "18:30" }' : '标题"Sneaky Snitch风格 - 轻快悬疑"，描述"轻快的钢琴旋律配合悬疑氛围"，搜索关键词"sneaky snitch light suspense piano"'}

### 2. SFX（音效）
分析该场景需要什么音效（如心跳、脚步、打击、环境音等）。推荐具体音效类型，给出英文搜索关键词。
推荐示例：标题"快速心跳音效"，搜索关键词"heartbeat fast tension"

### 3. 表情包
分析该场景适合配什么表情包/反应图。描述需要的表情/情绪，给出中文搜索关键词。
推荐示例：标题"震惊脸表情包"，搜索关键词"震惊"

### 4. 动画素材
分析该场景需要什么动画/转场效果。${animeInfo.hasAnime ? '如果场景适合引用官方动画中的名场面/片段，优先推荐动画片段（isOfficial: true，附带animeSource）。同时保留转场动画效果（如故障转场、缩放等）作为补充。' : '推荐具体转场效果（如故障转场、缩放、抖动等），给出英文搜索关键词。'}
推荐示例：${animeInfo.hasAnime ? '标题"游戏王DM武藤游戏名场面"，animeSource: { series: "游戏王DM", episode: "第1集", timestamp: "约5分钟" } 或 标题"故障转场效果"，isOfficial: false' : '标题"故障转场效果"，描述"画面出现数字故障和撕裂效果"，搜索关键词"glitch transition digital"'}

## 规则
- 如果某个分镜的某类素材不需要，将 needed 设为 false，其他字段留空
- searchKeywords 要精确，BGM和音效用英文，表情包用中文
- 官方动画BGM不需要searchKeywords，用animeSource代替
- reason 要说明为什么这个素材适合这个场景

请严格按以下JSON格式返回，不要有任何其他文字：

{
  "scenes": [
    {
      "sceneNumber": 1,
      "sceneDescription": "分镜描述",
      "dialogue": "台词",
      "bgm": {
        "needed": true,
        "mood": "情绪/风格描述",
        "keywords": "搜索关键词",
        "recommendations": [
          {
            "title": "BGM曲名或描述",
            "description": "BGM风格描述",
            "reason": "推荐理由",
            "source": "官方动画",
            "searchKeywords": "",
            "isOfficial": true,
            "animeSource": { "series": "动画系列名", "episode": "集数", "timestamp": "时间点" }
          },
          {
            "title": "通用BGM名称",
            "description": "BGM描述",
            "reason": "推荐理由",
            "source": "Pixabay Music",
            "searchKeywords": "english search keywords",
            "isOfficial": false
          }
        ]
      },
      "sfx": {
        "needed": true,
        "mood": "音效描述",
        "keywords": "搜索关键词",
        "recommendations": [
          {
            "title": "音效名称",
            "description": "音效描述",
            "reason": "推荐理由",
            "source": "Freesound",
            "searchKeywords": "english search keywords"
          }
        ]
      },
      "meme": {
        "needed": true,
        "mood": "表情/情绪描述",
        "keywords": "搜索关键词",
        "recommendations": [
          {
            "title": "表情包描述",
            "description": "表情包内容描述",
            "reason": "推荐理由",
            "source": "B站/抖音",
            "searchKeywords": "中文搜索关键词"
          }
        ]
      },
      "animation": {
        "needed": true,
        "mood": "动画效果描述",
        "keywords": "搜索关键词",
        "recommendations": [
          {
            "title": "动画片段名称",
            "description": "片段描述",
            "reason": "推荐理由",
            "source": "官方动画",
            "searchKeywords": "",
            "isOfficial": true,
            "animeSource": { "series": "动画系列名", "episode": "集数", "timestamp": "时间点" }
          },
          {
            "title": "转场效果名称",
            "description": "效果描述",
            "reason": "推荐理由",
            "source": "Mixkit",
            "searchKeywords": "english search keywords",
            "isOfficial": false
          }
        ]
      }
    }
  ]
}

确保为所有 ${storyboards.length} 个分镜都生成分析。BGM推荐${animeInfo.hasAnime ? '2-3个（优先动画BGM），动画素材推荐2-3个（优先动画片段），其他类型1-2个' : '1-2个'}。保持描述简短精炼。`;

  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content || '';
  const finishReason = response.choices[0]?.finish_reason || '';
  const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Try direct parse first
  let parsed: any = null;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // JSON likely truncated — try to salvage complete scenes
    console.warn('[AI] Material JSON parse failed, attempting salvage. finish_reason:', finishReason, 'content length:', content.length);
    
    // Strategy: find all complete scene objects by tracking brace depth
    const scenesStart = jsonStr.indexOf('"scenes"');
    if (scenesStart === -1) {
      console.error('[AI] No "scenes" key found in response');
      return { scenes: [] };
    }
    
    const arrayStart = jsonStr.indexOf('[', scenesStart);
    if (arrayStart === -1) {
      return { scenes: [] };
    }
    
    // Extract complete scene objects from the array
    const salvagedScenes: any[] = [];
    let depth = 0;
    let sceneStart = -1;
    
    for (let i = arrayStart + 1; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (ch === '{') {
        if (depth === 0) sceneStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && sceneStart !== -1) {
          // Found a complete scene object
          const sceneStr = jsonStr.slice(sceneStart, i + 1);
          try {
            const sceneObj = JSON.parse(sceneStr);
            salvagedScenes.push(sceneObj);
          } catch {
            // Skip malformed scene
          }
          sceneStart = -1;
        }
      }
    }
    
    if (salvagedScenes.length > 0) {
      console.log(`[AI] Salvaged ${salvagedScenes.length} complete scenes from truncated response`);
      parsed = { scenes: salvagedScenes };
    } else {
      console.error('[AI] Could not salvage any scenes from response');
      return { scenes: [] };
    }
  }

  try {
    const scenes = (parsed.scenes || []).map((scene: any) => ({
      sceneNumber: scene.sceneNumber || 0,
      sceneDescription: scene.sceneDescription || '',
      dialogue: scene.dialogue || '',
      bgm: {
        needed: scene.bgm?.needed ?? false,
        mood: scene.bgm?.mood || '',
        keywords: scene.bgm?.keywords || '',
        recommendations: processRecommendations('bgm', scene.bgm?.recommendations, animeInfo.animeName || undefined),
      },
      sfx: {
        needed: scene.sfx?.needed ?? false,
        mood: scene.sfx?.mood || '',
        keywords: scene.sfx?.keywords || '',
        recommendations: processRecommendations('sfx', scene.sfx?.recommendations),
      },
      meme: {
        needed: scene.meme?.needed ?? false,
        mood: scene.meme?.mood || '',
        keywords: scene.meme?.keywords || '',
        recommendations: processRecommendations('meme', scene.meme?.recommendations),
      },
      animation: {
        needed: scene.animation?.needed ?? false,
        mood: scene.animation?.mood || '',
        keywords: scene.animation?.keywords || '',
        recommendations: processRecommendations('animation', scene.animation?.recommendations, animeInfo.animeName || undefined),
      },
    }));

    if (scenes.length === 0) {
      console.error('[AI] Material analysis returned 0 scenes. finish_reason:', finishReason, 'content preview:', content.slice(0, 200));
    } else {
      console.log(`[AI] Material analysis success: ${scenes.length} scenes`);
    }

    return { scenes };
  } catch (err) {
    console.error('[AI] Material analysis mapping error:', err);
    return { scenes: [] };
  }
}
