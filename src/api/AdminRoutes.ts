/**
 * 管理端 API 路由
 *
 * 所有请求需携带 Authorization: Bearer <ADMIN_SECRET> 头部。
 *
 * GET  /sessions                        — 所有 session 状态
 * POST /sessions/:groupId/start         — 开始跑团
 * POST /sessions/:groupId/pause         — 暂停
 * POST /sessions/:groupId/resume        — 继续
 * POST /sessions/:groupId/stop          — 停止
 * PUT  /sessions/:groupId/segment       — 手动切换当前分段
 * GET  /sessions/:groupId/segments      — 列出该 session 的所有分段（含全文）
 * GET  /sessions/:groupId/clues         — 线索列表
 * POST /sessions/:groupId/clues/:id/discover — 标记线索已发现
 * POST /sessions/:groupId/inject        — 向会话注入信息
 * GET  /sessions/:groupId/messages/stream — SSE 实时消息流
 * GET  /knowledge                       — 已导入文件列表
 * POST /knowledge/upload                — 上传并导入文件（异步）
 * GET  /kp-templates                    — KP 人格模板列表
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import type { Database } from 'bun:sqlite';
import type { CampaignHandler } from '../runtime/CampaignHandler';
import { ImageLibrary } from '../knowledge/images/ImageLibrary';
import type { DashScopeClient } from '../ai/client/DashScopeClient';
import type { NapCatActionClient } from '../adapters/napcat/NapCatActionClient';
import { deliverCampaignOutput, normalizeCampaignTextParts } from '../runtime/CampaignOutputDelivery';
import { addMinutesToTime } from '../runtime/SessionState';
import type {
  ModuleRulePack,
  ReviewStatus,
  ScenarioEntity,
  ScenarioItem,
} from '@shared/types/ScenarioAssets';
import {
  getModuleEntity,
  getModuleItem,
  getModuleRulePack,
  listModuleEntities,
  listModuleItems,
  summarizeModuleDraftStatus,
} from '../storage/ModuleAssetStore';

type KnowledgeCategory = 'rules' | 'scenario' | 'keeper_secret';

interface ImportJob {
  id: string;
  filename: string;
  category: KnowledgeCategory;
  status: 'pending' | 'done' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

interface ModuleMetadataDraft {
  name?: string;
  description?: string;
  era?: string;
  allowedOccupations?: string[];
  minStats?: Record<string, number>;
}

interface ModuleAssetsDraft {
  entities?: Array<Partial<ScenarioEntity>>;
  items?: Array<Partial<ScenarioItem>>;
}

interface ModuleRulePackDraft {
  sanRules?: string;
  combatRules?: string;
  deathRules?: string;
  timeRules?: string;
  revelationRules?: string;
  forbiddenAssumptions?: string;
  freeText?: string;
}

export class AdminRoutes {
  /** SSE 订阅者 map: groupId → Set<Controller> */
  private sseClients: Map<number, Set<ReadableStreamDefaultController<Uint8Array>>> = new Map();
  private importJobs: Map<string, ImportJob> = new Map();
  private readonly imageLibrary = new ImageLibrary();

  constructor(
    private readonly db: Database,
    private readonly campaignHandler: CampaignHandler | null,
    private readonly adminSecret: string,
    private readonly aiClient?: DashScopeClient,
    private readonly napcat?: NapCatActionClient,
  ) {}

  async handle(req: Request, subPath: string): Promise<Response | null> {
    if (!this.authenticate(req)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const method = req.method;
    const segments = subPath.replace(/^\//, '').split('/');
    const resource = segments[0];

    // GET /sessions
    if (resource === 'sessions' && method === 'GET' && !segments[1]) {
      return this.listSessions();
    }

    // /sessions/:groupId/...
    if (resource === 'sessions' && segments[1]) {
      const groupId = parseInt(segments[1]);
      if (isNaN(groupId)) return Response.json({ error: 'Invalid groupId' }, { status: 400 });
      const action = segments[2];

      if (method === 'POST' && action === 'start') return this.startSession(groupId, req);
      if (method === 'POST' && action === 'pause') return this.pauseSession(groupId);
      if (method === 'POST' && action === 'resume') return this.resumeSession(groupId);
      if (method === 'POST' && action === 'stop') return this.stopSession(groupId);
      if (method === 'PUT' && action === 'segment') return this.setSegment(groupId, req);
      if (method === 'GET' && action === 'segments') return this.listSegments(groupId);
      if (method === 'GET' && action === 'clues') return this.listClues(groupId);
      if (method === 'POST' && action === 'clues' && segments[3] && segments[4] === 'discover') {
        return this.discoverClue(groupId, segments[3]);
      }
      if (method === 'POST' && action === 'inject') return this.injectInfo(groupId, req);
      if (method === 'GET' && action === 'messages' && segments[3] === 'stream') {
        return this.messagesStream(groupId);
      }
      if (method === 'GET' && action === 'messages' && !segments[3]) {
        return this.listSessionMessages(groupId);
      }
      if (method === 'GET' && action === 'timeline') return this.getTimeline(groupId);
      if (method === 'POST' && action === 'time') return this.adjustTime(groupId, req);
    }

    // /knowledge
    if (resource === 'knowledge') {
      if (method === 'GET' && !segments[1]) return this.listKnowledge();
      if (method === 'GET' && segments[1] === 'jobs') return this.listKnowledgeJobs();
      if (method === 'POST' && segments[1] === 'upload') return this.uploadKnowledge(req);
      if (method === 'DELETE' && segments[1] === 'entry') return this.deleteKnowledgeEntry(req);
      // 图片管理：/knowledge/:fileId/images[/:imgId[/send]]
      if (segments[1] && segments[2] === 'images') {
        const fileId = segments[1];
        const imgId = segments[3];
        if (method === 'GET' && !imgId) return this.listFileImages(fileId);
        if (method === 'PATCH' && imgId) return this.patchImage(imgId, req);
        if (method === 'POST' && imgId && segments[4] === 'send') return this.sendImage(imgId, req);
      }
    }

    // /images/generate — AI 图片生成
    if (resource === 'images' && segments[1] === 'generate' && method === 'POST') {
      return this.generateImage(req);
    }

    // /images/:imgId/send — 发图到群（任意图片）
    if (resource === 'images' && segments[1] && segments[2] === 'send' && method === 'POST') {
      return this.sendImage(segments[1], req);
    }

    // /kp-templates — CRUD
    if (resource === 'kp-templates') {
      if (method === 'GET' && !segments[1]) return this.listKpTemplates();
      if (method === 'POST' && !segments[1]) return this.createKpTemplate(req);
      if (method === 'PUT' && segments[1]) return this.updateKpTemplate(segments[1], req);
      if (method === 'DELETE' && segments[1]) return this.deleteKpTemplate(segments[1]);
    }

    // /rooms — 管理员可查看/删除/确认/取消审卡任何房间
    if (resource === 'rooms') {
      if (method === 'GET' && !segments[1]) return this.listAllRooms();
      if (method === 'GET' && segments[1] && !segments[2]) return this.getAdminRoomDetail(segments[1]);
      if (method === 'DELETE' && segments[1] && !segments[2]) return this.adminDeleteRoom(segments[1]);
      if (method === 'POST' && segments[1] && segments[2] === 'confirm') return this.adminConfirmRoom(segments[1]);
      if (method === 'POST' && segments[1] && segments[2] === 'cancel-review') return this.adminCancelReview(segments[1]);
      if (method === 'PATCH' && segments[1] && segments[2] === 'kp-settings') return this.updateRoomKpSettings(segments[1], req);
    }

    // /modules — 模组管理
    if (resource === 'modules') {
      if (method === 'GET' && !segments[1]) return this.listModules();
      if (method === 'POST' && !segments[1]) return this.createModule(req);
      if (method === 'GET' && segments[1] && !segments[2]) return this.getModule(segments[1]);
      if (method === 'PUT' && segments[1] && !segments[2]) return this.updateModule(segments[1], req);
      if (method === 'DELETE' && segments[1] && !segments[2]) return this.deleteModule(segments[1]);
      if (segments[1] && segments[2] === 'entities') {
        if (method === 'GET' && !segments[3]) return this.listModuleEntitiesRoute(segments[1], req);
        if (method === 'POST' && !segments[3]) return this.createModuleEntityRoute(segments[1], req);
        if (method === 'GET' && segments[3] && !segments[4]) return this.getModuleEntityRoute(segments[1], segments[3]);
        if (method === 'PUT' && segments[3] && !segments[4]) return this.updateModuleEntityRoute(segments[1], segments[3], req);
        if (method === 'DELETE' && segments[3] && !segments[4]) return this.deleteModuleEntityRoute(segments[1], segments[3]);
        if (method === 'POST' && segments[3] && segments[4] === 'review') return this.updateModuleEntityReviewRoute(segments[1], segments[3], req);
      }
      if (segments[1] && segments[2] === 'items') {
        if (method === 'GET' && !segments[3]) return this.listModuleItemsRoute(segments[1], req);
        if (method === 'POST' && !segments[3]) return this.createModuleItemRoute(segments[1], req);
        if (method === 'GET' && segments[3] && !segments[4]) return this.getModuleItemRoute(segments[1], segments[3]);
        if (method === 'PUT' && segments[3] && !segments[4]) return this.updateModuleItemRoute(segments[1], segments[3], req);
        if (method === 'DELETE' && segments[3] && !segments[4]) return this.deleteModuleItemRoute(segments[1], segments[3]);
        if (method === 'POST' && segments[3] && segments[4] === 'review') return this.updateModuleItemReviewRoute(segments[1], segments[3], req);
      }
      if (segments[1] && segments[2] === 'rule-pack') {
        if (method === 'GET') return this.getModuleRulePackRoute(segments[1], req);
        if (method === 'PUT') return this.updateModuleRulePackRoute(segments[1], req);
        if (method === 'POST' && segments[3] === 'review') return this.updateModuleRulePackReviewRoute(segments[1], req);
      }
      // /modules/:id/files
      if (method === 'POST' && segments[1] && segments[2] === 'files') return this.uploadModuleFile(segments[1], req);
      if (method === 'DELETE' && segments[1] && segments[2] === 'files' && segments[3]) return this.deleteModuleFile(segments[1], segments[3]);
      // /modules/:id/images/generate
      if (method === 'POST' && segments[1] && segments[2] === 'images' && segments[3] === 'generate') return this.generateModuleImage(segments[1], req);
      // /modules/:id/images/:fileId — 读取图片文件
      if (method === 'GET' && segments[1] && segments[2] === 'images' && segments[3]) return this.serveModuleImage(segments[1], segments[3]);
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  private authenticate(req: Request): boolean {
    if (!this.adminSecret) return true; // 未配置时跳过（开发环境）
    const auth = req.headers.get('Authorization');
    return auth === `Bearer ${this.adminSecret}`;
  }

  // ─── Session 管理 ──────────────────────────────────────────────────────────

  private listSessions(): Response {
    const sessions = this.db.query<{
      id: string; group_id: number; status: string; kp_template_id: string;
      scenario_file_path: string | null; current_segment_id: string | null;
      started_at: string; updated_at: string;
    }, []>('SELECT id, group_id, status, kp_template_id, scenario_file_path, current_segment_id, started_at, updated_at FROM kp_sessions ORDER BY updated_at DESC').all();

    return Response.json(sessions.map((s) => {
      const scene = this.db.query<{ name: string; active_npcs_json: string }, string>(
        'SELECT name, active_npcs_json FROM kp_scenes WHERE session_id = ?',
      ).get(s.id);

      const segCount = this.db.query<{ count: number }, string>(
        'SELECT COUNT(*) as count FROM kp_scene_segments WHERE session_id = ?',
      ).get(s.id)?.count ?? 0;

      const msgCount = this.db.query<{ count: number }, string>(
        'SELECT COUNT(*) as count FROM kp_messages WHERE session_id = ?',
      ).get(s.id)?.count ?? 0;

      return {
        id: s.id,
        groupId: s.group_id,
        status: s.status,
        kpTemplate: s.kp_template_id,
        scenarioFile: s.scenario_file_path,
        currentSegmentId: s.current_segment_id,
        currentScene: scene?.name ?? null,
        activeNpcs: scene ? JSON.parse(scene.active_npcs_json) : [],
        segmentCount: segCount,
        messageCount: msgCount,
        startedAt: s.started_at,
        updatedAt: s.updated_at,
      };
    }));
  }

  private async startSession(groupId: number, req: Request): Promise<Response> {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const body = await req.json().catch(() => ({})) as { templateId?: string };
    const output = await this.campaignHandler.startSession(groupId, body.templateId).catch((e) => {
      throw e;
    });
    return Response.json({ parts: normalizeCampaignTextParts(output) });
  }

  private pauseSession(groupId: number): Response {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const msg = this.campaignHandler.pauseSession(groupId);
    return Response.json({ message: msg });
  }

  private async resumeSession(groupId: number): Promise<Response> {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const output = await this.campaignHandler.resumeSession(groupId);
    return Response.json({ parts: normalizeCampaignTextParts(output) });
  }

  private stopSession(groupId: number): Response {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const msg = this.campaignHandler.stopSession(groupId);
    return Response.json({ message: msg });
  }

  private listSegments(groupId: number): Response {
    const session = this.db.query<{ id: string; current_segment_id: string | null }, number>(
      "SELECT id, current_segment_id FROM kp_sessions WHERE group_id = ? AND status IN ('running', 'paused') ORDER BY updated_at DESC LIMIT 1",
    ).get(groupId);
    if (!session) return Response.json({ error: '无进行中的跑团' }, { status: 404 });

    const segments = this.db.query<{
      id: string; seq: number; title: string; summary: string; full_text: string;
      char_count: number; created_at: string;
    }, string>(
      'SELECT id, seq, title, summary, full_text, char_count, created_at FROM kp_scene_segments WHERE session_id = ? ORDER BY seq',
    ).all(session.id);

    return Response.json({
      currentSegmentId: session.current_segment_id ?? null,
      segments: segments.map((s) => ({
        id: s.id,
        seq: s.seq,
        title: s.title,
        summary: s.summary,
        fullText: s.full_text,
        charCount: s.char_count,
        createdAt: s.created_at,
      })),
    });
  }

  private async setSegment(groupId: number, req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { segmentId?: string };
    if (!body.segmentId) return Response.json({ error: 'segmentId required' }, { status: 400 });

    this.db.run(
      "UPDATE kp_sessions SET current_segment_id = ?, updated_at = ? WHERE group_id = ? AND status = 'running'",
      [body.segmentId, new Date().toISOString(), groupId],
    );
    return Response.json({ ok: true });
  }

  private listClues(groupId: number): Response {
    const session = this.getActiveSession(groupId);
    if (!session) return Response.json({ error: '无进行中的跑团' }, { status: 404 });

    const clues = this.db.query<{
      id: string; title: string; keeper_content: string;
      player_description: string; is_discovered: number; discovered_at: string | null;
    }, string>(
      'SELECT id, title, keeper_content, player_description, is_discovered, discovered_at FROM kp_clues WHERE session_id = ? ORDER BY created_at',
    ).all(session.id);

    return Response.json(clues.map((c) => ({
      id: c.id,
      title: c.title,
      keeperContent: c.keeper_content,
      playerDescription: c.player_description,
      isDiscovered: !!c.is_discovered,
      discoveredAt: c.discovered_at,
    })));
  }

  private discoverClue(groupId: number, clueId: string): Response {
    const now = new Date().toISOString();
    const result = this.db.run(
      'UPDATE kp_clues SET is_discovered = 1, discovered_at = ? WHERE id = ?',
      [now, clueId],
    );
    if (result.changes === 0) return Response.json({ error: '线索不存在' }, { status: 404 });
    return Response.json({ ok: true });
  }

  private async injectInfo(groupId: number, req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { content?: string };
    if (!body.content?.trim()) return Response.json({ error: 'content required' }, { status: 400 });

    const session = this.getActiveSession(groupId);
    if (!session) return Response.json({ error: '无进行中的跑团' }, { status: 404 });

    // 将注入信息作为 system 消息写入历史
    this.db.run(
      'INSERT INTO kp_messages (id, session_id, role, content, timestamp, is_summarized) VALUES (?, ?, ?, ?, ?, 0)',
      [crypto.randomUUID(), session.id, 'system', `[KP注入] ${body.content}`, new Date().toISOString()],
    );

    return Response.json({ ok: true });
  }

  private messagesStream(groupId: number): Response {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        controller = ctrl;
        if (!this.sseClients.has(groupId)) this.sseClients.set(groupId, new Set());
        this.sseClients.get(groupId)!.add(controller);

        // 发送最近 50 条历史
        const session = this.getActiveSession(groupId);
        if (session) {
          const msgs = this.db.query<{ role: string; display_name: string | null; content: string; timestamp: string }, string>(
            'SELECT role, display_name, content, timestamp FROM kp_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 50',
          ).all(session.id).reverse();

          for (const m of msgs) {
            const data = `data: ${JSON.stringify(m)}\n\n`;
            ctrl.enqueue(encoder.encode(data));
          }
        }

        // keepalive ping
        const ping = setInterval(() => {
          try { ctrl.enqueue(encoder.encode(': ping\n\n')); } catch { clearInterval(ping); }
        }, 25000);
      },
      cancel: () => {
        this.sseClients.get(groupId)?.delete(controller);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  /** 向指定群的所有 SSE 客户端推送消息 */
  broadcastMessage(groupId: number, message: Record<string, unknown>): void {
    const clients = this.sseClients.get(groupId);
    if (!clients || clients.size === 0) return;
    const encoder = new TextEncoder();
    const data = encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
    for (const ctrl of clients) {
      try { ctrl.enqueue(data); } catch { clients.delete(ctrl); }
    }
  }

  // ─── Knowledge ─────────────────────────────────────────────────────────────

  private listKnowledge(): Response {
    try {
      const fs = require('fs');
      const manifestPath = './data/knowledge/manifest.json';
      if (!fs.existsSync(manifestPath)) return Response.json([]);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        files: Array<{
          sourceRelativePath: string;
          textChars: number;
          chunkCount: number;
          category?: KnowledgeCategory;
          importedAt?: string;
          metadata?: { title?: string };
        }>;
      };

      return Response.json((manifest.files ?? []).map((m) => ({
        name: m.sourceRelativePath,
        charCount: m.textChars ?? 0,
        chunkCount: m.chunkCount ?? 0,
        category: m.category ?? 'rules',
        importedAt: m.importedAt ?? null,
        title: m.metadata?.title ?? null,
      })));
    } catch {
      return Response.json([]);
    }
  }

  private listKnowledgeJobs(): Response {
    const jobs = Array.from(this.importJobs.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
    return Response.json(jobs);
  }

  private async uploadKnowledge(req: Request): Promise<Response> {
    try {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return Response.json({ error: 'file required' }, { status: 400 });

      const rawCat = (formData.get('category') as string | null) ?? 'rules';
      const validCategories: KnowledgeCategory[] = ['rules', 'scenario', 'keeper_secret'];
      const category: KnowledgeCategory = validCategories.includes(rawCat as KnowledgeCategory)
        ? (rawCat as KnowledgeCategory) : 'rules';

      const fs = require('fs');
      const path = require('path');
      const uploadDir = './data/knowledge/uploads';
      fs.mkdirSync(uploadDir, { recursive: true });

      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
      const dest = path.join(uploadDir, safeName);
      const bytes = new Uint8Array(await file.arrayBuffer());
      fs.writeFileSync(dest, bytes);

      const jobId = crypto.randomUUID();
      const job: ImportJob = {
        id: jobId,
        filename: safeName,
        category,
        status: 'pending',
        startedAt: new Date().toISOString(),
      };
      this.importJobs.set(jobId, job);

      // 后台异步触发单文件导入（合并模式，不覆盖现有条目）
      const proc = Bun.spawn(
        ['bun', 'run', 'scripts/import-pdfs.ts', `--file=${dest}`, `--category=${category}`],
        { stdout: 'inherit', stderr: 'inherit' },
      );
      proc.exited.then((code) => {
        job.status = code === 0 ? 'done' : 'failed';
        if (code !== 0) job.error = `exit code ${code}`;
        job.finishedAt = new Date().toISOString();
      }).catch((e) => {
        job.status = 'failed';
        job.error = String(e);
        job.finishedAt = new Date().toISOString();
      });

      return Response.json({ ok: true, filename: safeName, jobId });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  private async deleteKnowledgeEntry(req: Request): Promise<Response> {
    try {
      const body = await req.json().catch(() => ({})) as { name?: string };
      if (!body.name) return Response.json({ error: 'name required' }, { status: 400 });

      const fs = require('fs');
      const manifestPath = './data/knowledge/manifest.json';
      if (!fs.existsSync(manifestPath)) return Response.json({ error: 'manifest not found' }, { status: 404 });

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        files: Array<{
          sourceRelativePath: string;
          textPath?: string;
          chunkPath?: string;
        }>;
      };

      const entry = manifest.files.find((f) => f.sourceRelativePath === body.name);
      if (!entry) return Response.json({ error: '条目不存在' }, { status: 404 });

      // 删除关联文件
      for (const fpath of [entry.textPath, entry.chunkPath]) {
        if (fpath && fs.existsSync(fpath)) {
          try { fs.unlinkSync(fpath); } catch { /* 忽略 */ }
        }
      }

      // 从 manifest 移除
      manifest.files = manifest.files.filter((f) => f.sourceRelativePath !== body.name);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  // ─── Session Messages (非流式) ──────────────────────────────────────────────

  private listSessionMessages(groupId: number): Response {
    // 先找 running/paused session，没有则找最近的任何 session
    let session = this.db.query<{ id: string }, number>(
      "SELECT id FROM kp_sessions WHERE group_id = ? AND status IN ('running', 'paused') ORDER BY updated_at DESC LIMIT 1",
    ).get(groupId);
    if (!session) {
      session = this.db.query<{ id: string }, number>(
        'SELECT id FROM kp_sessions WHERE group_id = ? ORDER BY updated_at DESC LIMIT 1',
      ).get(groupId);
    }
    if (!session) return Response.json([]);

    const messages = this.db.query<{
      id: string; role: string; display_name: string | null; content: string; timestamp: string;
    }, string>(
      'SELECT id, role, display_name, content, timestamp FROM kp_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 200',
    ).all(session.id).reverse();

    return Response.json(messages.map((m) => ({
      id: m.id,
      role: m.role,
      displayName: m.display_name,
      content: m.content,
      timestamp: m.timestamp,
    })));
  }

  // ─── Timeline ─────────────────────────────────────────────────────────────

  private getTimeline(groupId: number): Response {
    const session = this.findActiveOrRecentSession(groupId);
    if (!session) return Response.json({ ingameTime: null, events: [] });

    const row = this.db.query<{ ingame_time: string | null }, string>(
      'SELECT ingame_time FROM kp_sessions WHERE id = ?',
    ).get(session.id);

    const events = this.db.query<{
      id: string; ingame_time: string; delta_minutes: number | null;
      description: string; trigger: string; message_id: string | null; created_at: string;
    }, string>(
      'SELECT id, ingame_time, delta_minutes, description, trigger, message_id, created_at FROM kp_timeline_events WHERE session_id = ? ORDER BY created_at DESC LIMIT 50',
    ).all(session.id);

    return Response.json({
      sessionId: session.id,
      ingameTime: row?.ingame_time ?? null,
      events: events.map((e) => ({
        id: e.id,
        ingameTime: e.ingame_time,
        deltaMinutes: e.delta_minutes,
        description: e.description,
        trigger: e.trigger,
        messageId: e.message_id,
        createdAt: e.created_at,
      })),
    });
  }

  private async adjustTime(groupId: number, req: Request): Promise<Response> {
    const session = this.findActiveOrRecentSession(groupId);
    if (!session) return Response.json({ error: '没有活跃的跑团 session' }, { status: 404 });

    let body: { type: 'set' | 'advance'; value?: string; minutes?: number };
    try {
      body = await req.json() as typeof body;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const id = `tl-${crypto.randomUUID().slice(0, 8)}`;

    if (body.type === 'set' && body.value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.value)) {
        return Response.json({ error: '时间格式应为 YYYY-MM-DDTHH:MM' }, { status: 400 });
      }
      this.db.run('UPDATE kp_sessions SET ingame_time = ?, updated_at = ? WHERE id = ?', [body.value, now, session.id]);
      this.db.run(
        'INSERT INTO kp_timeline_events (id, session_id, ingame_time, delta_minutes, description, trigger, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        [id, session.id, body.value, `管理员设定时间为 ${body.value}`, 'admin', now],
      );
      return Response.json({ ok: true, ingameTime: body.value });
    }

    if (body.type === 'advance' && body.minutes && body.minutes > 0) {
      const current = this.db.query<{ ingame_time: string | null }, string>(
        'SELECT ingame_time FROM kp_sessions WHERE id = ?',
      ).get(session.id);
      if (!current?.ingame_time) {
        return Response.json({ error: '尚未设定游戏时间，请先使用 set 设定' }, { status: 400 });
      }
      // 简单的时间推进
      const newTime = addMinutesToTime(current.ingame_time, body.minutes);
      this.db.run('UPDATE kp_sessions SET ingame_time = ?, updated_at = ? WHERE id = ?', [newTime, now, session.id]);
      this.db.run(
        'INSERT INTO kp_timeline_events (id, session_id, ingame_time, delta_minutes, description, trigger, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, session.id, newTime, body.minutes, `管理员推进 ${body.minutes} 分钟`, 'admin', now],
      );
      return Response.json({ ok: true, ingameTime: newTime });
    }

    return Response.json({ error: '请提供 type: "set" + value 或 type: "advance" + minutes' }, { status: 400 });
  }

  private findActiveOrRecentSession(groupId: number): { id: string } | null {
    return this.db.query<{ id: string }, number>(
      "SELECT id FROM kp_sessions WHERE group_id = ? AND status IN ('running', 'paused') ORDER BY updated_at DESC LIMIT 1",
    ).get(groupId) ?? null;
  }

  // ─── KP Templates ──────────────────────────────────────────────────────────

  private listKpTemplates(): Response {
    const { KPTemplateRegistry } = require('../ai/config/KPTemplateRegistry');
    const registry = new KPTemplateRegistry(this.db);
    return Response.json(registry.getAll().map((t: {
      id: string; name: string; description: string; builtin: boolean;
      tone: number; flexibility: number; guidance: number;
      lethality: number; pacing: number; customPrompts?: string;
    }) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      builtin: t.builtin,
      tone: t.tone,
      flexibility: t.flexibility,
      guidance: t.guidance,
      lethality: t.lethality,
      pacing: t.pacing,
      customPrompts: t.customPrompts ?? '',
    })));
  }

  private async createKpTemplate(req: Request): Promise<Response> {
    const body = (await req.json()) as {
      name: string; description?: string;
      tone?: number; flexibility?: number; guidance?: number;
      lethality?: number; pacing?: number; customPrompts?: string;
    };
    if (!body.name?.trim()) return Response.json({ error: '模板名称不能为空' }, { status: 400 });

    const id = `custom-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO kp_templates (id, name, description, tone, flexibility, guidance, lethality, pacing, custom_prompts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, body.name.trim(), body.description?.trim() ?? '', body.tone ?? 5, body.flexibility ?? 5,
       body.guidance ?? 5, body.lethality ?? 5, body.pacing ?? 5, body.customPrompts?.trim() ?? '', now, now],
    );
    return Response.json({ ok: true, id });
  }

  private async updateKpTemplate(id: string, req: Request): Promise<Response> {
    // 不允许修改内置模板
    const { KPTemplateRegistry } = require('../ai/config/KPTemplateRegistry');
    const registry = new KPTemplateRegistry();
    const builtin = registry.getBuiltin().find((t: { id: string }) => t.id === id);
    if (builtin) return Response.json({ error: '不能修改内置模板' }, { status: 400 });

    const body = (await req.json()) as {
      name?: string; description?: string;
      tone?: number; flexibility?: number; guidance?: number;
      lethality?: number; pacing?: number; customPrompts?: string;
    };

    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name.trim()); }
    if (body.description !== undefined) { updates.push('description = ?'); params.push(body.description.trim()); }
    if (body.tone !== undefined) { updates.push('tone = ?'); params.push(body.tone); }
    if (body.flexibility !== undefined) { updates.push('flexibility = ?'); params.push(body.flexibility); }
    if (body.guidance !== undefined) { updates.push('guidance = ?'); params.push(body.guidance); }
    if (body.lethality !== undefined) { updates.push('lethality = ?'); params.push(body.lethality); }
    if (body.pacing !== undefined) { updates.push('pacing = ?'); params.push(body.pacing); }
    if (body.customPrompts !== undefined) { updates.push('custom_prompts = ?'); params.push(body.customPrompts.trim()); }

    if (updates.length === 0) return Response.json({ ok: true });

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE kp_templates SET ${updates.join(', ')} WHERE id = ?`, params);
    return Response.json({ ok: true });
  }

  private deleteKpTemplate(id: string): Response {
    const { KPTemplateRegistry } = require('../ai/config/KPTemplateRegistry');
    const registry = new KPTemplateRegistry();
    const builtin = registry.getBuiltin().find((t: { id: string }) => t.id === id);
    if (builtin) return Response.json({ error: '不能删除内置模板' }, { status: 400 });

    this.db.run('DELETE FROM kp_templates WHERE id = ?', [id]);
    return Response.json({ ok: true });
  }

  // ─── 图片管理 ───────────────────────────────────────────────────────────────

  private listFileImages(fileId: string): Response {
    const entries = this.imageLibrary.getBySourceFile(fileId);
    return Response.json(entries.map((e) => ({
      id: e.id,
      source: e.source,
      relativePath: e.relativePath,
      mimeType: e.mimeType,
      caption: e.caption,
      playerVisible: e.playerVisible,
      createdAt: e.createdAt,
    })));
  }

  private async patchImage(imgId: string, req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as {
      caption?: string;
      playerVisible?: boolean;
    };
    const ok = this.imageLibrary.patch(imgId, {
      caption: body.caption,
      playerVisible: body.playerVisible,
    });
    if (!ok) return Response.json({ error: '图片不存在' }, { status: 404 });
    return Response.json({ ok: true });
  }

  private async sendImage(imgId: string, req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { groupId?: number };
    if (!body.groupId) return Response.json({ error: 'groupId required' }, { status: 400 });
    if (!this.napcat) return Response.json({ error: 'NapCat 未配置' }, { status: 503 });

    const entry = this.imageLibrary.getById(imgId);
    if (!entry) return Response.json({ error: '图片不存在' }, { status: 404 });

    const absPath = ImageLibrary.absPath(entry.relativePath);
    const caption = `📷 ${entry.caption || '图片'}（ID: ${entry.id}，可用 .regen ${entry.id} 重新生成）`;

    try {
      await this.napcat.sendGroupImage(body.groupId, absPath, caption);
      return Response.json({ ok: true });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  /**
   * AI 图片生成（qwen-image-2.0-pro）。
   *
   * 流程：
   *  1. 接收用户中文描述
   *  2. qwen3.5-plus 优化提示词（英文，细节丰富）
   *  3. qwen-image-2.0-pro 异步生成（轮询直到 SUCCEEDED）
   *  4. 下载图片保存到 data/knowledge/images/generated/
   *  5. 存入 ImageLibrary，返回图片 ID
   */
  private async generateImage(req: Request): Promise<Response> {
    if (!this.aiClient) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });

    const body = await req.json().catch(() => ({})) as {
      description?: string;
      size?: string;
      playerVisible?: boolean;
    };
    const desc = body.description?.trim();
    if (!desc) return Response.json({ error: 'description required' }, { status: 400 });

    try {
      // 1. 优化提示词
      const optimizedPrompt = await this.aiClient.optimizeImagePrompt(desc);
      console.log(`[AdminRoutes] 图片生成 prompt 优化: "${desc}" → "${optimizedPrompt.slice(0, 80)}..."`);

      // 2. 生成图片（返回 URL）
      const imageUrl = await this.aiClient.generateImage(optimizedPrompt, body.size);

      // 3. 下载并保存图片
      const genDir = resolve('data/knowledge/images/generated');
      mkdirSync(genDir, { recursive: true });

      const imgId = ImageLibrary.generateId();
      const imgPath = `${genDir}/${imgId}.jpg`;
      const imgRelPath = `data/knowledge/images/generated/${imgId}.jpg`;

      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`下载生成图片失败: ${imgResp.status}`);
      const imgBuffer = await imgResp.arrayBuffer();
      writeFileSync(imgPath, Buffer.from(imgBuffer));

      // 4. 存入图片库
      this.imageLibrary.upsert({
        id: imgId,
        source: 'generated',
        relativePath: imgRelPath,
        mimeType: 'image/jpeg',
        caption: desc,
        playerVisible: body.playerVisible ?? true,
        generatedPrompt: desc,
        optimizedPrompt,
        createdAt: new Date().toISOString(),
      });

      console.log(`[AdminRoutes] 图片生成完成: id=${imgId}`);

      return Response.json({
        ok: true,
        id: imgId,
        relativePath: imgRelPath,
        optimizedPrompt,
      });
    } catch (e) {
      console.error('[AdminRoutes] 图片生成失败:', e);
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  // ─── 工具 ──────────────────────────────────────────────────────────────────

  private getActiveSession(groupId: number): { id: string } | null {
    return this.db.query<{ id: string }, number>(
      "SELECT id FROM kp_sessions WHERE group_id = ? AND status IN ('running', 'paused') ORDER BY updated_at DESC LIMIT 1",
    ).get(groupId);
  }

  // ─── 房间管理（管理员） ────────────────────────────────────────────────────

  private listAllRooms(): Response {
    const rooms = this.db.query<{
      id: string; name: string; group_id: number; creator_qq_id: number;
      scenario_name: string | null; status: string; kp_session_id: string | null;
      created_at: string; updated_at: string;
    }, []>(
      'SELECT id, name, group_id, creator_qq_id, scenario_name, status, kp_session_id, created_at, updated_at FROM campaign_rooms ORDER BY created_at DESC',
    ).all();

    return Response.json(rooms.map((r) => ({
      id: r.id,
      name: r.name,
      groupId: r.group_id,
      creatorQqId: r.creator_qq_id,
      scenarioName: r.scenario_name,
      status: r.status,
      kpSessionId: r.kp_session_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      memberCount: this.db.query<{ cnt: number }, string>(
        'SELECT COUNT(*) as cnt FROM campaign_room_members WHERE room_id = ?',
      ).get(r.id)?.cnt ?? 0,
    })));
  }

  private getAdminRoomDetail(roomId: string): Response {
    const room = this.db.query<{
      id: string; name: string; group_id: number | null; creator_qq_id: number;
      scenario_name: string | null; module_id: string | null; constraints_json: string;
      status: string; kp_session_id: string | null; created_at: string; updated_at: string;
      kp_template_id: string; kp_custom_prompts: string;
    }, string>(
      'SELECT id, name, group_id, creator_qq_id, scenario_name, module_id, constraints_json, status, kp_session_id, created_at, updated_at, kp_template_id, kp_custom_prompts FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });

    const constraints = JSON.parse(room.constraints_json) as {
      era?: string; allowedOccupations?: string[]; minStats?: Record<string, number>;
    };

    // 成员 + 角色卡信息
    const memberRows = this.db.query<{ qq_id: number; character_id: string | null; ready_at: string | null; joined_at: string }, string>(
      'SELECT qq_id, character_id, ready_at, joined_at FROM campaign_room_members WHERE room_id = ? ORDER BY joined_at',
    ).all(roomId);

    const members: Array<{
      qqId: number; joinedAt: string; isCreator: boolean; readyAt: string | null;
      character: { id: string; name: string; occupation: string | null; attributes: Record<string, number>; derived: Record<string, number> } | null;
    }> = [];
    const warnings: string[] = [];

    for (const m of memberRows) {
      let charRow: { id: string; name: string; occupation: string | null; payload_json: string } | null = null;
      if (m.character_id) {
        charRow = this.db.query<{ id: string; name: string; occupation: string | null; payload_json: string }, string>(
          'SELECT id, name, occupation, payload_json FROM characters WHERE id = ?',
        ).get(m.character_id) ?? null;
      }
      if (!charRow) {
        charRow = this.db.query<{ id: string; name: string; occupation: string | null; payload_json: string }, string>(
          `SELECT c.id, c.name, c.occupation, c.payload_json FROM characters c
           JOIN active_cards a ON a.character_id = c.id WHERE a.binding_key = ?`,
        ).get(`player:${m.qq_id}`) ?? null;
      }

      let character: typeof members[0]['character'] = null;
      if (charRow) {
        const payload = JSON.parse(charRow.payload_json) as { attributes?: Record<string, number>; derived?: Record<string, number> };
        character = {
          id: charRow.id, name: charRow.name, occupation: charRow.occupation,
          attributes: payload.attributes ?? {}, derived: payload.derived ?? {},
        };
        // 约束检查
        if (constraints.allowedOccupations?.length && charRow.occupation &&
            !constraints.allowedOccupations.includes(charRow.occupation)) {
          warnings.push(`QQ ${m.qq_id} 的职业「${charRow.occupation}」不在模组允许范围内`);
        }
        if (constraints.minStats) {
          for (const [stat, minVal] of Object.entries(constraints.minStats)) {
            const actual = (payload.attributes ?? {})[stat] ?? 0;
            if (actual < minVal) warnings.push(`QQ ${m.qq_id} 的 ${stat}(${actual}) 低于最低要求(${minVal})`);
          }
        }
      } else {
        warnings.push(`QQ ${m.qq_id} 尚未选择角色卡`);
      }

      members.push({ qqId: m.qq_id, joinedAt: m.joined_at, isCreator: m.qq_id === room.creator_qq_id, readyAt: m.ready_at, character });
    }

    // Session 信息（如果有）
    let session: { id: string; groupId: number; status: string; startedAt: string } | null = null;
    if (room.kp_session_id) {
      const sess = this.db.query<{ id: string; group_id: number; status: string; started_at: string }, string>(
        'SELECT id, group_id, status, started_at FROM kp_sessions WHERE id = ?',
      ).get(room.kp_session_id);
      if (sess) session = { id: sess.id, groupId: sess.group_id, status: sess.status, startedAt: sess.started_at };
    }

    return Response.json({
      id: room.id, name: room.name, groupId: room.group_id, creatorQqId: room.creator_qq_id,
      scenarioName: room.scenario_name, moduleId: room.module_id, constraints,
      status: room.status, kpSessionId: room.kp_session_id,
      kpTemplateId: room.kp_template_id ?? 'classic',
      kpCustomPrompts: room.kp_custom_prompts ?? '',
      createdAt: room.created_at, updatedAt: room.updated_at,
      memberCount: memberRows.length, members, warnings, session,
    });
  }

  private adminConfirmRoom(roomId: string): Response {
    if (!this.campaignHandler) return Response.json({ error: 'AI KP 服务未配置' }, { status: 503 });

    const room = this.db.query<{ status: string; group_id: number | null }, string>(
      'SELECT status, group_id FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.status !== 'reviewing') return Response.json({ error: '该房间不在审卡阶段' }, { status: 409 });
    if (!room.group_id) return Response.json({ error: '该房间尚未绑定 QQ 群' }, { status: 400 });

    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'running', updated_at = ? WHERE id = ?", [now, roomId]);

    const groupId = room.group_id;
    this.campaignHandler.startSession(groupId, undefined, roomId).then(async (output) => {
      if (this.napcat) {
        await deliverCampaignOutput(this.napcat, groupId, output);
      }
    }).catch((err) => {
      console.error('[AdminRoutes] 开团失败:', err);
      this.db.run("UPDATE campaign_rooms SET status = 'reviewing', updated_at = ? WHERE id = ?", [new Date().toISOString(), roomId]);
    });

    return Response.json({ ok: true, message: '开团指令已发送' });
  }

  private adminCancelReview(roomId: string): Response {
    const room = this.db.query<{ status: string }, string>(
      'SELECT status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.status !== 'reviewing') return Response.json({ error: '该房间不在审卡阶段' }, { status: 409 });

    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'waiting', updated_at = ? WHERE id = ?", [now, roomId]);
    this.db.run('UPDATE campaign_room_members SET ready_at = NULL WHERE room_id = ?', [roomId]);
    return Response.json({ ok: true, message: '已取消审卡' });
  }

  private async updateRoomKpSettings(roomId: string, req: Request): Promise<Response> {
    const room = this.db.query<{ status: string }, string>(
      'SELECT status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });

    const body = (await req.json()) as { templateId?: string; customPrompts?: string };
    const updates: string[] = [];
    const params: string[] = [];

    if (body.templateId !== undefined) {
      updates.push('kp_template_id = ?');
      params.push(body.templateId);
    }
    if (body.customPrompts !== undefined) {
      updates.push('kp_custom_prompts = ?');
      params.push(body.customPrompts);
    }
    if (updates.length === 0) return Response.json({ error: '没有要更新的字段' }, { status: 400 });

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(roomId);

    this.db.run(`UPDATE campaign_rooms SET ${updates.join(', ')} WHERE id = ?`, params);
    return Response.json({ ok: true });
  }

  private adminDeleteRoom(roomId: string): Response {
    const room = this.db.query<{ status: string }, string>(
      'SELECT status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });

    this.db.run('DELETE FROM campaign_room_members WHERE room_id = ?', [roomId]);
    this.db.run('DELETE FROM campaign_rooms WHERE id = ?', [roomId]);
    return Response.json({ ok: true });
  }

  // ─── 模组管理 ───────────────────────────────────────────────────────────────

  private listModules(): Response {
    const modules = this.db.query<{
      id: string; name: string; description: string | null; era: string | null;
      allowed_occupations: string; min_stats: string; created_at: string; updated_at: string;
    }, []>('SELECT * FROM scenario_modules ORDER BY created_at DESC').all();

    return Response.json(modules.map((m) => {
      const files = this.db.query<{ id: string; file_type: string; import_status: string }, string>(
        'SELECT id, file_type, import_status FROM scenario_module_files WHERE module_id = ?',
      ).all(m.id);
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        era: m.era,
        allowedOccupations: JSON.parse(m.allowed_occupations),
        minStats: JSON.parse(m.min_stats),
        fileCount: files.filter((f) => f.file_type === 'document').length,
        imageCount: files.filter((f) => f.file_type === 'image').length,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
      };
    }));
  }

  private async createModule(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({})) as {
      name?: string; description?: string; era?: string;
      allowedOccupations?: string[]; minStats?: Record<string, number>;
    };
    if (!body.name?.trim()) return Response.json({ error: 'name required' }, { status: 400 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      'INSERT INTO scenario_modules (id, name, description, era, allowed_occupations, min_stats, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, body.name.trim(), body.description?.trim() ?? null, body.era ?? null,
        JSON.stringify(body.allowedOccupations ?? []),
        JSON.stringify(body.minStats ?? {}),
        now, now],
    );
    return Response.json({ id }, { status: 201 });
  }

  private getModule(moduleId: string): Response {
    const m = this.db.query<{
      id: string; name: string; description: string | null; era: string | null;
      allowed_occupations: string; min_stats: string; created_at: string; updated_at: string;
    }, string>('SELECT * FROM scenario_modules WHERE id = ?').get(moduleId);
    if (!m) return Response.json({ error: '模组不存在' }, { status: 404 });

    const files = this.db.query<{
      id: string; filename: string; original_name: string; file_type: string;
      label: string | null; description: string | null;
      char_count: number; chunk_count: number; import_status: string; import_error: string | null;
      created_at: string;
    }, string>('SELECT * FROM scenario_module_files WHERE module_id = ? ORDER BY created_at', ).all(moduleId);
    const entities = listModuleEntities(this.db, moduleId);
    const items = listModuleItems(this.db, moduleId);
    const rulePack = getModuleRulePack(this.db, moduleId);
    const extractionDraftStatus = summarizeModuleDraftStatus(this.db, moduleId);

    return Response.json({
      id: m.id,
      name: m.name,
      description: m.description,
      era: m.era,
      allowedOccupations: JSON.parse(m.allowed_occupations),
      minStats: JSON.parse(m.min_stats),
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        originalName: f.original_name,
        fileType: f.file_type,
        label: f.label,
        description: f.description,
        charCount: f.char_count,
        chunkCount: f.chunk_count,
        importStatus: f.import_status,
        importError: f.import_error,
        createdAt: f.created_at,
      })),
      entities,
      items,
      rulePack,
      extractionDraftStatus,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    });
  }

  private async updateModule(moduleId: string, req: Request): Promise<Response> {
    const m = this.db.query<{ id: string }, string>('SELECT id FROM scenario_modules WHERE id = ?').get(moduleId);
    if (!m) return Response.json({ error: '模组不存在' }, { status: 404 });

    const body = await req.json().catch(() => ({})) as {
      name?: string; description?: string; era?: string;
      allowedOccupations?: string[]; minStats?: Record<string, number>;
    };
    const now = new Date().toISOString();
    this.db.run(
      'UPDATE scenario_modules SET name = COALESCE(?, name), description = ?, era = ?, allowed_occupations = ?, min_stats = ?, updated_at = ? WHERE id = ?',
      [body.name?.trim() ?? null, body.description?.trim() ?? null, body.era ?? null,
        JSON.stringify(body.allowedOccupations ?? []),
        JSON.stringify(body.minStats ?? {}),
        now, moduleId],
    );
    return Response.json({ ok: true });
  }

  private deleteModule(moduleId: string): Response {
    const m = this.db.query<{ id: string }, string>('SELECT id FROM scenario_modules WHERE id = ?').get(moduleId);
    if (!m) return Response.json({ error: '模组不存在' }, { status: 404 });

    // 删除物理图片文件
    const fs = require('fs');
    const images = this.db.query<{ filename: string }, string>(
      "SELECT filename FROM scenario_module_files WHERE module_id = ? AND file_type = 'image'",
    ).all(moduleId);
    for (const img of images) {
      try { fs.unlinkSync(img.filename); } catch { /* 忽略 */ }
    }

    this.db.run('DELETE FROM module_entities WHERE module_id = ?', [moduleId]);
    this.db.run('DELETE FROM module_items WHERE module_id = ?', [moduleId]);
    this.db.run('DELETE FROM module_rule_packs WHERE module_id = ?', [moduleId]);
    this.db.run('DELETE FROM scenario_module_files WHERE module_id = ?', [moduleId]);
    this.db.run('DELETE FROM scenario_modules WHERE id = ?', [moduleId]);
    return Response.json({ ok: true });
  }

  private listModuleEntitiesRoute(moduleId: string, req: Request): Response {
    if (!this.moduleExists(moduleId)) return Response.json({ error: '模组不存在' }, { status: 404 });
    const statuses = parseReviewStatusQuery(new URL(req.url).searchParams.get('status'));
    return Response.json(listModuleEntities(this.db, moduleId, statuses));
  }

  private async createModuleEntityRoute(moduleId: string, req: Request): Promise<Response> {
    if (!this.moduleExists(moduleId)) return Response.json({ error: '模组不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Partial<ScenarioEntity>;
    const record = buildScenarioEntityRecord(body);
    if (!record.name) return Response.json({ error: 'name required' }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO module_entities
         (id, module_id, type, name, identity, motivation, public_image, hidden_truth,
          speaking_style, faction, danger_level, default_location, attributes_json,
          skills_json, combat_json, free_text, relationships_json, is_key, review_status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, moduleId, record.type, record.name, record.identity, record.motivation, record.publicImage,
        record.hiddenTruth, record.speakingStyle, record.faction, record.dangerLevel, record.defaultLocation,
        JSON.stringify(record.attributes), JSON.stringify(record.skills), JSON.stringify(record.combat),
        record.freeText, JSON.stringify(record.relationships), record.isKey ? 1 : 0, record.reviewStatus, now, now,
      ],
    );
    return Response.json({ id }, { status: 201 });
  }

  private getModuleEntityRoute(moduleId: string, entityId: string): Response {
    const entity = getModuleEntity(this.db, moduleId, entityId);
    if (!entity) return Response.json({ error: '实体不存在' }, { status: 404 });
    return Response.json(entity);
  }

  private async updateModuleEntityRoute(moduleId: string, entityId: string, req: Request): Promise<Response> {
    const existing = getModuleEntity(this.db, moduleId, entityId);
    if (!existing) return Response.json({ error: '实体不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Partial<ScenarioEntity>;
    const merged = buildScenarioEntityRecord({ ...existing, ...body, reviewStatus: body.reviewStatus ?? existing.reviewStatus });
    this.db.run(
      `UPDATE module_entities SET
         type = ?, name = ?, identity = ?, motivation = ?, public_image = ?, hidden_truth = ?,
         speaking_style = ?, faction = ?, danger_level = ?, default_location = ?, attributes_json = ?,
         skills_json = ?, combat_json = ?, free_text = ?, relationships_json = ?, is_key = ?,
         review_status = ?, updated_at = ?
       WHERE id = ? AND module_id = ?`,
      [
        merged.type, merged.name, merged.identity, merged.motivation, merged.publicImage, merged.hiddenTruth,
        merged.speakingStyle, merged.faction, merged.dangerLevel, merged.defaultLocation,
        JSON.stringify(merged.attributes), JSON.stringify(merged.skills), JSON.stringify(merged.combat),
        merged.freeText, JSON.stringify(merged.relationships), merged.isKey ? 1 : 0,
        merged.reviewStatus, new Date().toISOString(), entityId, moduleId,
      ],
    );
    return Response.json({ ok: true });
  }

  private deleteModuleEntityRoute(moduleId: string, entityId: string): Response {
    const result = this.db.run('DELETE FROM module_entities WHERE id = ? AND module_id = ?', [entityId, moduleId]);
    if (result.changes === 0) return Response.json({ error: '实体不存在' }, { status: 404 });
    return Response.json({ ok: true });
  }

  private async updateModuleEntityReviewRoute(moduleId: string, entityId: string, req: Request): Promise<Response> {
    const entity = getModuleEntity(this.db, moduleId, entityId);
    if (!entity) return Response.json({ error: '实体不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reviewStatus?: ReviewStatus };
    const reviewStatus = normalizeReviewStatus(body.reviewStatus);
    if (!reviewStatus) return Response.json({ error: 'reviewStatus invalid' }, { status: 400 });
    this.db.run(
      'UPDATE module_entities SET review_status = ?, updated_at = ? WHERE id = ? AND module_id = ?',
      [reviewStatus, new Date().toISOString(), entityId, moduleId],
    );
    return Response.json({ ok: true });
  }

  private listModuleItemsRoute(moduleId: string, req: Request): Response {
    if (!this.moduleExists(moduleId)) return Response.json({ error: '模组不存在' }, { status: 404 });
    const statuses = parseReviewStatusQuery(new URL(req.url).searchParams.get('status'));
    return Response.json(listModuleItems(this.db, moduleId, statuses));
  }

  private async createModuleItemRoute(moduleId: string, req: Request): Promise<Response> {
    if (!this.moduleExists(moduleId)) return Response.json({ error: '模组不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Partial<ScenarioItem>;
    const record = buildScenarioItemRecord(body);
    if (!record.name) return Response.json({ error: 'name required' }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO module_items
         (id, module_id, name, category, public_description, kp_notes, default_owner,
          default_location, visibility_condition, usage, is_key, review_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, moduleId, record.name, record.category, record.publicDescription, record.kpNotes,
        record.defaultOwner, record.defaultLocation, record.visibilityCondition, record.usage,
        record.isKey ? 1 : 0, record.reviewStatus, now, now,
      ],
    );
    return Response.json({ id }, { status: 201 });
  }

  private getModuleItemRoute(moduleId: string, itemId: string): Response {
    const item = getModuleItem(this.db, moduleId, itemId);
    if (!item) return Response.json({ error: '物品不存在' }, { status: 404 });
    return Response.json(item);
  }

  private async updateModuleItemRoute(moduleId: string, itemId: string, req: Request): Promise<Response> {
    const existing = getModuleItem(this.db, moduleId, itemId);
    if (!existing) return Response.json({ error: '物品不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Partial<ScenarioItem>;
    const merged = buildScenarioItemRecord({ ...existing, ...body, reviewStatus: body.reviewStatus ?? existing.reviewStatus });
    this.db.run(
      `UPDATE module_items SET
         name = ?, category = ?, public_description = ?, kp_notes = ?, default_owner = ?,
         default_location = ?, visibility_condition = ?, usage = ?, is_key = ?, review_status = ?, updated_at = ?
       WHERE id = ? AND module_id = ?`,
      [
        merged.name, merged.category, merged.publicDescription, merged.kpNotes, merged.defaultOwner,
        merged.defaultLocation, merged.visibilityCondition, merged.usage, merged.isKey ? 1 : 0,
        merged.reviewStatus, new Date().toISOString(), itemId, moduleId,
      ],
    );
    return Response.json({ ok: true });
  }

  private deleteModuleItemRoute(moduleId: string, itemId: string): Response {
    const result = this.db.run('DELETE FROM module_items WHERE id = ? AND module_id = ?', [itemId, moduleId]);
    if (result.changes === 0) return Response.json({ error: '物品不存在' }, { status: 404 });
    return Response.json({ ok: true });
  }

  private async updateModuleItemReviewRoute(moduleId: string, itemId: string, req: Request): Promise<Response> {
    const item = getModuleItem(this.db, moduleId, itemId);
    if (!item) return Response.json({ error: '物品不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reviewStatus?: ReviewStatus };
    const reviewStatus = normalizeReviewStatus(body.reviewStatus);
    if (!reviewStatus) return Response.json({ error: 'reviewStatus invalid' }, { status: 400 });
    this.db.run(
      'UPDATE module_items SET review_status = ?, updated_at = ? WHERE id = ? AND module_id = ?',
      [reviewStatus, new Date().toISOString(), itemId, moduleId],
    );
    return Response.json({ ok: true });
  }

  private getModuleRulePackRoute(moduleId: string, req: Request): Response {
    if (!this.moduleExists(moduleId)) return Response.json({ error: '模组不存在' }, { status: 404 });
    const statuses = parseReviewStatusQuery(new URL(req.url).searchParams.get('status'));
    return Response.json(getModuleRulePack(this.db, moduleId, statuses) ?? null);
  }

  private async updateModuleRulePackRoute(moduleId: string, req: Request): Promise<Response> {
    if (!this.moduleExists(moduleId)) return Response.json({ error: '模组不存在' }, { status: 404 });
    const existing = getModuleRulePack(this.db, moduleId);
    const body = await req.json().catch(() => ({})) as Partial<ModuleRulePack>;
    const merged = buildModuleRulePackRecord({ ...existing, ...body, reviewStatus: body.reviewStatus ?? existing?.reviewStatus ?? 'draft' }, moduleId);
    if (existing) {
      this.db.run(
        `UPDATE module_rule_packs SET
           san_rules = ?, combat_rules = ?, death_rules = ?, time_rules = ?, revelation_rules = ?,
           forbidden_assumptions = ?, free_text = ?, review_status = ?, updated_at = ?
         WHERE module_id = ?`,
        [
          merged.sanRules, merged.combatRules, merged.deathRules, merged.timeRules, merged.revelationRules,
          merged.forbiddenAssumptions, merged.freeText, merged.reviewStatus, new Date().toISOString(), moduleId,
        ],
      );
    } else {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.run(
        `INSERT INTO module_rule_packs
           (id, module_id, san_rules, combat_rules, death_rules, time_rules, revelation_rules,
            forbidden_assumptions, free_text, review_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, moduleId, merged.sanRules, merged.combatRules, merged.deathRules, merged.timeRules,
          merged.revelationRules, merged.forbiddenAssumptions, merged.freeText, merged.reviewStatus, now, now,
        ],
      );
    }
    return Response.json({ ok: true });
  }

  private async updateModuleRulePackReviewRoute(moduleId: string, req: Request): Promise<Response> {
    const rulePack = getModuleRulePack(this.db, moduleId);
    if (!rulePack) return Response.json({ error: '规则包不存在' }, { status: 404 });
    const body = await req.json().catch(() => ({})) as { reviewStatus?: ReviewStatus };
    const reviewStatus = normalizeReviewStatus(body.reviewStatus);
    if (!reviewStatus) return Response.json({ error: 'reviewStatus invalid' }, { status: 400 });
    this.db.run(
      'UPDATE module_rule_packs SET review_status = ?, updated_at = ? WHERE module_id = ?',
      [reviewStatus, new Date().toISOString(), moduleId],
    );
    return Response.json({ ok: true });
  }

  private moduleExists(moduleId: string): boolean {
    return !!this.db.query<{ id: string }, string>('SELECT id FROM scenario_modules WHERE id = ?').get(moduleId);
  }

  private async uploadModuleFile(moduleId: string, req: Request): Promise<Response> {
    const m = this.db.query<{ id: string }, string>('SELECT id FROM scenario_modules WHERE id = ?').get(moduleId);
    if (!m) return Response.json({ error: '模组不存在' }, { status: 404 });

    try {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return Response.json({ error: 'file required' }, { status: 400 });

      const label = (formData.get('label') as string | null)?.trim() ?? null;
      const description = (formData.get('description') as string | null)?.trim() ?? null;

      const fs = require('fs');
      const path = require('path');
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
      const fileType = isImage ? 'image' : 'document';

      let destDir: string;
      if (isImage) {
        destDir = `./data/knowledge/images/modules/${moduleId}`;
      } else {
        destDir = `./data/knowledge/uploads/${moduleId}`;
      }
      fs.mkdirSync(destDir, { recursive: true });

      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
      const dest = path.join(destDir, safeName);
      fs.writeFileSync(dest, new Uint8Array(await file.arrayBuffer()));

      const fileId = crypto.randomUUID();
      const now = new Date().toISOString();

      this.db.run(
        'INSERT INTO scenario_module_files (id, module_id, filename, original_name, file_type, label, description, import_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [fileId, moduleId, dest, file.name, fileType, label, description, isImage ? 'done' : 'pending', now],
      );

      // 文档类型触发后台索引
      if (!isImage) {
        const job: ImportJob = {
          id: fileId,
          filename: safeName,
          category: 'scenario',
          status: 'pending',
          startedAt: now,
        };
        this.importJobs.set(fileId, job);

        const proc = Bun.spawn(
          ['bun', 'run', 'scripts/import-pdfs.ts', `--file=${dest}`, '--category=scenario'],
          { stdout: 'inherit', stderr: 'inherit' },
        );
        proc.exited.then(async (code) => {
          const status = code === 0 ? 'done' : 'failed';
          const error = code !== 0 ? `exit code ${code}` : null;
          this.db.run(
            'UPDATE scenario_module_files SET import_status = ?, import_error = ? WHERE id = ?',
            [status, error, fileId],
          );
          job.status = status;
          if (error) job.error = error;
          job.finishedAt = new Date().toISOString();

          // 导入成功后，AI 自动填充模组元数据
          if (code === 0) {
            this.autoFillModuleMetadata(moduleId, dest).catch((err) => {
              console.error('[AdminRoutes] AI 自动填充模组元数据失败:', err);
            });
          }
        }).catch((e) => {
          this.db.run(
            'UPDATE scenario_module_files SET import_status = ?, import_error = ? WHERE id = ?',
            ['failed', String(e), fileId],
          );
        });
      }

      return Response.json({ ok: true, id: fileId, fileType });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  /**
   * 文档导入成功后，用 AI 从提取的文本中自动填充模组元数据。
   * 只填充当前为空的字段，不覆盖已手动填写的内容。
   */
  private async autoFillModuleMetadata(moduleId: string, docPath: string): Promise<void> {
    if (this.aiClient) {
      const mod = this.db.query<{
        name: string; description: string | null; era: string | null;
        allowed_occupations: string; min_stats: string;
      }, string>('SELECT name, description, era, allowed_occupations, min_stats FROM scenario_modules WHERE id = ?').get(moduleId);
      if (mod) {
        const text = await this.loadModuleImportText(docPath);
        if (text && text.length >= 50) {
          try {
            const metadata = await this.extractModuleMetadataDraft(text.slice(0, 6000));
            this.applyModuleMetadataDraft(moduleId, mod, metadata);
          } catch (err) {
            console.error('[AutoFill] 元数据提取失败:', err);
          }

          try {
            const assets = await this.extractModuleAssetsDraft(text.slice(0, 12000));
            this.saveModuleAssetDrafts(moduleId, assets);
          } catch (err) {
            console.error('[AutoFill] 资产提取失败:', err);
          }

          try {
            const rulePack = await this.extractModuleRulePackDraft(text.slice(0, 12000));
            this.saveModuleRulePackDraft(moduleId, rulePack);
          } catch (err) {
            console.error('[AutoFill] 规则包提取失败:', err);
          }
        }
      }
      return;
    }

    console.log(`[AutoFill] === 开始 === moduleId=${moduleId}, docPath=${docPath}`);
    if (!this.aiClient) { console.log('[AutoFill] 跳过：aiClient 未配置'); return; }

    const mod = this.db.query<{
      name: string; description: string | null; era: string | null;
      allowed_occupations: string; min_stats: string;
    }, string>('SELECT name, description, era, allowed_occupations, min_stats FROM scenario_modules WHERE id = ?').get(moduleId);
    if (!mod) { console.log('[AutoFill] 跳过：模组不存在'); return; }
    console.log(`[AutoFill] 当前模组: name="${mod.name}", desc="${mod.description}", era="${mod.era}"`);

    // 从 manifest.json 找到该文档的提取文本路径
    const { readFileSync, existsSync, readdirSync, statSync } = await import('fs');
    let text = '';

    // 方案 1: manifest 匹配（对比文件名尾部）
    const manifestPath = resolve('data/knowledge/manifest.json');
    const docFileName = docPath.replace(/\\/g, '/').split('/').pop() ?? ''; // 提取纯文件名
    console.log(`[AutoFill] docFileName="${docFileName}", manifestPath="${manifestPath}", exists=${existsSync(manifestPath)}`);

    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
          files?: Array<{ sourcePath?: string; sourceRelativePath?: string; textPath?: string }>;
        };
        console.log(`[AutoFill] manifest 共 ${manifest.files?.length ?? 0} 条:`);
        manifest.files?.forEach((f, i) => console.log(`  [${i}] relPath="${f.sourceRelativePath}" textPath="${f.textPath}"`));

        const entry = manifest.files?.find((f) =>
          f.sourceRelativePath === docFileName ||
          (f.sourcePath && f.sourcePath.replace(/\\/g, '/').split('/').pop() === docFileName),
        );
        if (entry?.textPath) {
          const textFullPath = resolve(entry.textPath);
          console.log(`[AutoFill] manifest 匹配成功: textPath="${textFullPath}", exists=${existsSync(textFullPath)}`);
          if (existsSync(textFullPath)) {
            text = readFileSync(textFullPath, 'utf-8');
            console.log(`[AutoFill] 读取成功，${text.length} 字符`);
          }
        } else {
          console.log(`[AutoFill] manifest 未匹配 "${docFileName}"`);
        }
      } catch (err) {
        console.error('[AutoFill] manifest 读取失败:', err);
      }
    }

    // 方案 2: 扫描 raw 目录找最新的 .txt
    if (!text) {
      const rawDir = resolve('data/knowledge/raw');
      console.log(`[AutoFill] fallback: 扫描 ${rawDir}, exists=${existsSync(rawDir)}`);
      if (existsSync(rawDir)) {
        const txtFiles = readdirSync(rawDir)
          .filter((f) => f.endsWith('.txt'))
          .map((f) => ({ name: f, mtime: statSync(resolve(rawDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        console.log(`[AutoFill] 找到 ${txtFiles.length} 个 .txt 文件: ${txtFiles.map(f => f.name).join(', ')}`);
        if (txtFiles.length > 0) {
          try {
            text = readFileSync(resolve(rawDir, txtFiles[0].name), 'utf-8');
            console.log(`[AutoFill] fallback 读取 ${txtFiles[0].name}，${text.length} 字符`);
          } catch (e) { console.error('[AutoFill] fallback 读取失败:', e); }
        }
      }
    }

    if (!text || text.length < 50) { console.log(`[AutoFill] 跳过：文本太短 (${text.length} 字符)`); return; }

    // 截取前 6000 字符给 AI 分析
    const excerpt = text.slice(0, 6000);
    console.log(`[AutoFill] 准备调用 AI，excerpt 前100字: "${excerpt.slice(0, 100)}..."`);

    const prompt = `你是一个 CoC（克苏鲁的呼唤）跑团模组分析专家。阅读以下模组文本的开头部分，提取关键信息。

请以严格 JSON 格式输出（不要输出其他内容）：
{
  "name": "模组名称",
  "description": "3-5句简明剧情简介，供玩家阅读，不要剧透关键情节和结局",
  "era": "1920s 或 现代 或 其他时代描述",
  "allowedOccupations": ["适合的职业1", "职业2"],
  "minStats": {"属性名": 最低值}
}

规则：
- name: 提取模组的官方名称
- description: 玩家可见的简介，营造氛围但不剧透
- era: 根据内容判断时代背景
- allowedOccupations: 如果模组有职业限制则列出，否则空数组 []
- minStats: 如果模组有属性要求则列出（如 {"智力": 60}），否则空对象 {}
- 不要输出任何思考过程，只输出 JSON`;

    try {
      console.log('[AutoFill] 调用 AI chat...');
      const result = await (this.aiClient as unknown as DashScopeClient).chat('qwen3.5-flash', [
        { role: 'system', content: prompt },
        { role: 'user', content: excerpt },
      ]);
      console.log(`[AutoFill] AI 返回 ${result.length} 字符: "${result.slice(0, 200)}..."`);

      // 清理 AI 输出（去掉 think 标签和 markdown 代码块）
      const cleaned = result
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      console.log(`[AutoFill] 清理后: "${cleaned.slice(0, 300)}"`);

      const data = JSON.parse(cleaned) as {
        name?: string;
        description?: string;
        era?: string;
        allowedOccupations?: string[];
        minStats?: Record<string, number>;
      };
      console.log(`[AutoFill] 解析成功: name="${data.name}", era="${data.era}", desc="${data.description?.slice(0, 50)}..."`);

      // 只更新空字段
      const updates: string[] = [];
      const values: (string | null)[] = [];

      const hasOccs = mod.allowed_occupations && JSON.parse(mod.allowed_occupations).length > 0;
      const hasStats = mod.min_stats && Object.keys(JSON.parse(mod.min_stats)).length > 0;

      // 名称：如果 AI 提取的名称不同于当前临时名称，总是更新
      if (data.name && data.name !== mod.name) {
        updates.push('name = ?');
        values.push(data.name);
      }
      if (!mod.description && data.description) {
        updates.push('description = ?');
        values.push(data.description);
      }
      if (!mod.era && data.era) {
        updates.push('era = ?');
        values.push(data.era);
      }
      if (!hasOccs && data.allowedOccupations && data.allowedOccupations.length > 0) {
        updates.push('allowed_occupations = ?');
        values.push(JSON.stringify(data.allowedOccupations));
      }
      if (!hasStats && data.minStats && Object.keys(data.minStats).length > 0) {
        updates.push('min_stats = ?');
        values.push(JSON.stringify(data.minStats));
      }

      console.log(`[AutoFill] 待更新字段: ${updates.length > 0 ? updates.join(', ') : '（无）'}`);

      if (updates.length > 0) {
        updates.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(moduleId);
        this.db.run(
          `UPDATE scenario_modules SET ${updates.join(', ')} WHERE id = ?`,
          values,
        );
        console.log(`[AutoFill] ✅ 已更新模组 ${moduleId}: ${updates.filter(u => u !== 'updated_at = ?').join(', ')}`);
      }
    } catch (err) {
      console.error('[AutoFill] ❌ AI 解析失败:', err);
    }
  }

  private async loadModuleImportText(docPath: string): Promise<string> {
    const { readFileSync, existsSync, readdirSync, statSync } = await import('fs');
    let text = '';
    const manifestPath = resolve('data/knowledge/manifest.json');
    const docFileName = docPath.replace(/\\/g, '/').split('/').pop() ?? '';

    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
          files?: Array<{ sourcePath?: string; sourceRelativePath?: string; textPath?: string }>;
        };
        const entry = manifest.files?.find((file) =>
          file.sourceRelativePath === docFileName ||
          (file.sourcePath && file.sourcePath.replace(/\\/g, '/').split('/').pop() === docFileName),
        );
        if (entry?.textPath) {
          const textFullPath = resolve(entry.textPath);
          if (existsSync(textFullPath)) {
            text = readFileSync(textFullPath, 'utf-8');
          }
        }
      } catch (err) {
        console.error('[AutoFill] manifest 读取失败:', err);
      }
    }

    if (!text) {
      const rawDir = resolve('data/knowledge/raw');
      if (existsSync(rawDir)) {
        const txtFiles = readdirSync(rawDir)
          .filter((filename) => filename.endsWith('.txt'))
          .map((filename) => ({ filename, mtime: statSync(resolve(rawDir, filename)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (txtFiles.length > 0) {
          text = readFileSync(resolve(rawDir, txtFiles[0].filename), 'utf-8');
        }
      }
    }

    return text;
  }

  private async extractModuleMetadataDraft(excerpt: string): Promise<ModuleMetadataDraft> {
    return this.extractJsonWithAi<ModuleMetadataDraft>(`你是一个 CoC（克苏鲁的呼唤）跑团模组分析专家。阅读以下模组文本的开头部分，提取关键信息。

请以严格 JSON 格式输出（不要输出其他内容）：
{
  "name": "模组名称",
  "description": "3-5句简明剧情简介，供玩家阅读，不要剧透关键情节和结局",
  "era": "1920s 或 现代 或 其他时代描述",
  "allowedOccupations": ["适合的职业1", "职业2"],
  "minStats": {"属性名": 最低值}
}

规则：
- description 必须玩家可见，不剧透
- allowedOccupations 没有限制时输出 []
- minStats 没有要求时输出 {}
- 只输出 JSON`, excerpt);
  }

  private async extractModuleAssetsDraft(excerpt: string): Promise<ModuleAssetsDraft> {
    return this.extractJsonWithAi<ModuleAssetsDraft>(`你是一个 CoC 模组资产提取器。请从文本中只提取最关键的模组资产候选。

严格输出 JSON：
{
  "entities": [
    {
      "type": "npc 或 creature",
      "name": "名称",
      "identity": "身份",
      "motivation": "动机",
      "publicImage": "公开形象",
      "hiddenTruth": "隐藏真相",
      "speakingStyle": "说话风格",
      "faction": "阵营",
      "dangerLevel": "危险等级",
      "defaultLocation": "默认地点",
      "attributes": {"力量": 60},
      "skills": {"侦查": 60},
      "combat": {"hp": 12, "armor": 1, "mov": 8, "build": 1, "attacks": [{"name": "爪击", "skill": 60, "damage": "1D6", "rof": 1}]},
      "freeText": "无法结构化但重要的补充",
      "relationships": [{"targetId": "", "relation": "knows", "notes": "备注"}],
      "isKey": true
    }
  ],
  "items": [
    {
      "name": "名称",
      "category": "类别",
      "publicDescription": "玩家可见描述",
      "kpNotes": "KP 备注",
      "defaultOwner": "默认归属",
      "defaultLocation": "默认位置",
      "visibilityCondition": "可见条件",
      "usage": "用途或效果",
      "isKey": true
    }
  ]
}

规则：
- 关键 NPC 只保留有名字、有动机、会与调查员互动的角色
- 关键物品只保留推动剧情、解谜必须或有特殊效果的物品
- 最多输出 10 个实体和 10 个物品
- 不确定的字段用空字符串、空对象或空数组
- 只输出 JSON`, excerpt);
  }

  private async extractModuleRulePackDraft(excerpt: string): Promise<ModuleRulePackDraft> {
    return this.extractJsonWithAi<ModuleRulePackDraft>(`你是一个 CoC 模组规则包提取器。请只提取模组专属设定和会影响主持裁定的特殊规则。

严格输出 JSON：
{
  "sanRules": "特殊理智规则，没有则空字符串",
  "combatRules": "特殊战斗规则，没有则空字符串",
  "deathRules": "死亡/濒死/复活相关特殊规则，没有则空字符串",
  "timeRules": "时间推进或日程限制，没有则空字符串",
  "revelationRules": "信息揭示边界和特殊方式，没有则空字符串",
  "forbiddenAssumptions": "KP 默认不应自行假设的事项，没有则空字符串",
  "freeText": "其他重要模组专属机制与设定，没有则空字符串"
}

规则：
- 重点提取高于 CoC 通用规则的模组特例
- 只输出 JSON`, excerpt);
  }

  private async extractJsonWithAi<T>(prompt: string, excerpt: string): Promise<T> {
    const aiClient = this.aiClient;
    if (!aiClient) throw new Error('AI client unavailable');
    const result = await aiClient.chat('qwen3.5-flash', [
      { role: 'system', content: prompt },
      { role: 'user', content: excerpt },
    ]);
    const cleaned = result
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    return JSON.parse(cleaned) as T;
  }

  private applyModuleMetadataDraft(
    moduleId: string,
    mod: { name: string; description: string | null; era: string | null; allowed_occupations: string; min_stats: string },
    data: ModuleMetadataDraft,
  ): void {
    const updates: string[] = [];
    const values: string[] = [];
    const hasOccs = mod.allowed_occupations && JSON.parse(mod.allowed_occupations).length > 0;
    const hasStats = mod.min_stats && Object.keys(JSON.parse(mod.min_stats)).length > 0;

    if (data.name && data.name !== mod.name) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (!mod.description && data.description) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (!mod.era && data.era) {
      updates.push('era = ?');
      values.push(data.era);
    }
    if (!hasOccs && data.allowedOccupations && data.allowedOccupations.length > 0) {
      updates.push('allowed_occupations = ?');
      values.push(JSON.stringify(data.allowedOccupations));
    }
    if (!hasStats && data.minStats && Object.keys(data.minStats).length > 0) {
      updates.push('min_stats = ?');
      values.push(JSON.stringify(data.minStats));
    }

    if (updates.length === 0) return;
    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(moduleId);
    this.db.run(`UPDATE scenario_modules SET ${updates.join(', ')} WHERE id = ?`, values);
  }

  private saveModuleAssetDrafts(moduleId: string, draft: ModuleAssetsDraft): void {
    const entities = (draft.entities ?? []).slice(0, 10).map((item) => buildScenarioEntityRecord(item));
    const items = (draft.items ?? []).slice(0, 10).map((item) => buildScenarioItemRecord(item));
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db.run(`DELETE FROM module_entities WHERE module_id = ? AND review_status IN ('draft', 'rejected')`, [moduleId]);
      this.db.run(`DELETE FROM module_items WHERE module_id = ? AND review_status IN ('draft', 'rejected')`, [moduleId]);

      for (const entity of entities) {
        if (!entity.name) continue;
        this.db.run(
          `INSERT INTO module_entities
             (id, module_id, type, name, identity, motivation, public_image, hidden_truth,
              speaking_style, faction, danger_level, default_location, attributes_json,
              skills_json, combat_json, free_text, relationships_json, is_key, review_status,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          [
            crypto.randomUUID(), moduleId, entity.type, entity.name, entity.identity, entity.motivation,
            entity.publicImage, entity.hiddenTruth, entity.speakingStyle, entity.faction, entity.dangerLevel,
            entity.defaultLocation, JSON.stringify(entity.attributes), JSON.stringify(entity.skills),
            JSON.stringify(entity.combat), entity.freeText, JSON.stringify(entity.relationships),
            entity.isKey ? 1 : 0, now, now,
          ],
        );
      }

      for (const item of items) {
        if (!item.name) continue;
        this.db.run(
          `INSERT INTO module_items
             (id, module_id, name, category, public_description, kp_notes, default_owner,
              default_location, visibility_condition, usage, is_key, review_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          [
            crypto.randomUUID(), moduleId, item.name, item.category, item.publicDescription, item.kpNotes,
            item.defaultOwner, item.defaultLocation, item.visibilityCondition, item.usage,
            item.isKey ? 1 : 0, now, now,
          ],
        );
      }
    })();
  }

  private saveModuleRulePackDraft(moduleId: string, draft: ModuleRulePackDraft): void {
    const record = buildModuleRulePackRecord(draft, moduleId);
    if (!record.sanRules && !record.combatRules && !record.deathRules && !record.timeRules &&
        !record.revelationRules && !record.forbiddenAssumptions && !record.freeText) {
      return;
    }

    const existing = getModuleRulePack(this.db, moduleId);
    if (existing?.reviewStatus === 'approved') return;

    const now = new Date().toISOString();
    if (existing) {
      this.db.run(
        `UPDATE module_rule_packs SET
           san_rules = ?, combat_rules = ?, death_rules = ?, time_rules = ?, revelation_rules = ?,
           forbidden_assumptions = ?, free_text = ?, review_status = 'draft', updated_at = ?
         WHERE module_id = ?`,
        [
          record.sanRules, record.combatRules, record.deathRules, record.timeRules,
          record.revelationRules, record.forbiddenAssumptions, record.freeText, now, moduleId,
        ],
      );
      return;
    }

    this.db.run(
      `INSERT INTO module_rule_packs
         (id, module_id, san_rules, combat_rules, death_rules, time_rules, revelation_rules,
          forbidden_assumptions, free_text, review_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        crypto.randomUUID(), moduleId, record.sanRules, record.combatRules, record.deathRules,
        record.timeRules, record.revelationRules, record.forbiddenAssumptions, record.freeText, now, now,
      ],
    );
  }

  private deleteModuleFile(moduleId: string, fileId: string): Response {
    const f = this.db.query<{ filename: string; file_type: string }, [string, string]>(
      'SELECT filename, file_type FROM scenario_module_files WHERE id = ? AND module_id = ?',
    ).get(fileId, moduleId);
    if (!f) return Response.json({ error: '文件不存在' }, { status: 404 });

    // 图片删除物理文件
    if (f.file_type === 'image') {
      try { require('fs').unlinkSync(f.filename); } catch { /* 忽略 */ }
    }

    this.db.run('DELETE FROM scenario_module_files WHERE id = ?', [fileId]);
    return Response.json({ ok: true });
  }

  private async generateModuleImage(moduleId: string, req: Request): Promise<Response> {
    if (!this.aiClient) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });

    const m = this.db.query<{ id: string }, string>('SELECT id FROM scenario_modules WHERE id = ?').get(moduleId);
    if (!m) return Response.json({ error: '模组不存在' }, { status: 404 });

    const body = await req.json().catch(() => ({})) as {
      description?: string; label?: string; size?: string;
    };
    const desc = body.description?.trim();
    if (!desc) return Response.json({ error: 'description required' }, { status: 400 });

    try {
      const optimizedPrompt = await this.aiClient.optimizeImagePrompt(desc);
      const imageUrl = await this.aiClient.generateImage(optimizedPrompt, body.size);

      const fs = require('fs');
      const imgDir = `./data/knowledge/images/modules/${moduleId}`;
      fs.mkdirSync(imgDir, { recursive: true });

      const imgId = ImageLibrary.generateId();
      const imgPath = `${imgDir}/${imgId}.jpg`;
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`下载生成图片失败: ${imgResp.status}`);
      fs.writeFileSync(imgPath, Buffer.from(await imgResp.arrayBuffer()));

      const now = new Date().toISOString();
      this.db.run(
        'INSERT INTO scenario_module_files (id, module_id, filename, original_name, file_type, label, description, import_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [imgId, moduleId, imgPath, `${imgId}.jpg`, 'image', body.label?.trim() ?? null, desc, 'done', now],
      );

      return Response.json({ ok: true, id: imgId });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500 });
    }
  }

  private serveModuleImage(moduleId: string, fileId: string): Response {
    const f = this.db.query<{ filename: string }, [string, string]>(
      "SELECT filename FROM scenario_module_files WHERE id = ? AND module_id = ? AND file_type = 'image'",
    ).get(fileId, moduleId);
    if (!f) return Response.json({ error: '图片不存在' }, { status: 404 });

    try {
      const buf = require('fs').readFileSync(f.filename) as Buffer;
      const ext = f.filename.split('.').pop()?.toLowerCase() ?? 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
      return new Response(buf, { headers: { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' } });
    } catch {
      return Response.json({ error: '读取图片失败' }, { status: 500 });
    }
  }
}

function parseReviewStatusQuery(raw: string | null): ReviewStatus[] | undefined {
  if (!raw?.trim()) return undefined;
  const statuses = raw.split(',')
    .map((item) => normalizeReviewStatus(item.trim()))
    .filter((item): item is ReviewStatus => item !== null);
  return statuses.length > 0 ? statuses : undefined;
}

function normalizeReviewStatus(value?: string | null): ReviewStatus | null {
  if (value === 'draft' || value === 'approved' || value === 'rejected') return value;
  return null;
}

function buildScenarioEntityRecord(input: Partial<ScenarioEntity> | undefined) {
  return {
    type: input?.type === 'creature' ? 'creature' : 'npc',
    name: String(input?.name ?? '').trim(),
    identity: String(input?.identity ?? '').trim(),
    motivation: String(input?.motivation ?? '').trim(),
    publicImage: String(input?.publicImage ?? '').trim(),
    hiddenTruth: String(input?.hiddenTruth ?? '').trim(),
    speakingStyle: String(input?.speakingStyle ?? '').trim(),
    faction: String(input?.faction ?? '').trim(),
    dangerLevel: String(input?.dangerLevel ?? '').trim(),
    defaultLocation: String(input?.defaultLocation ?? '').trim(),
    attributes: normalizeNumberRecord(input?.attributes),
    skills: normalizeNumberRecord(input?.skills),
    combat: normalizeCombat(input?.combat),
    freeText: String(input?.freeText ?? '').trim(),
    relationships: normalizeRelationships(input?.relationships),
    isKey: input?.isKey !== false,
    reviewStatus: normalizeReviewStatus(input?.reviewStatus) ?? 'draft',
  };
}

function buildScenarioItemRecord(input: Partial<ScenarioItem> | undefined) {
  return {
    name: String(input?.name ?? '').trim(),
    category: String(input?.category ?? '').trim(),
    publicDescription: String(input?.publicDescription ?? '').trim(),
    kpNotes: String(input?.kpNotes ?? '').trim(),
    defaultOwner: String(input?.defaultOwner ?? '').trim(),
    defaultLocation: String(input?.defaultLocation ?? '').trim(),
    visibilityCondition: String(input?.visibilityCondition ?? '').trim(),
    usage: String(input?.usage ?? '').trim(),
    isKey: input?.isKey !== false,
    reviewStatus: normalizeReviewStatus(input?.reviewStatus) ?? 'draft',
  };
}

function buildModuleRulePackRecord(input: Partial<ModuleRulePack> | Partial<ModuleRulePackDraft> | undefined, moduleId: string) {
  return {
    moduleId,
    sanRules: String(input?.sanRules ?? '').trim(),
    combatRules: String(input?.combatRules ?? '').trim(),
    deathRules: String(input?.deathRules ?? '').trim(),
    timeRules: String(input?.timeRules ?? '').trim(),
    revelationRules: String(input?.revelationRules ?? '').trim(),
    forbiddenAssumptions: String(input?.forbiddenAssumptions ?? '').trim(),
    freeText: String(input?.freeText ?? '').trim(),
    reviewStatus: normalizeReviewStatus((input as { reviewStatus?: string } | undefined)?.reviewStatus) ?? 'draft',
  };
}

function normalizeNumberRecord(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
  ) as Record<string, number>;
}

function normalizeCombat(input: unknown) {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const attacks = Array.isArray(record.attacks)
    ? record.attacks.map((attack) => {
        if (!attack || typeof attack !== 'object') return null;
        const attackRecord = attack as Record<string, unknown>;
        return {
          name: String(attackRecord.name ?? '').trim(),
          skill: typeof attackRecord.skill === 'number' && Number.isFinite(attackRecord.skill) ? attackRecord.skill : null,
          damage: String(attackRecord.damage ?? '').trim(),
          rof: typeof attackRecord.rof === 'number' && Number.isFinite(attackRecord.rof) ? attackRecord.rof : null,
        };
      }).filter(Boolean)
    : [];
  return {
    hp: typeof record.hp === 'number' && Number.isFinite(record.hp) ? record.hp : null,
    armor: typeof record.armor === 'number' && Number.isFinite(record.armor) ? record.armor : null,
    mov: typeof record.mov === 'number' && Number.isFinite(record.mov) ? record.mov : null,
    build: typeof record.build === 'number' && Number.isFinite(record.build) ? record.build : null,
    attacks,
  };
}

function normalizeRelationships(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const targetId = String(record.targetId ?? '').trim();
      return {
        targetId,
        relation: String(record.relation ?? 'unknown').trim() || 'unknown',
        notes: String(record.notes ?? '').trim(),
      };
    })
    .filter((item): item is { targetId: string; relation: string; notes: string } => Boolean(item));
}
