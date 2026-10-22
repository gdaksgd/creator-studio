import type { CostCapability } from '../types';

export type ProviderRuntime = 'local' | 'api' | 'hybrid' | 'manual';

export interface ProviderPricing {
  unitLabel: string;
  /** null = 供应商未提供可核对的单价；不要用猜测值补 0 */
  estimatedCostPerUnit: number | null;
  currency: 'CNY';
  note: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  capability: CostCapability;
  runtime: ProviderRuntime;
  paid: boolean;
  requiresConfirmation: boolean;
  requiresWorker?: boolean;
  description: string;
  pricing: ProviderPricing;
  fallback: string[];
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'edge-tts',
    name: 'Edge TTS',
    capability: 'tts',
    runtime: 'local',
    paid: false,
    requiresConfirmation: false,
    requiresWorker: true,
    description: '本地 TTS worker 调用 Edge 在线语音服务；音频只存本机。',
    pricing: {
      unitLabel: '1k 字符',
      estimatedCostPerUnit: 0,
      currency: 'CNY',
      note: '本地 worker 免费；实际可用性取决于 Edge 服务网络。',
    },
    fallback: [],
  },
  {
    id: 'pure-rules-v1',
    name: '本地规则引擎',
    capability: 'platform',
    runtime: 'local',
    paid: false,
    requiresConfirmation: false,
    description: '平台规则、时长建议与证据出处；不调用外部模型。',
    pricing: {
      unitLabel: '次检查',
      estimatedCostPerUnit: 0,
      currency: 'CNY',
      note: '纯本地规则，无供应商账单。',
    },
    fallback: [],
  },
  {
    id: 'bilibili-web',
    name: 'B站公开接口',
    capability: 'data',
    runtime: 'api',
    paid: false,
    requiresConfirmation: false,
    description: 'B站视频数据与榜单样本；受公开接口限流影响。',
    pricing: {
      unitLabel: '次请求',
      estimatedCostPerUnit: 0,
      currency: 'CNY',
      note: '公开接口免费，但有频率限制；失败时会阻塞相应检查。',
    },
    fallback: [],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    capability: 'llm',
    runtime: 'api',
    paid: true,
    requiresConfirmation: true,
    description: '选题/脚本 AI 评估；Key 由账号或站点配置，应用不保存明文到本地备份。',
    pricing: {
      unitLabel: '1M tokens',
      estimatedCostPerUnit: null,
      currency: 'CNY',
      note: '按 DeepSeek 实际账单；应用未拿到 token 用量时不估算假价格。',
    },
    fallback: [],
  },
  {
    id: 'manual-review',
    name: '人工复核',
    capability: 'manual',
    runtime: 'manual',
    paid: false,
    requiresConfirmation: false,
    description: '人工确认版权、复核与发布判断；不是自动化供应商。',
    pricing: {
      unitLabel: '次复核',
      estimatedCostPerUnit: 0,
      currency: 'CNY',
      note: '人工时间成本未折算为金额。',
    },
    fallback: [],
  },
];

export const PROVIDER_CAPABILITY_LABELS: Record<CostCapability, string> = {
  llm: 'LLM',
  tts: '配音',
  image: '图片',
  video: '视频',
  stock: '素材库',
  platform: '平台规则',
  data: '平台数据',
  manual: '人工',
};

export const PROVIDER_RUNTIME_LABELS: Record<ProviderRuntime, string> = {
  local: '本地',
  api: 'API',
  hybrid: '混合',
  manual: '人工',
};

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}
