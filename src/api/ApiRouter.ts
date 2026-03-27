/**
 * Web API 路由器
 *
 * 所有 /api/* 请求在此处统一处理。
 * 分为：
 *   /api/player/*  — 玩家端（token 认证）
 *   /api/admin/*   — 管理端（admin secret 认证）
 *   /api/health    — 健康检查（无认证）
 */

import type { Database } from 'bun:sqlite';
import type { TokenStore } from '../storage/TokenStore';
import type { CharacterStore } from '../commands/sheet/CharacterStore';
import type { CampaignHandler } from '../runtime/CampaignHandler';
import type { AIClient } from '../ai/client/AIClient';
import type { NapCatActionClient } from '../adapters/napcat/NapCatActionClient';
import { PlayerRoutes } from './PlayerRoutes';
import { AdminRoutes } from './AdminRoutes';
import { AIProviderRoutes } from './AIProviderRoutes';

export interface ApiRouterOptions {
  db: Database;
  tokenStore: TokenStore;
  characterStore: CharacterStore;
  campaignHandler: CampaignHandler | null;
  adminSecret: string;
  aiClient?: AIClient;
  napcat?: NapCatActionClient;
  imagePromptModel?: string;
}

export class ApiRouter {
  private player: PlayerRoutes;
  private admin: AdminRoutes;
  private aiProviders: AIProviderRoutes;

  constructor(private readonly opts: ApiRouterOptions) {
    this.player = new PlayerRoutes(opts.db, opts.tokenStore, opts.characterStore, opts.campaignHandler, opts.napcat);
    this.admin = new AdminRoutes(opts.db, opts.campaignHandler, opts.adminSecret, opts.aiClient, opts.napcat, opts.imagePromptModel);
    this.aiProviders = new AIProviderRoutes(opts.db);
  }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS 预检
    if (req.method === 'OPTIONS') {
      return this.cors(new Response(null, { status: 204 }));
    }

    // 健康检查
    if (path === '/api/health') {
      return this.cors(Response.json({ status: 'ok' }));
    }

    // 玩家路由
    if (path.startsWith('/api/player')) {
      const res = await this.player.handle(req, path.slice('/api/player'.length) || '/');
      return res ? this.cors(res) : null;
    }

    // AI Provider 管理路由（/api/admin/ai/*）
    if (path.startsWith('/api/admin/ai')) {
      // auth check
      const secret = req.headers.get('authorization')?.replace('Bearer ', '');
      if (!secret || secret !== this.opts.adminSecret) {
        return this.cors(Response.json({ error: 'Unauthorized' }, { status: 401 }));
      }
      const res = await this.aiProviders.handle(req, path.slice('/api/admin/ai'.length) || '/');
      return res ? this.cors(res) : null;
    }

    // 管理路由
    if (path.startsWith('/api/admin')) {
      const res = await this.admin.handle(req, path.slice('/api/admin'.length) || '/');
      return res ? this.cors(res) : null;
    }

    return null;
  }

  private cors(res: Response): Response {
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    return res;
  }
}
