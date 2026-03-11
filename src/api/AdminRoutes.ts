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
 * GET  /sessions/:groupId/clues         — 线索列表
 * POST /sessions/:groupId/clues/:id/discover — 标记线索已发现
 * POST /sessions/:groupId/inject        — 向会话注入信息
 * GET  /sessions/:groupId/messages/stream — SSE 实时消息流
 * GET  /knowledge                       — 已导入文件列表
 * POST /knowledge/upload                — 上传并导入文件（异步）
 * GET  /kp-templates                    — KP 人格模板列表
 */

import type { Database } from 'bun:sqlite';
import type { CampaignHandler } from '../runtime/CampaignHandler';

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

export class AdminRoutes {
  /** SSE 订阅者 map: groupId → Set<Controller> */
  private sseClients: Map<number, Set<ReadableStreamDefaultController<Uint8Array>>> = new Map();
  private importJobs: Map<string, ImportJob> = new Map();

  constructor(
    private readonly db: Database,
    private readonly campaignHandler: CampaignHandler | null,
    private readonly adminSecret: string,
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
      if (method === 'GET' && action === 'clues') return this.listClues(groupId);
      if (method === 'POST' && action === 'clues' && segments[3] && segments[4] === 'discover') {
        return this.discoverClue(groupId, segments[3]);
      }
      if (method === 'POST' && action === 'inject') return this.injectInfo(groupId, req);
      if (method === 'GET' && action === 'messages' && segments[3] === 'stream') {
        return this.messagesStream(groupId);
      }
    }

    // /knowledge
    if (resource === 'knowledge') {
      if (method === 'GET' && !segments[1]) return this.listKnowledge();
      if (method === 'GET' && segments[1] === 'jobs') return this.listKnowledgeJobs();
      if (method === 'POST' && segments[1] === 'upload') return this.uploadKnowledge(req);
    }

    // /kp-templates
    if (resource === 'kp-templates' && method === 'GET') return this.listKpTemplates();

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
    const parts = await this.campaignHandler.startSession(groupId, body.templateId).catch((e) => {
      throw e;
    });
    return Response.json({ parts });
  }

  private pauseSession(groupId: number): Response {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const msg = this.campaignHandler.pauseSession(groupId);
    return Response.json({ message: msg });
  }

  private async resumeSession(groupId: number): Promise<Response> {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const parts = await this.campaignHandler.resumeSession(groupId);
    return Response.json({ parts });
  }

  private stopSession(groupId: number): Response {
    if (!this.campaignHandler) return Response.json({ error: 'AI 客户端未配置' }, { status: 503 });
    const msg = this.campaignHandler.stopSession(groupId);
    return Response.json({ message: msg });
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

  // ─── KP Templates ──────────────────────────────────────────────────────────

  private listKpTemplates(): Response {
    const { KPTemplateRegistry } = require('../ai/config/KPTemplateRegistry');
    const registry = new KPTemplateRegistry();
    return Response.json(registry.getAll().map((t: {
      id: string; name: string; description: string;
      humorLevel: number; rulesStrictness: number; narrativeFlexibility: number;
    }) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      humorLevel: t.humorLevel,
      rulesStrictness: t.rulesStrictness,
      narrativeFlexibility: t.narrativeFlexibility,
    })));
  }

  // ─── 工具 ──────────────────────────────────────────────────────────────────

  private getActiveSession(groupId: number): { id: string } | null {
    return this.db.query<{ id: string }, number>(
      "SELECT id FROM kp_sessions WHERE group_id = ? AND status IN ('running', 'paused') ORDER BY updated_at DESC LIMIT 1",
    ).get(groupId);
  }
}
