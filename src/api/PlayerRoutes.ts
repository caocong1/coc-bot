/**
 * 玩家端 API 路由
 *
 * 所有请求需携带 Authorization: Bearer <token> 头部。
 *
 * GET  /me                          — 我的基本信息
 * GET  /characters                  — 我的角色卡列表
 * POST /characters                  — 新建角色卡
 * PUT  /characters/:id              — 更新角色卡（正在跑团的卡不可更新）
 * DELETE /characters/:id            — 删除角色卡
 * GET  /campaigns                   — 我参与的团列表
 * GET  /campaigns/:id               — 团详情（玩家视角）
 * GET  /campaigns/:id/messages      — 团消息历史（只读）
 * GET  /scenarios                   — 模组列表（标题+简介）
 *
 * GET  /rooms                       — 跑团房间列表
 * POST /rooms                       — 创建房间
 * GET  /rooms/:id                   — 房间详情
 * DELETE /rooms/:id                 — 删除房间（创建者）
 * POST /rooms/:id/join              — 加入房间
 * PUT  /rooms/:id/character         — 选择本房间使用的 PC
 * POST /rooms/:id/start             — 从 Web 触发开团
 * PATCH /rooms/:id/constraints      — 更新房间约束（创建者）
 */

import type { Database } from 'bun:sqlite';
import type { TokenStore } from '../storage/TokenStore';
import type { CharacterStore } from '../commands/sheet/CharacterStore';
import type { CampaignHandler } from '../runtime/CampaignHandler';
import type { NapCatActionClient } from '../adapters/napcat/NapCatActionClient';

export class PlayerRoutes {
  constructor(
    private readonly db: Database,
    private readonly tokenStore: TokenStore,
    private readonly characterStore: CharacterStore,
    private readonly campaignHandler: CampaignHandler | null = null,
    private readonly actionClient: NapCatActionClient | null = null,
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
    const sub2 = segments[2];

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
      if (method === 'GET' && resourceId && !sub2) return this.getCampaign(qqId, resourceId);
      if (method === 'GET' && resourceId && sub2 === 'messages') {
        return this.getCampaignMessages(qqId, resourceId);
      }
    }

    // /scenarios
    if (resource === 'scenarios' && method === 'GET') return this.listScenarios();

    // /rooms
    if (resource === 'rooms') {
      if (method === 'GET' && !resourceId) return this.listRooms(qqId);
      if (method === 'POST' && !resourceId) return this.createRoom(qqId, req);
      if (method === 'GET' && resourceId && !sub2) return this.getRoom(qqId, resourceId);
      if (method === 'DELETE' && resourceId && !sub2) return this.deleteRoom(qqId, resourceId);
      if (method === 'POST' && resourceId && sub2 === 'join') return this.joinRoom(qqId, resourceId);
      if (method === 'PUT' && resourceId && sub2 === 'character') return this.setRoomCharacter(qqId, resourceId, req);
      if (method === 'POST' && resourceId && sub2 === 'start') return this.startRoom(qqId, resourceId);
      if (method === 'PATCH' && resourceId && sub2 === 'constraints') return this.updateConstraints(qqId, resourceId, req);
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  private authenticate(req: Request): number | null {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length).trim();
    return this.tokenStore.verify(token);
  }

  // ─── Characters ────────────────────────────────────────────────────────────

  private getMe(qqId: number): Response {
    const chars = this.db.query<{ id: string }, number>(
      'SELECT id FROM characters WHERE player_id = ?',
    ).all(qqId);
    return Response.json({ qqId, characterCount: chars.length });
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
    const row = this.db.query<{ player_id: number }, string>(
      'SELECT player_id FROM characters WHERE id = ?',
    ).get(id);
    if (!row) return Response.json({ error: '角色卡不存在' }, { status: 404 });
    if (row.player_id !== qqId) return Response.json({ error: 'Forbidden' }, { status: 403 });

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

  // ─── Campaigns ─────────────────────────────────────────────────────────────

  private listCampaigns(qqId: number): Response {
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

    const clues = this.db.query<{ id: string; title: string; player_description: string; discovered_at: string }, string>(
      'SELECT id, title, player_description, discovered_at FROM kp_clues WHERE session_id = ? AND is_discovered = 1 ORDER BY discovered_at',
    ).all(sessionId);

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

  // ─── Scenarios ─────────────────────────────────────────────────────────────

  private listScenarios(): Response {
    try {
      const manifestPath = './data/knowledge/manifest.json';
      const manifest = JSON.parse(new TextDecoder().decode(
        new Uint8Array(require('fs').readFileSync(manifestPath)),
      )) as Array<{ name: string; description?: string }>;

      return Response.json(manifest.map((m) => ({
        name: m.name,
        description: m.description ?? '',
      })));
    } catch {
      return Response.json([]);
    }
  }

  // ─── Rooms ─────────────────────────────────────────────────────────────────

  private listRooms(qqId: number): Response {
    // 返回：该玩家创建的 + 该玩家加入的
    const rooms = this.db.query<{
      id: string; name: string; group_id: number; creator_qq_id: number;
      scenario_name: string | null; constraints_json: string; status: string;
      kp_session_id: string | null; created_at: string;
    }, [number, number]>(`
      SELECT DISTINCT r.id, r.name, r.group_id, r.creator_qq_id, r.scenario_name,
             r.constraints_json, r.status, r.kp_session_id, r.created_at
      FROM campaign_rooms r
      LEFT JOIN campaign_room_members m ON m.room_id = r.id AND m.qq_id = ?
      WHERE r.creator_qq_id = ? OR m.qq_id IS NOT NULL
      ORDER BY r.created_at DESC
    `).all(qqId, qqId);

    return Response.json(rooms.map((r) => ({
      ...this.formatRoom(r, qqId),
      memberCount: this.getRoomMemberCount(r.id),
    })));
  }

  private async createRoom(qqId: number, req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = (body.name as string)?.trim();
    const groupId = body.groupId as number;
    if (!name) return Response.json({ error: '房间名不能为空' }, { status: 400 });
    if (!groupId) return Response.json({ error: '请指定 QQ 群号' }, { status: 400 });

    // 检查该群是否已有 waiting/running 的房间
    const existing = this.db.query<{ id: string }, [number, string, string]>(
      `SELECT id FROM campaign_rooms WHERE group_id = ? AND status IN (?, ?)`,
    ).get(groupId, 'waiting', 'running');
    if (existing) {
      return Response.json({ error: '该群已有进行中的跑团房间，请先删除或等待结束' }, { status: 409 });
    }

    const id = crypto.randomUUID().slice(0, 8); // 短 ID，方便复制
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO campaign_rooms (id, name, group_id, creator_qq_id, scenario_name, constraints_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      [id, name, groupId, qqId,
        (body.scenarioName as string | null) ?? null,
        JSON.stringify(body.constraints ?? {}),
        now, now],
    );

    // 创建者自动加入
    this.db.run(
      'INSERT OR IGNORE INTO campaign_room_members (room_id, qq_id, joined_at) VALUES (?, ?, ?)',
      [id, qqId, now],
    );

    return Response.json({ id }, { status: 201 });
  }

  private getRoom(qqId: number, roomId: string): Response {
    const room = this.db.query<{
      id: string; name: string; group_id: number; creator_qq_id: number;
      scenario_name: string | null; constraints_json: string; status: string;
      kp_session_id: string | null; created_at: string;
    }, string>(
      'SELECT id, name, group_id, creator_qq_id, scenario_name, constraints_json, status, kp_session_id, created_at FROM campaign_rooms WHERE id = ?',
    ).get(roomId);

    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });

    const members = this.db.query<{
      qq_id: number; character_id: string | null; joined_at: string;
    }, string>(
      'SELECT qq_id, character_id, joined_at FROM campaign_room_members WHERE room_id = ? ORDER BY joined_at',
    ).all(roomId);

    // 获取每个成员的角色卡摘要
    const memberDetails = members.map((m) => {
      let character = null;
      if (m.character_id) {
        const char = this.db.query<{
          id: string; name: string; occupation: string | null; payload_json: string;
        }, string>(
          'SELECT id, name, occupation, payload_json FROM characters WHERE id = ?',
        ).get(m.character_id);
        if (char) {
          const payload = JSON.parse(char.payload_json);
          character = {
            id: char.id,
            name: char.name,
            occupation: char.occupation,
            hp: payload.derived?.hp ?? null,
            san: payload.derived?.san ?? null,
            attributes: payload.attributes ?? {},
          };
        }
      }
      return { qqId: m.qq_id, joinedAt: m.joined_at, character, isCreator: m.qq_id === room.creator_qq_id };
    });

    // PC 合规性检查（软验证）
    const constraints = JSON.parse(room.constraints_json) as RoomConstraints;
    const warnings = this.validateMembers(memberDetails, constraints);

    return Response.json({
      ...this.formatRoom(room, qqId),
      members: memberDetails,
      warnings,
    });
  }

  private deleteRoom(qqId: number, roomId: string): Response {
    const room = this.db.query<{
      creator_qq_id: number; status: string;
    }, string>(
      'SELECT creator_qq_id, status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);

    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.creator_qq_id !== qqId) return Response.json({ error: '只有创建者可以删除房间' }, { status: 403 });

    if (room.status === 'running') {
      return Response.json({
        error: '跑团正在进行中，确认删除请携带 { "force": true }',
        isRunning: true,
      }, { status: 409 });
    }

    this.db.run('DELETE FROM campaign_room_members WHERE room_id = ?', [roomId]);
    this.db.run('DELETE FROM campaign_rooms WHERE id = ?', [roomId]);
    return Response.json({ ok: true });
  }

  private async deleteRoomForce(qqId: number, roomId: string, req: Request): Promise<Response> {
    let body: Record<string, unknown> = {};
    try { body = await req.json() as Record<string, unknown>; } catch { /* ok */ }

    if (!body.force) return this.deleteRoom(qqId, roomId);

    const room = this.db.query<{ creator_qq_id: number; status: string }, string>(
      'SELECT creator_qq_id, status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.creator_qq_id !== qqId) return Response.json({ error: '只有创建者可以删除房间' }, { status: 403 });

    this.db.run('DELETE FROM campaign_room_members WHERE room_id = ?', [roomId]);
    this.db.run('DELETE FROM campaign_rooms WHERE id = ?', [roomId]);
    return Response.json({ ok: true });
  }

  private joinRoom(qqId: number, roomId: string): Response {
    const room = this.db.query<{ status: string }, string>(
      'SELECT status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.status === 'ended') return Response.json({ error: '该房间已结束' }, { status: 409 });

    const now = new Date().toISOString();
    this.db.run(
      'INSERT OR IGNORE INTO campaign_room_members (room_id, qq_id, joined_at) VALUES (?, ?, ?)',
      [roomId, qqId, now],
    );
    return Response.json({ ok: true });
  }

  private async setRoomCharacter(qqId: number, roomId: string, req: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const characterId = body.characterId as string | null;

    // 验证角色卡归属
    if (characterId) {
      const char = this.db.query<{ player_id: number }, string>(
        'SELECT player_id FROM characters WHERE id = ?',
      ).get(characterId);
      if (!char) return Response.json({ error: '角色卡不存在' }, { status: 404 });
      if (char.player_id !== qqId) return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const member = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!member) return Response.json({ error: '你不在该房间中，请先加入' }, { status: 403 });

    this.db.run(
      'UPDATE campaign_room_members SET character_id = ? WHERE room_id = ? AND qq_id = ?',
      [characterId ?? null, roomId, qqId],
    );
    return Response.json({ ok: true });
  }

  private async startRoom(qqId: number, roomId: string): Promise<Response> {
    if (!this.campaignHandler || !this.actionClient) {
      return Response.json({ error: '服务未配置，无法从 Web 开团' }, { status: 503 });
    }

    const room = this.db.query<{
      group_id: number; status: string; constraints_json: string;
    }, string>(
      'SELECT group_id, status, constraints_json FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.status !== 'waiting') {
      return Response.json({ error: '该房间已开始或已结束' }, { status: 409 });
    }

    const member = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!member) return Response.json({ error: '你不在该房间中' }, { status: 403 });

    const groupId = room.group_id;
    const now = new Date().toISOString();

    // 更新房间状态
    this.db.run(
      "UPDATE campaign_rooms SET status = 'running', updated_at = ? WHERE id = ?",
      [now, roomId],
    );

    // 发提示后异步开团
    this.actionClient.sendGroupMessage(groupId, '⏳ 守秘人正在准备，请稍候...').catch(() => {});

    this.campaignHandler.startSession(groupId).then(async (parts) => {
      for (const part of parts) {
        await this.actionClient!.sendGroupMessage(groupId, part);
        await new Promise<void>((r) => setTimeout(r, 800));
      }
    }).catch((err) => {
      console.error('[PlayerRoutes] Web 开团失败:', err);
      this.actionClient!.sendGroupMessage(groupId, `⚠️ 开团失败：${String(err)}`).catch(() => {});
      // 回滚房间状态
      this.db.run("UPDATE campaign_rooms SET status = 'waiting', updated_at = ? WHERE id = ?", [new Date().toISOString(), roomId]);
    });

    return Response.json({ ok: true, message: '开团指令已发送' });
  }

  private async updateConstraints(qqId: number, roomId: string, req: Request): Promise<Response> {
    const room = this.db.query<{ creator_qq_id: number; status: string }, string>(
      'SELECT creator_qq_id, status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.creator_qq_id !== qqId) return Response.json({ error: '只有创建者可以修改约束' }, { status: 403 });
    if (room.status !== 'waiting') return Response.json({ error: '跑团已开始，不可修改约束' }, { status: 409 });

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const now = new Date().toISOString();
    this.db.run(
      'UPDATE campaign_rooms SET scenario_name = ?, constraints_json = ?, updated_at = ? WHERE id = ?',
      [(body.scenarioName as string | null) ?? null, JSON.stringify(body.constraints ?? {}), now, roomId],
    );
    return Response.json({ ok: true });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private formatRoom(r: {
    id: string; name: string; group_id: number; creator_qq_id: number;
    scenario_name: string | null; constraints_json: string; status: string;
    kp_session_id: string | null; created_at: string;
  }, viewerQqId: number) {
    return {
      id: r.id,
      name: r.name,
      groupId: r.group_id,
      creatorQqId: r.creator_qq_id,
      isCreator: r.creator_qq_id === viewerQqId,
      scenarioName: r.scenario_name,
      constraints: JSON.parse(r.constraints_json) as RoomConstraints,
      status: r.status,
      kpSessionId: r.kp_session_id,
      createdAt: r.created_at,
    };
  }

  private getRoomMemberCount(roomId: string): number {
    const row = this.db.query<{ cnt: number }, string>(
      'SELECT COUNT(*) as cnt FROM campaign_room_members WHERE room_id = ?',
    ).get(roomId);
    return row?.cnt ?? 0;
  }

  private validateMembers(
    members: Array<{ qqId: number; character: { occupation: string | null; attributes: Record<string, number> } | null }>,
    constraints: RoomConstraints,
  ): string[] {
    const warnings: string[] = [];
    for (const m of members) {
      if (!m.character) {
        warnings.push(`QQ ${m.qqId} 尚未选择角色卡`);
        continue;
      }
      if (constraints.allowedOccupations?.length && m.character.occupation &&
          !constraints.allowedOccupations.includes(m.character.occupation)) {
        warnings.push(`QQ ${m.qqId} 的职业「${m.character.occupation}」不在模组允许范围内`);
      }
      if (constraints.minStats) {
        for (const [stat, minVal] of Object.entries(constraints.minStats)) {
          const actual = m.character.attributes[stat] ?? 0;
          if (actual < minVal) {
            warnings.push(`QQ ${m.qqId} 的 ${stat} (${actual}) 低于最低要求 (${minVal})`);
          }
        }
      }
    }
    return warnings;
  }

  private getActiveSessionCharacterIds(): Set<string> {
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

interface RoomConstraints {
  era?: string;
  allowedOccupations?: string[];
  minStats?: Record<string, number>;
}
