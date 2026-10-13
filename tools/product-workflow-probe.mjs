// Source/runtime-level regression probes for workflow behavior that the repo
// does not yet exercise through a browser test runner.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const tests = [];
const check = (name, condition, detail = '') => {
  tests.push({ name, ok: !!condition });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const scriptStore = read('creator-app/src/store/scriptStore.ts');
const authService = read('creator-app/src/services/authService.ts');
const backup = read('creator-app/src/services/localBackup.ts');
const dashboard = read('creator-app/src/pages/TopicDashboard.tsx');
const analytics = read('creator-app/src/pages/Analytics.tsx');
const assetStore = read('creator-app/src/store/assetStore.ts');
const sync = read('creator-app/src/services/syncService.ts');
const library = read('creator-app/src/pages/MaterialLibrary.tsx');
const experiments = read('creator-app/src/pages/ContentExperiments.tsx');
const briefs = read('creator-app/src/pages/MarketingBriefs.tsx');
const marketingStore = read('creator-app/src/store/marketingStore.ts');
const marketingExport = read('creator-app/src/services/marketingExport.ts');
const dbSchema = read('creator-app/src/db/index.ts');
const syncRoute = read('server/src/routes/sync.ts');

check('topic schema includes optional planned publish and production due dates', /plannedPublishAt\?: number/.test(read('creator-app/src/types/index.ts')) && /productionDueAt\?: number/.test(read('creator-app/src/types/index.ts')));
check('schedule view includes week and overdue filters', /scheduleWindow === 'week'/.test(dashboard) && /scheduleWindow === 'overdue'/.test(dashboard));
check('calendar supports month navigation and selected-day entries', /calendarMonth/.test(dashboard) && /selectedDayTopics/.test(dashboard));
check('editing a calendar date persists back to the topic store', /handleUpdateTopicSchedule/.test(dashboard) && /updateTopic\(topic\.id/.test(dashboard));
check('history restore makes an automatic rollback snapshot', /label: '恢复前自动快照'/.test(scriptStore) && /restoreRevision/.test(scriptStore));
check('AI regeneration and adding boards create snapshots before destructive edits', /saveRevision\(selectedScript\.id, 'AI 重新生成前自动快照'\)/.test(read('creator-app/src/pages/ScriptEditor.tsx')) && /saveRevision\(selectedScript\.id, '添加分镜前快照'\)/.test(read('creator-app/src/pages/ScriptEditor.tsx')));
check('material library rejects duplicate normalized links', /findDuplicate/.test(assetStore) && /已存在/.test(assetStore));
check('material library supports favorites, folders, usage and script links', /favorite/.test(read('creator-app/src/pages/MaterialLibrary.tsx')) && /folder/.test(read('creator-app/src/pages/MaterialLibrary.tsx')) && /relatedScriptId/.test(read('creator-app/src/pages/MaterialLibrary.tsx')) && /touchAsset/.test(read('creator-app/src/pages/MaterialLibrary.tsx')));
check('material library exposes favorites, folder/script filters and created/used sorting', /favoriteOnly/.test(library) && /folderFilter/.test(library) && /scriptFilter/.test(library) && /sortMode === 'used'/.test(library));
check('materials recommendations can be saved directly into the library', /收藏到素材库/.test(read('creator-app/src/pages/Materials.tsx')) && /saveRecommendation/.test(read('creator-app/src/pages/Materials.tsx')));
check('material assets are included in cloud sync payloads and restore', /assets = withoutDemo\(await db\.assets\.toArray\(\)\)/.test(sync) && /cloud\.assets/.test(sync));
check('backup includes assets and replacement/merge restore paths', /assets: LibraryAsset\[\]/.test(backup) && /db\.assets\.bulkPut/.test(backup) && /db\.assets\.bulkAdd/.test(backup));
check('retrospective analysis filters platform/source/category/tag', /retroPlatform/.test(analytics) && /retroSource/.test(analytics) && /retroCategory/.test(analytics) && /retroTag/.test(analytics));
check('growth chart requires repeated snapshots and labels sample count', /snapshots\.length < 2/.test(analytics) && /sampleSize: values\.length/.test(analytics));
check('snapshot chart respects retrospective filters for platform/source/category/tag', /visibleCalibration/.test(analytics) && /retroPlatform/.test(analytics) && /retroSource/.test(analytics) && /retroCategory/.test(analytics) && /retroTag/.test(analytics));
check('dashboard has near-term reminders and month view quick edit controls', /近期排期/.test(dashboard) && /schedulePresentation === 'month'/.test(dashboard) && /直接改排期/.test(dashboard));
check('local account switch clears profile-owned IndexedDB records before download', /creator-studio-local-data-owner/.test(authService) && /db\.topics\.clear\(\)/.test(authService) && /syncOnLaunch\(\)/.test(authService));
check('content experiments persist hypothesis, one variable, metric, links and sample boundary', /hypothesis/.test(experiments) && /variable/.test(experiments) && /minimumSampleSize/.test(experiments) && /topicIds/.test(experiments) && /不判定成功/.test(experiments));
check('marketing brief has target/audience/selling points/phases/metrics and MD export', /objective/.test(briefs) && /targetAudience/.test(briefs) && /keySellingPoints/.test(briefs) && /CampaignPlanItem/.test(briefs) && /downloadMarketingBrief/.test(briefs));
check('brief export explicitly separates planning/demo/real context and denies unsupported result claims', /dataMode/.test(read('creator-app/src/services/marketingExport.ts')) && /不是预测结果或已达成结果/.test(read('creator-app/src/services/marketingExport.ts')));
check('marketing workbench persists experiments and briefs in the single Dexie row', /marketingWorkbench: 'id, updatedAt'/.test(dbSchema) && /db\.marketingWorkbench\.put/.test(marketingStore) && !/db\.experiments|db\.briefs/.test(marketingStore));
check('remote marketing workbench replacement updates the same persistent row', /replaceRemote: \(experiments: ContentExperiment\[\], briefs: GameMarketingBrief\[\]\)/.test(marketingStore) && /replaceRemote: async \(experiments, briefs\)/.test(marketingStore));
check('experiment topic selector filters demo and real records using the selected evidence mode', /publishedTopics = useMemo\(\(\) => topics\.filter\(\(topic\) => !!topic\.published && \(form\.evidenceMode === 'demo' \? topic\.id\.startsWith\('demo-'\) : !topic\.id\.startsWith\('demo-'\)\)\)/.test(experiments));
check('experiment completion requires real evidence, minimum sample count and both comparison groups', /evidenceMode === 'real' && records\.length >= guardedExperiment\.minimumSampleSize && controlValues\.length > 0 && variantValues\.length > 0/.test(experiments) && /!groups\.has\('control'\) \|\| !groups\.has\('variant'\)/.test(experiments));
check('brief editing form persists optional linked experiment selection', /linkedExperimentId\?: string/.test(briefs) && /linkedExperimentId: brief\.linkedExperimentId/.test(briefs));
check('brief export carries linked experiment name and current eligible sample count without claiming success', /当前符合口径的已发布样本：\$\{linkedSampleCount\} 条/.test(marketingExport) && /不据此自动推导实验成功/.test(marketingExport) && /downloadMarketingBrief\(brief, experiment, samples\)/.test(briefs));
check('sync upload normalizes malformed marketing workbench arrays', /experiments: Array\.isArray\(body\.marketingWorkbench\.experiments\) \? body\.marketingWorkbench\.experiments : \[\]/.test(syncRoute) && /briefs: Array\.isArray\(body\.marketingWorkbench\.briefs\) \? body\.marketingWorkbench\.briefs : \[\]/.test(syncRoute));
// 注：这条断言原本要求 README 里出现字面量「云端账号隔离依赖服务端/Supabase 配置」。
// README 后来改写为「云端多账号隔离、线上 Supabase 和个人真实业务效果应分别在可访问的
// 目标环境中验证」（验证边界）与「线上账号隔离需在已配置 Supabase 的环境单独验证」，
// 语义一致，因此这里放宽为匹配这两种实际写法，而不是要求那句已经不存在的话。
check('README avoids claiming current online, cloud and historic metric validation without evidence', !/打开即用，无需密码|实测 64 \/ 0|770 条真实样本|播放 \*\*1312\*\*|本地就是线上/.test(read('README.md')) && /(云端)?(多)?账号隔离[^\n。]{0,80}(Supabase|已配置)[^\n。]{0,40}验证/.test(read('README.md')));

console.log(`RESULT ${tests.filter((test) => test.ok).length}/${tests.length} workflow probes passed`);
if (tests.some((test) => !test.ok)) process.exitCode = 1;
