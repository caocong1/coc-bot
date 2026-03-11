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
import { PlayerRoutes } from './PlayerRoutes';
import { AdminRoutes } from './AdminRoutes';

export interface ApiRouterOptions {
  db: Database;
  tokenStore: TokenStore;
  characterStore: CharacterStore;
  campaignHandler: CampaignHandler | null;
  adminSecret: string;
}

export class ApiRouter {
  private player: PlayerRoutes;
  private admin: AdminRoutes;

  constructor(private readonly opts: ApiRouterOptions) {
    this.player = new PlayerRoutes(opts.db, opts.tokenStore, opts.characterStore);
    this.admin = new AdminRoutes(opts.db, opts.campaignHandler, opts.adminSecret);
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
