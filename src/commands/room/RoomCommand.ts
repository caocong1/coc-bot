/**
 * .room 指令
 *
 * .room list              — 我参与的活跃房间
 * .room create <名称> [模组序号] — 创建房间（返回房间ID）
 * .room join <roomId>     — 加入房间，私发 Web 链接
 * .room start <roomId>    — 审卡（查看 PC 信息 + 约束检查，任何成员可触发）
 * .room ready             — 确认准备就绪（当前群正在审卡的房间）
 * .room status            — 查看审卡进度（谁 ready 了）
 * .room cancel <roomId>   — 取消审卡，回到等待状态（创建者）
 * .room info <roomId>     — 查看房间详情
 */

import type { Database } from 'bun:sqlite';
import type { CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { TokenStore } from '../../storage/TokenStore';
import type { CampaignHandler } from '../../runtime/CampaignHandler';
import type { NapCatActionClient } from '../../adapters/napcat/NapCatActionClient';
import { ModCommand } from '../module/ModCommand';

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:5173';
const SHORT_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 I/O/0/1 避免混淆
const REVIEW_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟审卡超时

function generateShortId(): string {
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += SHORT_ID_CHARS[Math.floor(Math.random() * SHORT_ID_CHARS.length)];
  }
  return id;
}

export class RoomCommand {
  readonly name = 'room';
  readonly aliases: string[] = [];
  readonly description = '跑团房间管理（创建/加入/开始）';

  private modCommand: ModCommand;
  /** roomId → timeout handle，审卡超时自动取消 */
  private reviewTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    private readonly db: Database,
    private readonly tokenStore: TokenStore,
    private readonly campaignHandler: CampaignHandler | null = null,
    private readonly actionClient: NapCatActionClient | null = null,
  ) {
    this.modCommand = new ModCommand(db);
  }

  async handle(ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const sub = (cmd.args[0] ?? '').toLowerCase();
    switch (sub) {
      case 'create':  return this.create(ctx, cmd);
      case 'join':    return this.join(ctx, cmd);
      case 'start':   return this.start(ctx, cmd);
      case 'ready':   return this.ready(ctx);
      case 'status':  return this.status(ctx);
      case 'cancel':  return this.cancel(ctx, cmd);
      case 'pause':   return this.pause(ctx);
      case 'resume':  return this.resume(ctx);
      case 'stop':    return this.stop(ctx);
      case 'list':    return this.list(ctx);
      case 'info':    return this.info(cmd);
      default:        return this.help();
    }
  }

  // ─── 生成唯一短 ID ─────────────────────────────────────────────────────────

  private generateUniqueId(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = generateShortId();
      const exists = this.db.query<{ id: string }, string>(
        'SELECT id FROM campaign_rooms WHERE id = ?',
      ).get(id);
      if (!exists) return id;
    }
    // fallback: 6 位
    return generateShortId() + generateShortId().slice(0, 2);
  }

  // ─── 审卡相关 ────────────────────────────────────────────────────────────────

  /** 查找当前群正在审卡的房间 */
  private findReviewingRoom(groupId: number): { id: string; name: string; creator_qq_id: number } | null {
    return this.db.query<{ id: string; name: string; creator_qq_id: number }, number>(
      "SELECT id, name, creator_qq_id FROM campaign_rooms WHERE group_id = ? AND status = 'reviewing' LIMIT 1",
    ).get(groupId) ?? null;
  }

  /** 构建审卡摘要：成员 PC 信息 + ready 状态 + 约束违规警告 */
  private buildReviewSummary(roomId: string, roomName: string): string {
    // 查询房间约束
    const roomRow = this.db.query<{ constraints_json: string }, string>(
      'SELECT constraints_json FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    const constraints = roomRow ? JSON.parse(roomRow.constraints_json) as {
      era?: string; allowedOccupations?: string[]; minStats?: Record<string, number>;
    } : {};

    // 查询成员 + 角色卡 + ready 状态
    const members = this.db.query<{ qq_id: number; character_id: string | null; ready_at: string | null }, string>(
      'SELECT qq_id, character_id, ready_at FROM campaign_room_members WHERE room_id = ? ORDER BY joined_at',
    ).all(roomId);

    const lines: string[] = [`📋 审卡 — 房间「${roomName}」`, ''];
    const warnings: string[] = [];
    let readyCount = 0;

    for (const m of members) {
      const readyMark = m.ready_at ? '✅' : '⏳';
      if (m.ready_at) readyCount++;

      let charInfo: { name: string; occupation: string | null; payload_json: string } | null = null;
      if (m.character_id) {
        charInfo = this.db.query<{ name: string; occupation: string | null; payload_json: string }, string>(
          'SELECT name, occupation, payload_json FROM characters WHERE id = ?',
        ).get(m.character_id) ?? null;
      }
      // fallback: 玩家的全局激活角色卡
      if (!charInfo) {
        charInfo = this.db.query<{ name: string; occupation: string | null; payload_json: string }, string>(
          `SELECT c.name, c.occupation, c.payload_json FROM characters c
           JOIN active_cards a ON a.character_id = c.id
           WHERE a.binding_key = ?`,
        ).get(`player:${m.qq_id}`) ?? null;
      }

      if (!charInfo) {
        lines.push(`  ${readyMark} QQ ${m.qq_id}: ⚠️ 未选择角色卡`);
        warnings.push(`QQ ${m.qq_id} 尚未选择角色卡`);
        continue;
      }

      // 解析属性
      const payload = JSON.parse(charInfo.payload_json) as {
        attributes?: Record<string, number>;
        derived?: Record<string, number>;
      };
      const attrs = payload.attributes ?? {};
      const derived = payload.derived ?? {};
      const statParts = ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU']
        .filter((k) => attrs[k] !== undefined)
        .map((k) => `${k}:${attrs[k]}`);
      const hp = derived.HP !== undefined ? ` HP:${derived.HP}` : '';
      const san = derived.SAN !== undefined ? ` SAN:${derived.SAN}` : '';

      lines.push(`  ${readyMark} QQ ${m.qq_id}: ${charInfo.name}（${charInfo.occupation ?? '未知职业'}）`);
      lines.push(`     ${statParts.join(' ')}${hp}${san}`);

      // 约束检查
      if (constraints.allowedOccupations?.length && charInfo.occupation) {
        if (!constraints.allowedOccupations.includes(charInfo.occupation)) {
          warnings.push(`QQ ${m.qq_id} 的职业「${charInfo.occupation}」不在模组允许范围内`);
        }
      }
      if (constraints.minStats) {
        for (const [stat, minVal] of Object.entries(constraints.minStats)) {
          const actual = attrs[stat] ?? 0;
          if (actual < minVal) {
            warnings.push(`QQ ${m.qq_id} 的 ${stat}(${actual}) 低于最低要求(${minVal})`);
          }
        }
      }
    }

    if (warnings.length > 0) {
      lines.push('', '⚠️ 约束警告：');
      for (const w of warnings) lines.push(`  - ${w}`);
    }

    lines.push('', `准备进度：${readyCount}/${members.length}`);
    lines.push(`所有成员发送 .room ready 确认准备，全员就绪后自动开团`);
    lines.push(`查看进度：.room status ｜ 取消：.room cancel ${roomId}`);
    return lines.join('\n');
  }

  /** 检查是否全员 ready，如果是则自动开团 */
  private checkAndAutoStart(roomId: string, groupId: number): void {
    const members = this.db.query<{ ready_at: string | null }, string>(
      'SELECT ready_at FROM campaign_room_members WHERE room_id = ?',
    ).all(roomId);
    const allReady = members.length > 0 && members.every((m) => m.ready_at !== null);
    if (!allReady) return;

    // 全员 ready → 自动开团
    this.clearReviewTimer(roomId);
    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'running', updated_at = ? WHERE id = ?", [now, roomId]);

    if (!this.campaignHandler || !this.actionClient) return;

    this.actionClient.sendGroupMessage(groupId, '✅ 全员就绪！守秘人正在准备，请稍候...').catch(() => {});

    this.campaignHandler.startSession(groupId, undefined, roomId).then(async (parts) => {
      for (const part of parts) {
        await this.actionClient!.sendGroupMessage(groupId, part);
        await new Promise<void>((r) => setTimeout(r, 800));
      }
    }).catch((err) => {
      console.error('[RoomCommand] 开团失败:', err);
      this.actionClient!.sendGroupMessage(groupId, `⚠️ 开团失败：${String(err)}`).catch(() => {});
      // 失败回滚到 reviewing
      this.db.run("UPDATE campaign_rooms SET status = 'reviewing', updated_at = ? WHERE id = ?", [new Date().toISOString(), roomId]);
    });
  }

  /** 设置审卡超时定时器 */
  private setReviewTimer(roomId: string, groupId: number): void {
    this.clearReviewTimer(roomId);
    const timer = setTimeout(() => {
      this.reviewTimers.delete(roomId);
      // 检查房间是否还在 reviewing
      const room = this.db.query<{ status: string; name: string }, string>(
        'SELECT status, name FROM campaign_rooms WHERE id = ?',
      ).get(roomId);
      if (!room || room.status !== 'reviewing') return;

      // 超时取消
      const now = new Date().toISOString();
      this.db.run("UPDATE campaign_rooms SET status = 'waiting', updated_at = ? WHERE id = ?", [now, roomId]);
      this.resetReadyStatus(roomId);
      this.actionClient?.sendGroupMessage(groupId, `⏰ 房间「${room.name}」审卡超时（10分钟），已自动取消。重新开始请发 .room start ${roomId}`).catch(() => {});
    }, REVIEW_TIMEOUT_MS);
    this.reviewTimers.set(roomId, timer);
  }

  private clearReviewTimer(roomId: string): void {
    const timer = this.reviewTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.reviewTimers.delete(roomId);
    }
  }

  /** 重置房间所有成员的 ready 状态 */
  private resetReadyStatus(roomId: string): void {
    this.db.run('UPDATE campaign_room_members SET ready_at = NULL WHERE room_id = ?', [roomId]);
  }

  // ─── 子命令 ────────────────────────────────────────────────────────────────

  private create(ctx: CommandContext, cmd: ParsedCommand): CommandResult {
    // .room create <名称> [模组序号]
    const rawArgs = cmd.args.slice(1);
    if (rawArgs.length === 0) {
      return { text: '用法：.room create <房间名称> [模组序号]\n示例：.room create 与苏珊共进晚餐\n      .room create 与苏珊共进晚餐 1' };
    }

    // 判断最后一个参数是否是模组序号（纯数字）
    let name: string;
    let moduleId: string | null = null;
    const last = rawArgs[rawArgs.length - 1];
    const modIndex = /^\d+$/.test(last) ? parseInt(last, 10) : NaN;

    let mod: { id: string; name: string } | null = null;
    if (!isNaN(modIndex)) {
      const found = this.modCommand.getModuleByIndex(modIndex);
      if (found) mod = { id: found.id, name: found.name };
    }

    if (mod) {
      name = rawArgs.slice(0, -1).join(' ').trim() || mod.name;
      moduleId = mod.id;
    } else {
      name = rawArgs.join(' ').trim();
    }

    if (!name) return { text: '房间名称不能为空' };

    // 读取模组约束
    let scenarioName: string | null = null;
    let constraintsJson = '{}';
    if (moduleId) {
      const modDetail = this.db.query<{
        name: string; allowed_occupations: string; min_stats: string; era: string | null;
      }, string>('SELECT name, allowed_occupations, min_stats, era FROM scenario_modules WHERE id = ?').get(moduleId);
      if (modDetail) {
        scenarioName = modDetail.name;
        constraintsJson = JSON.stringify({
          era: modDetail.era ?? undefined,
          allowedOccupations: JSON.parse(modDetail.allowed_occupations),
          minStats: JSON.parse(modDetail.min_stats),
        });
      }
    }

    const id = this.generateUniqueId();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO campaign_rooms (id, name, group_id, creator_qq_id, module_id, scenario_name, constraints_json, status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'waiting', ?, ?)`,
      [id, name, ctx.userId, moduleId, scenarioName, constraintsJson, now, now],
    );
    // 创建者自动加入
    this.db.run(
      'INSERT OR IGNORE INTO campaign_room_members (room_id, qq_id, joined_at) VALUES (?, ?, ?)',
      [id, ctx.userId, now],
    );

    const modLine = scenarioName ? `\n模组：${scenarioName}` : '';
    return {
      text:
        `🎭 房间「${name}」已创建！${modLine}\n` +
        `房间ID：${id}\n\n` +
        `邀请队友：.room join ${id}\n` +
        `开始跑团：.room start ${id}（在目标群内发送）`,
    };
  }

  private join(ctx: CommandContext, cmd: ParsedCommand): CommandResult {
    const roomId = cmd.args[1]?.trim();
    if (!roomId) return { text: '用法：.room join <房间ID>' };

    const room = this.db.query<{ id: string; name: string; status: string }, string>(
      'SELECT id, name, status FROM campaign_rooms WHERE id = ?',
    ).get(roomId);
    if (!room) return { text: `找不到房间「${roomId}」，请确认 ID 是否正确` };
    if (room.status === 'ended') return { text: '该房间已结束，无法加入' };

    const now = new Date().toISOString();
    this.db.run(
      'INSERT OR IGNORE INTO campaign_room_members (room_id, qq_id, joined_at) VALUES (?, ?, ?)',
      [roomId, ctx.userId, now],
    );

    const token = this.tokenStore.generate(ctx.userId);
    const url = `${WEB_BASE_URL}/player/rooms?id=${roomId}&token=${token}`;

    return {
      text: `🔗 房间「${room.name}」加入链接（24小时有效）：\n${url}\n\n点击链接选择你的调查员角色卡，准备就绪后等待 KP 开团。`,
      private: true,
      publicHint: ctx.messageType === 'group' ? `✅ @${ctx.userId} 房间链接已私发，请查收。` : undefined,
    };
  }

  private start(ctx: CommandContext, cmd: ParsedCommand): CommandResult {
    if (ctx.messageType !== 'group' || !ctx.groupId) {
      return { text: '请在目标 QQ 群内发送 .room start <房间ID>，开团消息将发送到该群' };
    }

    const roomId = cmd.args[1]?.trim();
    if (!roomId) return { text: '用法：.room start <房间ID>' };

    const room = this.db.query<{
      id: string; name: string; status: string; creator_qq_id: number;
    }, string>('SELECT id, name, status, creator_qq_id FROM campaign_rooms WHERE id = ?').get(roomId);
    if (!room) return { text: `找不到房间「${roomId}」` };
    if (room.status === 'reviewing') return { text: `该房间正在审卡中，发送 .room ready 确认准备，或 .room status 查看进度` };
    if (room.status !== 'waiting') return { text: '该房间已开始或已结束' };

    // 任何房间成员都可以触发 start
    const isMember = this.db.query<{ qq_id: number }, [string, number]>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(roomId, ctx.userId);
    if (!isMember) return { text: '只有房间成员才能开始审卡' };

    // 检查该群是否有暂停/进行中的跑团
    const existingSession = this.db.query<{ id: string }, [number]>(
      "SELECT id FROM kp_sessions WHERE group_id = ? AND status IN ('paused', 'running') LIMIT 1",
    ).get(ctx.groupId);
    if (existingSession) {
      return {
        text: '⚠️ 该群有暂停中的跑团记录。\n' +
          '• 使用 .room resume 继续上次跑团\n' +
          '• 使用 .room stop 彻底结束后再开新团',
      };
    }

    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'reviewing', group_id = ?, updated_at = ? WHERE id = ?", [ctx.groupId, now, roomId]);
    this.resetReadyStatus(roomId);
    this.setReviewTimer(roomId, ctx.groupId);

    return { text: this.buildReviewSummary(roomId, room.name) };
  }

  private ready(ctx: CommandContext): CommandResult {
    if (ctx.messageType !== 'group' || !ctx.groupId) {
      return { text: '请在跑团群内发送 .room ready' };
    }

    const room = this.findReviewingRoom(ctx.groupId);
    if (!room) return { text: '当前群没有正在审卡的房间' };

    // 确认是房间成员
    const member = this.db.query<{ ready_at: string | null }, [string, number]>(
      'SELECT ready_at FROM campaign_room_members WHERE room_id = ? AND qq_id = ?',
    ).get(room.id, ctx.userId);
    if (!member) return { text: '你不在该房间中，请先 .room join ' + room.id };
    if (member.ready_at) return { text: '你已经准备就绪了' };

    const now = new Date().toISOString();
    this.db.run('UPDATE campaign_room_members SET ready_at = ? WHERE room_id = ? AND qq_id = ?', [now, room.id, ctx.userId]);

    // 统计进度
    const members = this.db.query<{ qq_id: number; ready_at: string | null }, string>(
      'SELECT qq_id, ready_at FROM campaign_room_members WHERE room_id = ?',
    ).all(room.id);
    const readyCount = members.filter((m) => m.ready_at !== null || m.qq_id === ctx.userId).length;

    // 检查是否全员 ready → 自动开团
    if (readyCount >= members.length) {
      this.checkAndAutoStart(room.id, ctx.groupId);
      return { text: '' }; // checkAndAutoStart 会发群消息
    }

    return { text: `✅ QQ ${ctx.userId} 已准备就绪（${readyCount}/${members.length}）` };
  }

  private status(ctx: CommandContext): CommandResult {
    if (ctx.messageType !== 'group' || !ctx.groupId) {
      return { text: '请在跑团群内发送 .room status' };
    }

    const room = this.findReviewingRoom(ctx.groupId);
    if (!room) return { text: '当前群没有正在审卡的房间' };

    return { text: this.buildReviewSummary(room.id, room.name) };
  }

  private cancel(ctx: CommandContext, cmd: ParsedCommand): CommandResult {
    const roomId = cmd.args[1]?.trim();
    if (!roomId) return { text: '用法：.room cancel <房间ID>' };

    const room = this.db.query<{
      id: string; name: string; status: string; creator_qq_id: number;
    }, string>('SELECT id, name, status, creator_qq_id FROM campaign_rooms WHERE id = ?').get(roomId);
    if (!room) return { text: `找不到房间「${roomId}」` };
    if (room.creator_qq_id !== ctx.userId) return { text: '只有房间创建者才能取消审卡' };
    if (room.status !== 'reviewing') return { text: '该房间不在审卡阶段' };

    this.clearReviewTimer(roomId);
    const now = new Date().toISOString();
    this.db.run("UPDATE campaign_rooms SET status = 'waiting', updated_at = ? WHERE id = ?", [now, roomId]);
    this.resetReadyStatus(roomId);
    return { text: `已取消审卡，房间「${room.name}」回到等待状态。` };
  }

  private pause(ctx: CommandContext): CommandResult {
    if (ctx.messageType !== 'group' || !ctx.groupId) {
      return { text: '请在跑团群内发送 .room pause' };
    }
    if (!this.campaignHandler) return { text: '⚠️ AI KP 服务未配置' };
    const reply = this.campaignHandler.pauseSession(ctx.groupId);
    return { text: reply };
  }

  private resume(ctx: CommandContext): CommandResult {
    if (ctx.messageType !== 'group' || !ctx.groupId) {
      return { text: '请在跑团群内发送 .room resume' };
    }
    if (!this.campaignHandler || !this.actionClient) return { text: '⚠️ AI KP 服务未配置' };
    const groupId = ctx.groupId;

    // 异步执行，立即返回提示
    this.campaignHandler.resumeSession(groupId).then(async (parts) => {
      for (const part of parts) {
        await this.actionClient!.sendGroupMessage(groupId, part);
        await new Promise<void>((r) => setTimeout(r, 800));
      }
    }).catch((err) => {
      console.error('[RoomCommand] 继续跑团失败:', err);
      this.actionClient!.sendGroupMessage(groupId, `⚠️ 继续跑团失败：${String(err)}`).catch(() => {});
    });

    return { text: '⏳ 守秘人正在回忆上次的冒险，请稍候...' };
  }

  private stop(ctx: CommandContext): CommandResult {
    if (ctx.messageType !== 'group' || !ctx.groupId) {
      return { text: '请在跑团群内发送 .room stop' };
    }
    if (!this.campaignHandler) return { text: '⚠️ AI KP 服务未配置' };
    const reply = this.campaignHandler.stopSession(ctx.groupId);
    return { text: reply };
  }

  private list(ctx: CommandContext): CommandResult {
    const rows = this.db.query<{
      id: string; name: string; status: string; scenario_name: string | null; member_count: number;
    }, number>(`
      SELECT r.id, r.name, r.status, r.scenario_name,
             (SELECT COUNT(*) FROM campaign_room_members WHERE room_id = r.id) as member_count
      FROM campaign_rooms r
      JOIN campaign_room_members m ON m.room_id = r.id AND m.qq_id = ?
      WHERE r.status IN ('waiting', 'reviewing', 'running')
      ORDER BY r.created_at DESC
      LIMIT 10
    `).all(ctx.userId);

    if (rows.length === 0) {
      return { text: '你还没有参与任何活跃的跑团房间。\n发送 .room create <名称> 创建一个，或让 KP 给你发 .room join <ID>。' };
    }

    const STATUS: Record<string, string> = { waiting: '⏳ 等待中', reviewing: '📋 审卡中', running: '🟢 进行中' };
    const lines = rows.map((r) =>
      `${STATUS[r.status] ?? r.status} 【${r.id}】${r.name} (${r.member_count}人)`,
    );
    return { text: '你参与的活跃房间：\n' + lines.join('\n') + '\n\n加入房间：.room join <ID>   开始跑团：.room start <ID>' };
  }

  private info(cmd: ParsedCommand): CommandResult {
    const roomId = cmd.args[1]?.trim();
    if (!roomId) return { text: '用法：.room info <房间ID>' };

    const room = this.db.query<{
      id: string; name: string; status: string; scenario_name: string | null; creator_qq_id: number;
    }, string>('SELECT id, name, status, scenario_name, creator_qq_id FROM campaign_rooms WHERE id = ?').get(roomId);
    if (!room) return { text: `找不到房间「${roomId}」` };

    const members = this.db.query<{ qq_id: number }, string>(
      'SELECT qq_id FROM campaign_room_members WHERE room_id = ? ORDER BY joined_at',
    ).all(roomId);

    const STATUS: Record<string, string> = { waiting: '⏳ 等待中', reviewing: '📋 审卡中', running: '🟢 进行中', ended: '⚫ 已结束' };
    const memberList = members.map((m) => (m.qq_id === room.creator_qq_id ? `${m.qq_id}(创建者)` : String(m.qq_id))).join('、');
    return {
      text:
        `🎭 房间「${room.name}」\n` +
        `状态：${STATUS[room.status] ?? room.status}\n` +
        (room.scenario_name ? `模组：${room.scenario_name}\n` : '') +
        `ID：${room.id}\n` +
        `成员（${members.length}）：${memberList || '（无）'}`,
    };
  }

  private help(): CommandResult {
    return {
      text:
        '🎭 跑团房间指令：\n' +
        '  .room list              — 我参与的活跃房间\n' +
        '  .room create <名称> [模组序号] — 创建房间\n' +
        '  .room join <房间ID>     — 加入房间（私发链接）\n' +
        '  .room start <房间ID>    — 审卡（查看 PC 信息）\n' +
        '  .room ready             — 确认准备就绪\n' +
        '  .room status            — 查看审卡进度\n' +
        '  .room cancel <房间ID>   — 取消审卡\n' +
        '  .room pause             — 暂停当前群的跑团\n' +
        '  .room resume            — 继续当前群的跑团\n' +
        '  .room stop              — 彻底结束当前群的跑团\n' +
        '  .room info <房间ID>     — 查看房间详情\n\n' +
        '流程：.mod list → create → 队友 join → start → 每人 ready → 自动开团',
    };
  }
}
