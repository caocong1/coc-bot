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
 * GET  /campaigns                   — 我参与的团列表（兼容旧入口）
 * GET  /campaigns/:id               — 团详情（玩家视角，兼容旧入口）
 * GET  /campaigns/:id/messages      — 团消息历史（只读，兼容旧入口）
 * GET  /campaigns/:id/redirect      — 将旧 campaign 记录解析到对应房间
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
import { deliverCampaignOutput } from '../runtime/CampaignOutputDelivery';
import { calculatePrimaryAttributeTotal, normalizeOptionalTotalPoints } from '@shared/coc7/attributeTotals';
import { summarizeModuleDescriptionForPlayers } from '@shared/scenario/moduleDescription';
import { sanitizePlayerReferenceData } from '@shared/reference/referenceDataSanitizer';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseExcelCharacter } from '../import/ExcelCharacterParser';
import {
  createRoomRelationship,
  deleteRoomRelationship,
  deleteRoomRelationshipsByCharacter,
  listRoomRelationships,
  updateRoomRelationship,
} from '../storage/RoomDirectorStore';

export class PlayerRoutes {
  constructor(
    private readonly db: Database,
    private readonly tokenStore: TokenStore,
    private readonly characterStore: CharacterStore,
    private readonly campaignHandler: CampaignHandler | null = null,
    private readonly actionClient: NapCatActionClient | null = null,
  ) {}

  async handle(req: Request, subPath: string): Promise<Response | null> {
    // 公开参考数据端点（无需认证）
    if (subPath.startsWith('/reference/') && req.method === 'GET') {
      return this.getReference(subPath.replace('/reference/', ''));
    }

    const auth = this.authenticate(req);
    if (auth === null) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { qqId, groupId: tokenGroupId } = auth;

    const method = req.method;
    const segments = subPath.replace(/^\//, '').split('/');
    const resource = segments[0];
    const resourceId = segments[1];
    const sub2 = segments[2];

    // GET /me
    if (resource === 'me' && method === 'GET') {
      return this.getMe(qqId, tokenGroupId);
    }

    // /characters
    if (resource === 'characters') {
      if (method === 'POST' && resourceId === 'import-excel') return this.importExcelCharacter(req);
      if (method === 'GET' && resourceId === 'template-excel') return this.downloadBlankCharacterExcel();
      if (method === 'GET' && !resourceId) return this.listCharacters(qqId);
      if (method === 'GET' && resourceId) return this.getCharacter(qqId, resourceId);
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
      if (method === 'GET' && resourceId && sub2 === 'redirect') {
        return this.getCampaignRedirect(qqId, resourceId);
      }
    }

    // /scenarios (旧) 和 /modules (新)
    if (resource === 'scenarios' && method === 'GET') return this.listScenarios();
    if (resource === 'modules' && method === 'GET') return this.listModules();

    // /rooms
    if (resource === 'rooms') {
      if (method === 'GET' && !resourceId) return this.listRooms(qqId);
      if (method === 'POST' && !resourceId) return this.createRoom(qqId, req, tokenGroupId);
      if (method === 'GET' && resourceId && !sub2) return this.getRoom(qqId, resourceId);
      if (method === 'DELETE' && resourceId && !sub2) return this.deleteRoomForce(qqId, resourceId, req);
      if (method === 'POST' && resourceId && sub2 === 'join') return this.joinRoom(qqId, resourceId);
      if (method === 'PUT' && resourceId && sub2 === 'character') return this.setRoomCharacter(qqId, resourceId, req);
      if (method === 'POST' && resourceId && sub2 === 'start') return this.startRoom(qqId, resourceId, req);
      if (method === 'POST' && resourceId && sub2 === 'ready') return this.readyRoom(qqId, resourceId);
      if (method === 'POST' && resourceId && sub2 === 'cancel-review') return this.cancelReview(qqId, resourceId);
      if (method === 'PATCH' && resourceId && sub2 === 'module') return this.updateRoomModule(qqId, resourceId, req);
      if (method === 'PATCH' && resourceId && sub2 === 'constraints') return this.updateConstraints(qqId, resourceId, req);
      if (method === 'GET' && resourceId && sub2 === 'relationships') return this.listRoomRelationships(qqId, resourceId);
      if (method === 'POST' && resourceId && sub2 === 'relationships') return this.createRoomRelationship(qqId, resourceId, req);
      if (method === 'PUT' && resourceId && sub2 === 'relationships' && segments[3]) {
        return this.updateRoomRelationship(qqId, resourceId, segments[3], req);
      }
      if (method === 'DELETE' && resourceId && sub2 === 'relationships' && segments[3]) {
        return this.deleteRoomRelationship(qqId, resourceId, segments[3]);
      }
      if (method === 'GET' && resourceId && sub2 === 'messages') return this.getRoomMessages(qqId, resourceId);
      if (method === 'GET' && resourceId && sub2 === 'time') return this.getRoomTime(qqId, resourceId);
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  private authenticate(req: Request): { qqId: number; groupId: number | null } | null {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length).trim();
    return this.tokenStore.verify(token);
  }

  // ─── Excel Import ─────────────────────────────────────────────────────────

  private async importExcelCharacter(req: Request): Promise<Response> {
    try {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return Response.json({ error: '未提供文件' }, { status: 400 });
      if (!file.name.endsWith('.xlsx')) {
        return Response.json({ error: '仅支持 .xlsx 格式' }, { status: 400 });
      }

      const buffer = await file.arrayBuffer();
      const result = parseExcelCharacter(buffer);
      return Response.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '解析失败';
      return Response.json({ error: msg }, { status: 400 });
    }
  }

  private downloadBlankCharacterExcel(): Response {
    const filename = '[充实车卡版本]空白卡.xlsx';
    const filePath = join(process.cwd(), filename);
    if (!existsSync(filePath)) {
      return Response.json({ error: '空白角色卡模板不存在' }, { status: 404 });
    }

    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  }

  // ─── Characters ────────────────────────────────────────────────────────────

  private getMe(qqId: number, groupId: number | null): Response {
    const chars = this.db.query<{ id: string }, number>(
      'SELECT id FROM characters WHERE player_id = ?',
    ).all(qqId);
    return Response.json({ qqId, groupId, characterCount: chars.length });
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
        era: typeof payload.era === 'string' ? payload.era : null,
        hp: payload.derived?.hp ?? null,
        san: payload.derived?.san ?? null,
        primaryAttributeTotal: payload.attributes ? calculatePrimaryAttributeTotal(payload.attributes) : null,
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

  private getCharacter(qqId: number, id: string): Response {
    const row = this.db.query<{
      id: string;
      player_id: number;
      name: string;
      occupation: string | null;
      age: number | null;
      payload_json: string;
      updated_at: string;
    }, string>(
      'SELECT id, player_id, name, occupation, age, payload_json, updated_at FROM characters WHERE id = ?',
    ).get(id);
    if (!row) return Response.json({ error: '角色卡不存在' }, { status: 404 });
    if (row.player_id !== qqId) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const activeIds = this.getActiveSessionCharacterIds();
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    return Response.json({
      id: row.id,
      name: row.name,
      occupation: row.occupation,
      age: row.age,
      updatedAt: row.updated_at,
      readonly: activeIds.has(row.id),
      ...payload,
    });
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

  private getCampaignRedirect(qqId: number, sessionId: string): Response {
    const membership = this.db.query<{ user_id: number }, [string, number]>(
      'SELECT user_id FROM kp_session_players WHERE session_id = ? AND user_id = ?',
    ).get(sessionId, qqId);
    if (!membership) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const linkedRoom = this.db.query<{ id: string }, string>(
      'SELECT id FROM campaign_rooms WHERE kp_session_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).get(sessionId);

    return Response.json({
      sessionId,
      roomId: linkedRoom?.id ?? null,
      archived: !linkedRoom,
    });
  }

  // ─── Scenarios / Modules ───────────────────────────────────────────────────

  private listScenarios(): Response {
    // 从 scenario_modules 表读取，兼容旧 /scenarios 端点
    return this.listModules();
  }

  private listModules(): Response {
    const modules = this.db.query<{
      id: string; name: string; description: string | null; era: string | null;
      allowed_occupations: string; total_points: number | null; created_at: string;
    }, []>(`
      SELECT m.id, m.name, m.description, m.era, m.allowed_occupations, m.total_points, m.created_at
      FROM scenario_modules m
      WHERE NOT EXISTS (
        SELECT 1
        FROM scenario_module_files f
        WHERE f.module_id = m.id
          AND f.file_type = 'document'
          AND f.import_status = 'pending'
      )
      ORDER BY m.created_at DESC
    `).all();

    return Response.json(modules.map((m) => ({
      id: m.id,
      name: m.name,
      description: summarizeModuleDescriptionForPlayers(m.description),
      era: m.era,
      allowedOccupations: JSON.parse(m.allowed_occupations) as string[],
      totalPoints: normalizeOptionalTotalPoints(m.total_points),
    })));
  }

  // ─── Rooms ─────────────────────────────────────────────────────────────────

  private listRooms(qqId: number): Response {
    // 返回：该玩家创建的 + 该玩家加入的
    const rooms = this.db.query<{
      id: string; name: string; group_id: number | null; creator_qq_id: number;
      module_id: string | null; scenario_name: string | null; constraints_json: string; status: string;
      kp_session_id: string | null; created_at: string; updated_at: string;
    }, [number, number]>(`
      SELECT DISTINCT r.id, r.name, r.group_id, r.creator_qq_id, r.module_id, r.scenario_name,
             r.constraints_json, r.status, r.kp_session_id, r.created_at, r.updated_at
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

  private async createRoom(qqId: number, req: Request, _tokenGroupId: number | null): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const name = (body.name as string)?.trim();
    if (!name) return Response.json({ error: '房间名不能为空' }, { status: 400 });

    const id = this.generateShortRoomId();
    const now = new Date().toISOString();

    // 若传入 moduleId，从模组自动读取 scenarioName 和约束
    let scenarioName = (body.scenarioName as string | null) ?? null;
    let constraints = normalizeRoomConstraints(body.constraints ?? {});
    const moduleId = (body.moduleId as string | null) ?? null;
    if (moduleId) {
      const mod = this.db.query<{
        name: string; allowed_occupations: string; total_points: number | null; era: string | null;
      }, string>('SELECT name, allowed_occupations, total_points, era FROM scenario_modules WHERE id = ?').get(moduleId);
      if (mod) {
        scenarioName = mod.name;
        constraints = {
          era: mod.era ?? undefined,
          allowedOccupations: JSON.parse(mod.allowed_occupations),
          totalPoints: normalizeOptionalTotalPoints(mod.total_points),
        };
      }
    }

    this.db.run(
      `INSERT INTO campaign_rooms (id, name, group_id, creator_qq_id, module_id, scenario_name, constraints_json, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'waiting', ?, ?)`,
      [id, name, qqId, moduleId,
        scenarioName,
        JSON.stringify(constraints),
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
      id: string; name: string; group_id: number | null; creator_qq_id: number;
      module_id: string | null; scenario_name: string | null; constraints_json: string; status: string;
      kp_session_id: string | null; created_at: string; updated_at: string;
    }, string>(
      'SELECT id, name, group_id, creator_qq_id, module_id, scenario_name, constraints_json, status, kp_session_id, created_at, updated_at FROM campaign_rooms WHERE id = ?',
    ).get(roomId);

    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });

    const members = this.db.query<{
      qq_id: number; character_id: string | null; ready_at: string | null; joined_at: string;
    }, string>(
      'SELECT qq_id, character_id, ready_at, joined_at FROM campaign_room_members WHERE room_id = ? ORDER BY joined_at',
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
      return { qqId: m.qq_id, joinedAt: m.joined_at, readyAt: m.ready_at, character, isCreator: m.qq_id === room.creator_qq_id };
    });

    // PC 合规性检查（软验证）
    const constraints = normalizeRoomConstraints(JSON.parse(room.constraints_json));
    const warnings = this.validateMembers(memberDetails, constraints);
    const relationships = listRoomRelationships(this.db, roomId);

    return Response.json({
      ...this.formatRoom(room, qqId),
      memberCount: members.length,
      members: memberDetails,
      relationships,
      warnings,
      runtime: this.getRoomRuntime(room.kp_session_id),
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

    this.deleteRoomRelationshipData(roomId);
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

    this.deleteRoomRelationshipData(roomId);
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

    const member = this.db.query<{ qq_id: number; character_id: string | null }, [string, number]>(
      'SELECT qq_id, character_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!member) return Response.json({ error: '你不在该房间中，请先加入' }, { status: 403 });

    const previousCharacterId = member.character_id;
    const tx = this.db.transaction(() => {
      this.db.run(
        'UPDATE campaign_room_members SET character_id = ? WHERE room_id = ? AND qq_id = ?',
        [characterId ?? null, roomId, qqId],
      );
      if (previousCharacterId && previousCharacterId !== characterId) {
        deleteRoomRelationshipsByCharacter(this.db, roomId, previousCharacterId);
      }
    });
    tx();
    return Response.json({ ok: true });
  }

  /** Web 端开始审卡（waiting → reviewing） */
  /** Web 端开始审卡（waiting → reviewing） */
  private async startRoom(qqId: number, roomId: string, _req: Request): Promise<Response> {
    const room = this.db.query<{
      status: string;
    }, string>('SELECT status FROM campaign_rooms WHERE id = ?').get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });

    // 检查成员身份
    const isMember = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!isMember) return Response.json({ error: '只有房间成员才能操作' }, { status: 403 });

    if (room.status === 'reviewing') return Response.json({ ok: true, status: 'reviewing', message: '已在审卡阶段' });
    if (room.status !== 'waiting') return Response.json({ error: '该房间已开始或已结束' }, { status: 409 });

    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'reviewing', updated_at = ? WHERE id = ?", [now, roomId]);
    // 重置所有成员 ready 状态
    this.db.run('UPDATE campaign_room_members SET ready_at = NULL WHERE room_id = ?', [roomId]);
    return Response.json({ ok: true, status: 'reviewing', message: '已进入审卡阶段' });
  }

  /** Web 端标记 ready */
  private readyRoom(qqId: number, roomId: string): Response {
    const room = this.db.query<{
      status: string; group_id: number | null;
    }, string>('SELECT status, group_id FROM campaign_rooms WHERE id = ?').get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.status !== 'reviewing') return Response.json({ error: '该房间不在审卡阶段' }, { status: 409 });

    const member = this.db.query<{ ready_at: string | null }, [string, number]>(
      'SELECT ready_at FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!member) return Response.json({ error: '你不在该房间中' }, { status: 403 });
    if (member.ready_at) return Response.json({ ok: true, message: '你已经准备就绪了' });

    const now = new Date().toISOString();
    this.db.run('UPDATE campaign_room_members SET ready_at = ? WHERE room_id = ? AND qq_id = ?', [now, roomId, qqId]);

    // 检查全员 ready
    const members = this.db.query<{ ready_at: string | null }, string>(
      'SELECT ready_at FROM campaign_room_members WHERE room_id = ?',
    ).all(roomId);
    const readyCount = members.filter((m) => m.ready_at !== null).length;
    const allReady = readyCount >= members.length;

    if (allReady && room.group_id && this.campaignHandler && this.actionClient) {
      // 自动开团
      const groupId = room.group_id;
      this.db.run("UPDATE campaign_rooms SET status = 'running', updated_at = ? WHERE id = ?", [now, roomId]);
      this.actionClient.sendGroupMessage(groupId, '✅ 全员就绪！守秘人正在准备，请稍候...').catch(() => {});

      this.campaignHandler.startSession(groupId, undefined, roomId).then(async (output) => {
        await deliverCampaignOutput(this.actionClient!, groupId, output);
      }).catch((err) => {
        console.error('[PlayerRoutes] Web 开团失败:', err);
        this.actionClient!.sendGroupMessage(groupId, `⚠️ 开团失败：${String(err)}`).catch(() => {});
        this.db.run("UPDATE campaign_rooms SET status = 'reviewing', updated_at = ? WHERE id = ?", [new Date().toISOString(), roomId]);
      });

      return Response.json({ ok: true, allReady: true, message: '全员就绪，开团中...' });
    }

    return Response.json({ ok: true, readyCount, total: members.length, allReady });
  }

  /** Web 端取消审卡（reviewing → waiting） */
  private cancelReview(qqId: number, roomId: string): Response {
    const room = this.db.query<{
      creator_qq_id: number; status: string;
    }, string>('SELECT creator_qq_id, status FROM campaign_rooms WHERE id = ?').get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.creator_qq_id !== qqId) return Response.json({ error: '只有房间创建者才能取消审卡' }, { status: 403 });
    if (room.status !== 'reviewing') return Response.json({ error: '该房间不在审卡阶段' }, { status: 409 });

    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'waiting', updated_at = ? WHERE id = ?", [now, roomId]);
    this.db.run('UPDATE campaign_room_members SET ready_at = NULL WHERE room_id = ?', [roomId]);
    return Response.json({ ok: true, message: '已取消审卡' });
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
      [(body.scenarioName as string | null) ?? null, JSON.stringify(normalizeRoomConstraints(body.constraints ?? {})), now, roomId],
    );
    return Response.json({ ok: true });
  }

  private async updateRoomModule(qqId: number, roomId: string, req: Request): Promise<Response> {
    const room = this.db.query<{ creator_qq_id: number; status: string }, string>(
      'SELECT creator_qq_id, status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.creator_qq_id !== qqId) return Response.json({ error: '只有创建者可以修改模组' }, { status: 403 });
    if (room.status !== 'waiting') return Response.json({ error: '跑团已开始，不可修改模组' }, { status: 409 });

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const rawModuleId = body.moduleId;
    const moduleId = typeof rawModuleId === 'string' && rawModuleId.trim() ? rawModuleId.trim() : null;
    const next = this.resolvePlayerRoomModuleDefaults(moduleId);
    if (moduleId && !next) {
      return Response.json({ error: '模组不存在或尚未对玩家可用' }, { status: 404 });
    }

    const now = new Date().toISOString();
    this.db.run(
      'UPDATE campaign_rooms SET module_id = ?, scenario_name = ?, constraints_json = ?, updated_at = ? WHERE id = ?',
      [moduleId, next?.scenarioName ?? null, JSON.stringify(next?.constraints ?? {}), now, roomId],
    );
    return Response.json({ ok: true });
  }

  private listRoomRelationships(qqId: number, roomId: string): Response {
    if (!this.isRoomMember(roomId, qqId)) {
      return Response.json({ error: '不是该房间成员' }, { status: 403 });
    }
    return Response.json(listRoomRelationships(this.db, roomId));
  }

  private async createRoomRelationship(qqId: number, roomId: string, req: Request): Promise<Response> {
    if (!this.isRoomMember(roomId, qqId)) {
      return Response.json({ error: '不是该房间成员' }, { status: 403 });
    }
    const editable = this.requireEditableRoomRelationships(roomId);
    if (editable) return editable;

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    return this.saveRoomRelationship(roomId, qqId, body, null);
  }

  private async updateRoomRelationship(qqId: number, roomId: string, relationId: string, req: Request): Promise<Response> {
    if (!this.isRoomMember(roomId, qqId)) {
      return Response.json({ error: '不是该房间成员' }, { status: 403 });
    }
    const editable = this.requireEditableRoomRelationships(roomId);
    if (editable) return editable;

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    return this.saveRoomRelationship(roomId, qqId, body, relationId);
  }

  private deleteRoomRelationship(qqId: number, roomId: string, relationId: string): Response {
    if (!this.isRoomMember(roomId, qqId)) {
      return Response.json({ error: '不是该房间成员' }, { status: 403 });
    }
    const editable = this.requireEditableRoomRelationships(roomId);
    if (editable) return editable;

    const relation = listRoomRelationships(this.db, roomId).find((item) => item.id === relationId);
    if (!relation) {
      return Response.json({ error: '人物关系不存在' }, { status: 404 });
    }

    deleteRoomRelationship(this.db, roomId, relationId);
    return Response.json({ ok: true });
  }

  // ─── Room Messages ─────────────────────────────────────────────────────────

  private getRoomMessages(qqId: number, roomId: string): Response {
    // 验证是房间成员
    const member = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!member) return Response.json({ error: '不是该房间成员' }, { status: 403 });

    // 找 session
    const room = this.db.query<{ kp_session_id: string | null }, string>(
      'SELECT kp_session_id FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room?.kp_session_id) return Response.json([]);

    const messages = this.db.query<{
      id: string; role: string; display_name: string | null; content: string; timestamp: string;
    }, string>(
      'SELECT id, role, display_name, content, timestamp FROM kp_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 200',
    ).all(room.kp_session_id).reverse();

    return Response.json(messages.map((m) => ({
      id: m.id,
      role: m.role,
      displayName: m.display_name,
      content: m.content,
      timestamp: m.timestamp,
    })));
  }

  // ─── Room Time ─────────────────────────────────────────────────────────────

  private getRoomTime(qqId: number, roomId: string): Response {
    const member = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    if (!member) return Response.json({ error: '不是该房间成员' }, { status: 403 });

    const room = this.db.query<{ kp_session_id: string | null }, string>(
      'SELECT kp_session_id FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room?.kp_session_id) return Response.json({ ingameTime: null });

    const session = this.db.query<{ ingame_time: string | null }, string>(
      'SELECT ingame_time FROM kp_sessions WHERE id = ?',
    ).get(room.kp_session_id);

    return Response.json({ ingameTime: session?.ingame_time ?? null });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private static readonly SHORT_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  private generateShortRoomId(): string {
    const chars = PlayerRoutes.SHORT_ID_CHARS;
    for (let attempt = 0; attempt < 20; attempt++) {
      let id = '';
      for (let i = 0; i < 4; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
      const exists = this.db.query<{ id: string }, string>(
        'SELECT id FROM campaign_rooms WHERE id = ?',
      ).get(id);
      if (!exists) return id;
    }
    // fallback: 6 位
    const chars2 = PlayerRoutes.SHORT_ID_CHARS;
    let id = '';
    for (let i = 0; i < 6; i++) id += chars2[Math.floor(Math.random() * chars2.length)];
    return id;
  }

  private formatRoom(r: {
    id: string; name: string; group_id: number | null; creator_qq_id: number;
    module_id: string | null; scenario_name: string | null; constraints_json: string; status: string;
    kp_session_id: string | null; created_at: string; updated_at?: string;
  }, viewerQqId: number) {
    return {
      id: r.id,
      name: r.name,
      groupId: r.group_id,
      creatorQqId: r.creator_qq_id,
      isCreator: r.creator_qq_id === viewerQqId,
      moduleId: r.module_id,
      scenarioName: r.scenario_name,
      constraints: normalizeRoomConstraints(JSON.parse(r.constraints_json)),
      status: r.status,
      kpSessionId: r.kp_session_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
    };
  }

  private getRoomRuntime(sessionId: string | null) {
    if (!sessionId) return null;

    const session = this.db.query<{
      id: string;
      group_id: number;
      status: string;
      started_at: string;
      ingame_time: string | null;
    }, string>(
      'SELECT id, group_id, status, started_at, ingame_time FROM kp_sessions WHERE id = ?',
    ).get(sessionId);
    if (!session) return null;

    const messageCount = this.db.query<{ cnt: number }, string>(
      'SELECT COUNT(*) as cnt FROM kp_messages WHERE session_id = ?',
    ).get(sessionId)?.cnt ?? 0;
    const segmentCount = this.db.query<{ cnt: number }, string>(
      'SELECT COUNT(*) as cnt FROM kp_scene_segments WHERE session_id = ?',
    ).get(sessionId)?.cnt ?? 0;

    return {
      sessionId: session.id,
      groupId: session.group_id,
      status: session.status,
      ingameTime: session.ingame_time,
      messageCount,
      segmentCount,
      startedAt: session.started_at,
    };
  }

  private getRoomMemberCount(roomId: string): number {
    const row = this.db.query<{ cnt: number }, string>(
      'SELECT COUNT(*) as cnt FROM campaign_room_members WHERE room_id = ?',
    ).get(roomId);
    return row?.cnt ?? 0;
  }

  private resolvePlayerRoomModuleDefaults(moduleId: string | null): { scenarioName: string; constraints: RoomConstraints } | null {
    if (!moduleId) return null;
    const module = this.db.query<{
      name: string;
      era: string | null;
      allowed_occupations: string;
      total_points: number | null;
    }, string>(`
      SELECT m.name, m.era, m.allowed_occupations, m.total_points
      FROM scenario_modules m
      WHERE m.id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM scenario_module_files f
          WHERE f.module_id = m.id
            AND f.file_type = 'document'
            AND f.import_status = 'pending'
        )
    `).get(moduleId);
    if (!module) return null;
    return {
      scenarioName: module.name,
      constraints: {
        era: module.era ?? undefined,
        allowedOccupations: JSON.parse(module.allowed_occupations) as string[],
        totalPoints: normalizeOptionalTotalPoints(module.total_points),
      },
    };
  }

  private deleteRoomRelationshipData(roomId: string): void {
    this.db.run(
      'DELETE FROM campaign_room_relation_participants WHERE relation_id IN (SELECT id FROM campaign_room_relation_groups WHERE room_id = ?)',
      [roomId],
    );
    this.db.run('DELETE FROM campaign_room_relation_groups WHERE room_id = ?', [roomId]);
    this.db.run('DELETE FROM campaign_room_relationships WHERE room_id = ?', [roomId]);
  }

  private requireEditableRoomRelationships(roomId: string): Response | null {
    const room = this.db.query<{ status: string }, [string]>(
      'SELECT status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return Response.json({ error: '房间不存在' }, { status: 404 });
    if (room.status !== 'waiting' && room.status !== 'reviewing') {
      return Response.json({ error: '跑团开始后人物关系只读' }, { status: 409 });
    }
    return null;
  }

  private saveRoomRelationship(
    roomId: string,
    qqId: number,
    body: Record<string, unknown>,
    relationId: string | null,
  ): Response {
    const participantCharacterIds = Array.isArray(body.participantCharacterIds)
      ? body.participantCharacterIds.map((value) => String(value))
      : [];
    const relationLabel = typeof body.relationLabel === 'string' ? body.relationLabel : '';
    const notes = typeof body.notes === 'string' ? body.notes : '';

    try {
      const relation = relationId
        ? updateRoomRelationship(this.db, roomId, relationId, {
          participantCharacterIds,
          relationLabel,
          notes,
          createdByQqId: qqId,
        })
        : createRoomRelationship(this.db, roomId, {
          participantCharacterIds,
          relationLabel,
          notes,
          createdByQqId: qqId,
        });
      return Response.json(relation);
    } catch (error) {
      const message = error instanceof Error ? error.message : '人物关系保存失败';
      return Response.json({ error: message }, { status: message.includes('不存在') ? 404 : 400 });
    }
  }

  private isRoomMember(roomId: string, qqId: number): boolean {
    const row = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, qqId);
    return Boolean(row);
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
      if (constraints.totalPoints != null) {
        const actual = calculatePrimaryAttributeTotal(m.character.attributes);
        if (actual !== constraints.totalPoints) {
          warnings.push(`QQ ${m.qqId} 的主属性总点为 ${actual}，不等于房间要求 ${constraints.totalPoints}`);
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

  // ─── Reference Data ────────────────────────────────────────────────────────

  private static readonly REFERENCE_FILES: Record<string, string> = {
    weapons: 'weapons.json',
    armor: 'armor.json',
    vehicles: 'vehicles.json',
    insanity: 'insanity-symptoms.json',
    phobias: 'phobias.json',
    manias: 'manias.json',
    attributes: 'attribute-descriptions.json',
    'branch-skills': 'branch-skills.json',
    occupations: 'occupations.json',
  };

  private getReference(key: string): Response {
    const filename = PlayerRoutes.REFERENCE_FILES[key];
    if (!filename) return Response.json({ error: 'Unknown reference' }, { status: 404 });
    const filePath = join(process.cwd(), 'data', 'reference', filename);
    if (!existsSync(filePath)) return Response.json({ error: 'Reference data not available' }, { status: 404 });
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return Response.json(sanitizePlayerReferenceData(key, data));
  }
}

interface RoomConstraints {
  era?: string;
  allowedOccupations?: string[];
  totalPoints?: number | null;
}

function normalizeRoomConstraints(input: unknown): RoomConstraints {
  if (!input || typeof input !== 'object') return {};
  const raw = input as Record<string, unknown>;
  return {
    era: typeof raw.era === 'string' && raw.era.trim() ? raw.era : undefined,
    allowedOccupations: Array.isArray(raw.allowedOccupations)
      ? raw.allowedOccupations.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : undefined,
    totalPoints: normalizeOptionalTotalPoints(raw.totalPoints),
  };
}
