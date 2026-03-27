/**
 * AI 运行时组装器（新版）
 *
 * 根据 config_source 决定读取策略：
 * - legacy: 读取旧 bot_settings.ai_settings，创建旧的 DashScope/OpenLimits 客户端
 * - providers: 使用 AIRouterClient（新配置体系）
 *
 * 规则：
 *   - provider=dashscope: chatClient=HybridAiClient|DashScopeClient, assetClient=DashScopeClient
 *   - provider=openlimits: chatClient=OpenLimitsClient, assetClient=DashScopeClient (降级用)
 *   - config_source=providers: 使用 AIRouterClient
 *
 * 同时导出 createCampaignAIConfig() 用于从 AIConfig 构造 CampaignHandler 所需的模型配置。
 */

import type { Database } from 'bun:sqlite';
import { DashScopeClient } from './DashScopeClient';
import { HybridAiClient } from './HybridAiClient';
import { OpenLimitsClient } from './OpenLimitsClient';
import type { AIClient } from './AIClient';
import { getAIConfig, type AISettings, type AIConfig } from '../../storage/BotSettingsStore';
import { getConfigSource } from '../../storage/ProviderStore';
import { AIRouterClient } from './AIRouterClient';

export interface AIRuntime {
  chatClient: AIClient;
  assetClient: AIClient;
  settings: AISettings;
  config: AIConfig;
  /** 新配置体系的 AIRouterClient（仅 config_source=providers 时有值） */
  routerClient: AIRouterClient | null;
}

/**
 * 创建 AI 运行时。
 * - config_source=providers: 使用 AIRouterClient（推荐）
 * - config_source=legacy: 使用旧客户端（向后兼容）
 */
export function createAIRuntime(db: Database): AIRuntime | null {
  const configSource = getConfigSource(db);

  // ── 新配置体系 ────────────────────────────────────────────────────────
  if (configSource === 'providers') {
    const routerClient = new AIRouterClient(db);
    // 对于 legacy 兼容层，使用 routerClient 作为 chatClient（它实现了 AIClient 接口）
    // 但为了兼容 createCampaignAIConfig，仍需要 settings 对象
    const legacy = getAIConfig(db);
    return {
      chatClient: routerClient as unknown as AIClient,
      assetClient: routerClient as unknown as AIClient,
      settings: legacy,
      config: legacy,
      routerClient,
    };
  }

  // ── 旧配置体系（legacy）──────────────────────────────────────────────
  const config = getAIConfig(db);
  const { provider } = config;

  const dashApiKey = process.env.DASHSCOPE_API_KEY ?? '';
  const openlimitsApiKey = process.env.OPENLIMITS_API_KEY ?? '';

  // ── assetClient: 始终为 DashScope（图片 + embedding）─────────────────
  let assetClient: AIClient | null = null;
  if (dashApiKey) {
    assetClient = new DashScopeClient(dashApiKey);
  }

  // ── chatClient ────────────────────────────────────────────────────
  let chatClient: AIClient | null = null;

  if (provider === 'dashscope') {
    if (!dashApiKey) {
      console.warn('[AI] DashScope provider 配置了但 DASHSCOPE_API_KEY 未设置');
      return null;
    }
    const opencodeUrl = process.env.OPENCODE_SERVER_URL ?? '';
    const opencodeUsername = process.env.OPENCODE_SERVER_USERNAME ?? 'cocbot';
    const opencodePassword = process.env.OPENCODE_SERVER_PASSWORD ?? '';

    if (opencodeUrl && opencodePassword) {
      chatClient = new HybridAiClient(dashApiKey, opencodeUrl, opencodeUsername, opencodePassword);
    } else {
      chatClient = new DashScopeClient(dashApiKey);
    }
  } else if (provider === 'openlimits') {
    if (!openlimitsApiKey) {
      console.warn('[AI] OpenLimits provider 配置了但 OPENLIMITS_API_KEY 未设置');
      return null;
    }
    chatClient = new OpenLimitsClient(openlimitsApiKey);
  }

  if (!chatClient) {
    console.warn('[AI] 无法创建 chatClient（API Key 缺失）');
    return null;
  }

  return {
    chatClient,
    assetClient: assetClient ?? chatClient,
    settings: config,
    config,
    routerClient: null,
  };
}

// ─── Campaign AI 模型配置 ────────────────────────────────────────────────────

/** CampaignHandler 各环节使用的模型名 */
export interface CampaignAIConfig {
  chatModel: string;
  guardrailModel: string;
  openingModel: string;
  recapModel: string;
  imagePromptModel: string;
}

/** 从 AIConfig 提取 Campaign 所需的模型配置 */
export function createCampaignAIConfig(aiConfig: AISettings): CampaignAIConfig {
  return {
    chatModel: aiConfig.chatModel,
    guardrailModel: aiConfig.guardrailModel,
    openingModel: aiConfig.openingModel,
    recapModel: aiConfig.recapModel,
    imagePromptModel: aiConfig.imagePromptModel,
  };
}
