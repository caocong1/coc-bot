/**
 * 玩家端 API 路由
 *
 * 所有请求需携带 Authorization: Bearer <token> 头部。
 *
 * GET  /me                  — 我的基本信息
 * GET  /characters          — 我的角色卡列表
 * POST /characters          — 新建角色卡
 * PUT  /characters/:id      — 更新角色卡（正在跑团的卡不可更新）
 * DELETE /characters/:id    — 删除角色卡
 * GET  /campaigns           — 我参与的团列表
 * GET  /campaigns/:id       — 团详情（玩家视角）
 * GET  /campaigns/:id/messages — 团消息历史（只读）
 * GET  /scenarios           — 模组列表（标题+简介）
 */

import type { Database } from 'bun:sqlite';
import type { TokenStore } from '../storage/TokenStore';
import type { CharacterStore } from '../commands/sheet/CharacterStore';

export class PlayerRoutes {
  constructor(
    private readonly db: Database,
    private readonly tokenStore: TokenStore,
    private readonly characterStore: CharacterStore,
  ) {}

  async handle(req: Request, subPath: string): Promise<Response | null> {
    const qqId = this.authenticate(req);
    if (qqId === null) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const method = req.method;
    const segments = subPath.replace(/^\//, '').split('/');
    const resource = segments[0];
    const resourceId = segments[1];

    // GET /me
    if (resource === 'me' && method === 'GET') {
      return this.getMe(qqId);
    }

    // /characters
    if (resource === 'characters') {
      if (method === 'GET' && !resourceId) return this.listCharacters(qqId);
      if (method === 'POST') return this.createCharacter(qqId, req);
      if (method === 'PUT' && resourceId) return this.updateCharacter(qqId, resourceId, req);
      if (method === 'DELETE' && resourceId) return this.deleteCharacter(qqId, resourceId);
    }

    // /campaigns
    if (resource === 'campaigns') {
      if (method === 'GET' && !resourceId) return this.listCampaigns(qqId);
      if (method === 'GET' && resourceId && !segments[2]) return this.getCampaign(qqId, resourceId);
      if (method === 'GET' && resourceId && segments[2] === 'messages') {
        return this.getCampaignMessages(qqId, resourceId);
      }
    }

    // /scenarios
    if (resource === 'scenarios' && method === 'GET') return this.listScenarios();

    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  private authenticate(req: Request): number | null {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length).trim();
    return this.tokenStore.verify(token);
  }

  // ─── 实现 ──────────────────────────────────────────────────────────────────

  private getMe(qqId: number): Response {
    const activeCharIds = this.getActiveSessionCharacterIds();
    const chars = this.db.query<{ id: string; name: string }, number>(
      'SELECT id, name FROM characters WHERE player_id = ?',
    ).all(qqId);
    return Response.json({
      qqId,
      characterCount: chars.length,
    });
  }

  private listCharacters(qqId: number): Response {
    const rows = this.db.query<{
      id: string; name: string; occupation: string | null; age: number | null;
      payload_json: string; updated_at: string;
    }, number>(
      'SELECT id, name, occupation, age, payload_json, updated_at FROM characters WHERE player_id = ? ORDER BY updated_at DESC',
    ).all(qqId);

    const activeIds = this.getActiveSessionCharacterIds();

    const chars = rows.map((r) => {
      const payload = JSON.parse(r.payload_json);
      return {
        id: r.id,
        name: r.name,
        occupation: r.occupation,
        age: r.age,
        hp: payload.derived?.hp ?? null,
        san: payload.derived?.san ?? null,
        updatedAt: r.updated_at,
        readonly: activeIds.has(r.id),
      };
    });

    return Response.json(chars);
  }

  private async createCharacter(qqId: number, req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = body.name as string;
    if (!name?.trim()) return Response.json({ error: '角色名不能为空' }, { status: 400 });

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.run(
      'INSERT INTO characters (id, player_id, name, occupation, age, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, qqId, name, (body.occupation as string | null) ?? null, (body.age as number | null) ?? null, JSON.stringify(body), now, now],
    );

    return Response.json({ id }, { status: 201 });
  }

  private async updateCharacter(qqId: number, id: string, req: Request): Promise<Response> {
    // 验证归属
    const row = this.db.query<{ player_id: number }, string>(
      'SELECT player_id FROM characters WHERE id = ?',
    ).get(id);
    if (!row) return Response.json({ error: '角色卡不存在' }, { status: 404 });
    if (row.player_id !== qqId) return Response.json({ error: 'Forbidden' }, { status: 403 });

    // 检查是否在进行中的团
    const activeIds = this.getActiveSessionCharacterIds();
    if (activeIds.has(id)) {
      return Response.json({ error: '该角色卡正参与进行中的跑团，无法编辑' }, { status: 409 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const now = new Date().toISOString();
    this.db.run(
      'UPDATE characters SET name = ?, occupation = ?, age = ?, payload_json = ?, updated_at = ? WHERE id = ?',
      [(body.name as string | null) ?? null, (body.occupation as string | null) ?? null, (body.age as number | null) ?? null, JSON.stringify(body), now, id],
    );

    return Response.json({ ok: true });
  }

  private deleteCharacter(qqId: number, id: string): Response {
    const row = this.db.query<{ player_id: number }, string>(
      'SELECT player_id FROM characters WHERE id = ?',
    ).get(id);
    if (!row) return Response.json({ error: '角色卡不存在' }, { status: 404 });
    if (row.player_id !== qqId) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const activeIds = this.getActiveSessionCharacterIds();
    if (activeIds.has(id)) {
      return Response.json({ error: '该角色卡正参与进行中的跑团，无法删除' }, { status: 409 });
    }

    this.db.run('DELETE FROM characters WHERE id = ?', [id]);
    return Response.json({ ok: true });
  }

  private listCampaigns(qqId: number): Response {
    // 查找该玩家参与的所有 session
    const sessions = this.db.query<{
      session_id: string; group_id: number; status: string; started_at: string; ended_at: string | null;
    }, number>(`
      SELECT s.id as session_id, s.group_id, s.status, s.started_at, s.ended_at
      FROM kp_sessions s
      JOIN kp_session_players p ON p.session_id = s.id
      WHERE p.user_id = ?
      ORDER BY s.started_at DESC
    `).all(qqId);

    const result = sessions.map((s) => {
      const scene = this.db.query<{ name: string }, string>(
        'SELECT name FROM kp_scenes WHERE session_id = ?',
      ).get(s.session_id);
      return {
        id: s.session_id,
        groupId: s.group_id,
        status: s.status,
        currentScene: scene?.name ?? null,
        startedAt: s.started_at,
        endedAt: s.ended_at,
      };
    });

    return Response.json(result);
  }

  private getCampaign(qqId: number, sessionId: string): Response {
    // 验证玩家是否参与该团
    const membership = this.db.query<{ user_id: number }, [string, number]>(
      'SELECT user_id FROM kp_session_players WHERE session_id = ? AND user_id = ?',
    ).get(sessionId, qqId);
    if (!membership) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const session = this.db.query<{
      id: string; group_id: number; status: string; kp_template_id: string; started_at: string;
    }, string>('SELECT id, group_id, status, kp_template_id, started_at FROM kp_sessions WHERE id = ?').get(sessionId);
    if (!session) return Response.json({ error: '团不存在' }, { status: 404 });

    const scene = this.db.query<{ name: string; description: string; active_npcs_json: string }, string>(
      'SELECT name, description, active_npcs_json FROM kp_scenes WHERE session_id = ?',
    ).get(sessionId);

    // 已发现线索（玩家视角）
    const clues = this.db.query<{ id: string; title: string; player_description: string; discovered_at: string }, string>(
      'SELECT id, title, player_description, discovered_at FROM kp_clues WHERE session_id = ? AND is_discovered = 1 ORDER BY discovered_at',
    ).all(sessionId);

    // 参与玩家
    const players = this.db.query<{ user_id: number; joined_at: string }, string>(
      'SELECT user_id, joined_at FROM kp_session_players WHERE session_id = ?',
    ).all(sessionId);

    return Response.json({
      id: session.id,
      groupId: session.group_id,
      status: session.status,
      kpTemplate: session.kp_template_id,
      startedAt: session.started_at,
      currentScene: scene ? {
        name: scene.name,
        activeNpcs: JSON.parse(scene.active_npcs_json),
      } : null,
      discoveredClues: clues,
      players: players.map((p) => ({ qqId: p.user_id, joinedAt: p.joined_at })),
    });
  }

  private getCampaignMessages(qqId: number, sessionId: string): Response {
    const membership = this.db.query<{ user_id: number }, [string, number]>(
      'SELECT user_id FROM kp_session_players WHERE session_id = ? AND user_id = ?',
    ).get(sessionId, qqId);
    if (!membership) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const messages = this.db.query<{
      id: string; role: string; display_name: string | null; content: string; timestamp: string;
    }, string>(
      'SELECT id, role, display_name, content, timestamp FROM kp_messages WHERE session_id = ? ORDER BY timestamp',
    ).all(sessionId);

    return Response.json(messages.map((m) => ({
      id: m.id,
      role: m.role,
      displayName: m.display_name,
      content: m.content,
      timestamp: m.timestamp,
    })));
  }

  private listScenarios(): Response {
    // 从 manifest.json 读取模组列表（不含 KP ONLY 内容）
    try {
      const manifestPath = './data/knowledge/manifest.json';
      const file = Bun.file(manifestPath);
      const manifest = JSON.parse(new TextDecoder().decode(
        new Uint8Array(require('fs').readFileSync(manifestPath)),
      )) as Array<{ name: string; description?: string; sourceRelativePath?: string }>;

      return Response.json(manifest.map((m) => ({
        name: m.name,
        description: m.description ?? '',
      })));
    } catch {
      return Response.json([]);
    }
  }

  /** 获取所有正在进行中的团里已绑定的角色卡 ID 集合 */
  private getActiveSessionCharacterIds(): Set<string> {
    // active_cards binding_key 格式: characterId:groupId
    // kp_sessions 中 status='running' 的 group_id 列表
    const activeSessions = this.db.query<{ group_id: number }, []>(
      "SELECT group_id FROM kp_sessions WHERE status = 'running'",
    ).all();

    if (activeSessions.length === 0) return new Set();

    const activeGroupIds = new Set(activeSessions.map((s) => s.group_id));
    const allBindings = this.db.query<{ binding_key: string; character_id: string }, []>(
      'SELECT binding_key, character_id FROM active_cards',
    ).all();

    const activeCharIds = new Set<string>();
    for (const b of allBindings) {
      const parts = b.binding_key.split(':');
      const groupId = parseInt(parts[parts.length - 1]);
      if (activeGroupIds.has(groupId)) {
        activeCharIds.add(b.character_id);
      }
    }
    return activeCharIds;
  }
}
