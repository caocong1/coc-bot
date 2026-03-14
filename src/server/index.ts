/**
 * CoC Bot 服务入口
 *
 * 启动流程：
 * 1. 读取配置
 * 2. 初始化所有子系统
 * 3. 连接 NapCat
 * 4. 启动 HTTP 服务
 */

import { NapCatTransport } from '../adapters/napcat/NapCatTransport';
import { NapCatEventNormalizer, type OneBotEvent } from '../adapters/napcat/NapCatEventNormalizer';
import { NapCatActionClient } from '../adapters/napcat/NapCatActionClient';
import { CommandParser } from '../commands/CommandParser';
import { CommandRegistry, type CommandContext, type CommandResult } from '../commands/CommandRegistry';
import { DiceCommand } from '../commands/dice/DiceCommand';
import { CheckCommand } from '../commands/coc7/CheckCommand';
import { SanCheckCommand } from '../commands/coc7/SanCheckCommand';
import { InsanityCommand } from '../commands/coc7/InsanityCommand';
import { SetCocCommand } from '../commands/coc7/SetCocCommand';
import { CocGenerateCommand } from '../commands/coc7/CocGenerateCommand';
import { EnCommand } from '../commands/coc7/EnCommand';
import { StCommand } from '../commands/sheet/StCommand';
import { PcCommand } from '../commands/sheet/PcCommand';
import { CharacterStore } from '../commands/sheet/CharacterStore';
import { HelpCommand } from '../commands/HelpCommand';
import { JrrpCommand } from '../commands/fun/JrrpCommand';
import { RegenCommand } from '../commands/fun/RegenCommand';
import { NameCommand } from '../commands/fun/NameCommand';
import { GuguCommand } from '../commands/fun/GuguCommand';
import { WebCommand } from '../commands/web/WebCommand';
import { RoomCommand } from '../commands/room/RoomCommand';
import { ModCommand } from '../commands/module/ModCommand';
import { InitCommand } from '../commands/dice/InitCommand';
import { SetCommand } from '../commands/sheet/SetCommand';
import { NnCommand } from '../commands/sheet/NnCommand';
import { UserSettingsStore } from '../storage/UserSettingsStore';
import { DashScopeClient } from '../ai/client/DashScopeClient';
import { CheckResolver } from '../rules/coc7/CheckResolver';
import { SanityResolver } from '../rules/coc7/SanityResolver';
import { ModeResolver } from '../runtime/ModeResolver';
import { CampaignHandler } from '../runtime/CampaignHandler';
import { openDatabase, migrateCoreSchema } from '../storage/Database';
import { TokenStore } from '../storage/TokenStore';
import { ApiRouter } from '../api/ApiRouter';
import type { MessageContext } from '../shared/contracts/RuntimeContracts';
import { enableTimestampedConsole } from '../shared/logging/ConsoleTimestamp';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';

enableTimestampedConsole();

/* ─── PID 管理：自动关掉上一个实例 ─── */

const PID_FILE = 'data/bot.pid';

function killExistingInstance() {
  if (!existsSync(PID_FILE)) return;
  try {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim());
    if (isNaN(oldPid)) return;
    process.kill(oldPid, 0); // 先探测进程是否存在（不实际发送信号）
    process.kill(oldPid);
    console.log(`[Boot] 已关闭旧实例 (PID ${oldPid})`);
    // 给旧进程一点时间释放端口
    Bun.sleepSync(500);
  } catch {
    // 进程已不存在，忽略
  }
}

function writePid() {
  mkdirSync('data', { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
}

function cleanupPid() {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

killExistingInstance();
writePid();
process.on('exit', cleanupPid);
process.on('SIGINT', () => { cleanupPid(); process.exit(0); });
process.on('SIGTERM', () => { cleanupPid(); process.exit(0); });

/* ─── config ─── */

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY ?? '';
const NAPCAT_WS_URL = process.env.NAPCAT_WS_URL ?? 'ws://127.0.0.1:3003';
const NAPCAT_HTTP_URL = process.env.NAPCAT_HTTP_URL ?? 'http://127.0.0.1:3002';
const NAPCAT_TOKEN = process.env.NAPCAT_TOKEN ?? '';
const SERVER_PORT = parseInt(process.env.SERVER_PORT ?? '28765');
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';
const WEB_DIST_DIR = process.env.WEB_DIST_DIR ?? './dist/web';

/* ─── init subsystems ─── */

console.log('=== CoC Bot 启动 ===');

// NapCat
const transport = new NapCatTransport({ wsUrl: NAPCAT_WS_URL, token: NAPCAT_TOKEN });
const normalizer = new NapCatEventNormalizer();
const actionClient = new NapCatActionClient(NAPCAT_HTTP_URL, NAPCAT_TOKEN);

// AI client
const aiClient = DASHSCOPE_API_KEY ? new DashScopeClient(DASHSCOPE_API_KEY) : null;
if (!aiClient) console.log('[Bot] DASHSCOPE_API_KEY 未配置，AI 功能（jrrp 等）将使用默认文案');

// rules
const checkResolver = new CheckResolver();
const sanityResolver = new SanityResolver(checkResolver);

// database（唯一实例，所有子系统共享）
const db = openDatabase();
migrateCoreSchema(db);

// 启动时把上次意外中断（status='running'）的 session 改为 'paused'，
// 让玩家可以用 .room resume 接回，而不是永久卡住
const orphaned = db.run(
  `UPDATE kp_sessions SET status = 'paused', updated_at = ? WHERE status = 'running'`,
  [new Date().toISOString()],
);
if (orphaned.changes > 0) {
  console.log(`[Bot] 检测到 ${orphaned.changes} 个未正常结束的跑团，已标记为暂停，可用 .room resume 继续`);
}

// storage（注入共享 db，避免双连接）
const characterStore = new CharacterStore(db);
const tokenStore = new TokenStore(db);
const userSettings = new UserSettingsStore(db);
tokenStore.cleanup(); // 清理过期 token

// mode
const modeResolver = new ModeResolver();

// campaign handler（仅在有 AI 客户端时启用）
const campaignHandler = aiClient
  ? new CampaignHandler({ db, aiClient, store: characterStore, modeResolver })
  : null;
if (!campaignHandler) console.log('[Bot] AI 客户端未配置，Campaign 模式不可用');

// Web API 路由器
const apiRouter = new ApiRouter({
  db,
  tokenStore,
  characterStore,
  campaignHandler,
  adminSecret: ADMIN_SECRET,
  aiClient: aiClient ?? undefined,
  napcat: actionClient,
});

// commands
const parser = new CommandParser();
const registry = new CommandRegistry();

// 注册所有命令
registry.register(new DiceCommand(userSettings));
registry.register(new CheckCommand(checkResolver, characterStore));
registry.register(new SanCheckCommand(sanityResolver, characterStore));
registry.register(new InsanityCommand(sanityResolver));
registry.register(new EnCommand(checkResolver, characterStore));

const setCocCmd = new SetCocCommand(checkResolver);
registry.register(setCocCmd);

registry.register(new CocGenerateCommand());
registry.register(new StCommand(characterStore));
registry.register(new PcCommand(characterStore));
registry.register(new JrrpCommand(aiClient));
registry.register(new RegenCommand(aiClient, actionClient));
registry.register(new NameCommand());
registry.register(new GuguCommand(aiClient));
registry.register(new InitCommand());
registry.register(new SetCommand(userSettings));
registry.register(new NnCommand(userSettings));
registry.register(new HelpCommand(registry));
registry.register(new WebCommand(tokenStore));
registry.register(new RoomCommand(db, tokenStore, campaignHandler, actionClient));
registry.register(new ModCommand(db));

/* ─── message handling ─── */

/** 顺序发送多条消息，间隔 800ms，避免刷屏和 QQ 限速 */
async function sendMessages(groupId: number, messages: string[]): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i].trim();
    if (!msg) continue;
    await actionClient.sendGroupMessage(groupId, msg);
    if (i < messages.length - 1) {
      await new Promise<void>((r) => setTimeout(r, 800));
    }
  }
}

/** 发送 KP 回复文字 + 关联图片（图片在文字后 800ms 发出） */
async function sendCampaignOutput(
  groupId: number,
  text: string | null,
  images: Array<{ absPath: string; caption: string; id: string }>,
): Promise<void> {
  if (text) {
    await actionClient.sendGroupMessage(groupId, text);
  }
  for (const img of images) {
    await new Promise<void>((r) => setTimeout(r, 800));
    // 说明文字格式：📷 caption（ID: img-xxx，可用 .regen img-xxx 重新生成）
    const caption = `📷 ${img.caption || '图片'}（ID: ${img.id}，可用 .regen ${img.id} 重新生成）`;
    await actionClient.sendGroupImage(groupId, img.absPath, caption);
  }
}

async function handleMessage(ctx: MessageContext, senderName?: string): Promise<void> {
  const mode = modeResolver.resolveMode(ctx);

  // Dice 模式下只处理命令
  if (mode === 'dice' && !ctx.isCommand) return;

  // 解析命令
  const cmd = parser.parse(ctx.plainText);

  // Campaign 模式下非命令消息交给 AI KP
  if (!cmd) {
    if (mode === 'campaign' && campaignHandler && ctx.groupId) {
      const gid = ctx.groupId;
      let thinkingMsgId = 0;
      const onThinking = () => {
        // 发送"思考中"提示，不阻塞 AI 生成
        actionClient.sendGroupMessage(gid, '💭 KP 正在思考...').then((id) => { thinkingMsgId = id; }).catch(() => {});
      };
      const output = await campaignHandler.handlePlayerMessage(
        gid,
        ctx.userId,
        senderName ?? String(ctx.userId),
        ctx.plainText,
        onThinking,
      ).catch((err) => {
        console.error('[Bot] campaign handler error:', err);
        return { text: null, images: [] as Array<{ absPath: string; caption: string; id: string }>, queued: false };
      });
      // 排队的消息不撤回提示、不发送输出（由合并处理负责）
      if (output.queued) return;
      // 撤回"思考中"提示
      if (thinkingMsgId) actionClient.deleteMsg(thinkingMsgId).catch(() => {});
      await sendCampaignOutput(gid, output.text, output.images);
    }
    return;
  }

  // .kp [内容] — 强制 KP 介入
  if (cmd.name === 'kp' && ctx.groupId) {
    if (!campaignHandler) return;
    const gid = ctx.groupId;
    const extraText = cmd.args?.join(' ').trim() ?? '';
    let thinkingMsgId = 0;
    const onThinking = () => {
      actionClient.sendGroupMessage(gid, '💭 KP 正在思考...').then((id) => { thinkingMsgId = id; }).catch(() => {});
    };
    const output = await campaignHandler.handleForceKP(
      gid, ctx.userId, senderName ?? String(ctx.userId), extraText, onThinking,
    ).catch((err) => {
      console.error('[Bot] forceKP error:', err);
      return { text: null, images: [] as Array<{ absPath: string; caption: string; id: string }> };
    });
    if (thinkingMsgId) actionClient.deleteMsg(thinkingMsgId).catch(() => {});
    await sendCampaignOutput(gid, output.text, output.images);
    return;
  }

  // .campaign 子命令
  if (cmd.name === 'campaign' && ctx.groupId) {
    if (!campaignHandler) {
      await actionClient.sendGroupMessage(ctx.groupId, 'AI 客户端未配置，Campaign 模式不可用。');
      return;
    }
    const subCmd = (cmd.args?.[0] ?? '').toLowerCase();

    // start
    if (subCmd === 'start' || subCmd === 'on') {
      const templateId = cmd.args?.[1];
      await actionClient.sendGroupMessage(ctx.groupId, '⏳ 守秘人正在准备开场，请稍候...');
      const parts = await campaignHandler.startSession(ctx.groupId, templateId).catch((err) => {
        console.error('[Bot] startSession error:', err);
        return [`⚔️ 跑团模式已开启（模板：${templateId ?? 'classic'}）\n守秘人已就位，请各位调查员就位。`];
      });
      await sendMessages(ctx.groupId, parts);
      return;
    }

    // pause
    if (subCmd === 'pause') {
      const reply = campaignHandler.pauseSession(ctx.groupId);
      await actionClient.sendGroupMessage(ctx.groupId, reply);
      return;
    }

    // resume
    if (subCmd === 'resume') {
      await actionClient.sendGroupMessage(ctx.groupId, '⏳ 守秘人正在整理记忆，请稍候...');
      const parts = await campaignHandler.resumeSession(ctx.groupId).catch((err) => {
        console.error('[Bot] resumeSession error:', err);
        return ['恢复跑团时发生错误，请检查日志。'];
      });
      await sendMessages(ctx.groupId, parts);
      return;
    }

    // stop
    if (subCmd === 'stop' || subCmd === 'off') {
      const reply = campaignHandler.stopSession(ctx.groupId);
      await actionClient.sendGroupMessage(ctx.groupId, reply);
      return;
    }

    // load
    if (subCmd === 'load') {
      const filename = cmd.args?.slice(1).join(' ').trim();
      if (!filename) {
        await actionClient.sendGroupMessage(ctx.groupId, '用法：.campaign load <模组文件名>\n示例：.campaign load 调查员手册（内部命令）');
        return;
      }
      const reply = campaignHandler.loadScenario(ctx.groupId, filename);
      await actionClient.sendGroupMessage(ctx.groupId, reply);
      return;
    }

    // 未知子命令，不回复（内部指令）
    return;
  }

  // 查找处理器
  const handler = registry.find(cmd.name);
  if (!handler) return;

  const commandCtx: CommandContext = {
    userId: ctx.userId,
    groupId: ctx.groupId,
    messageType: ctx.messageType,
    senderName,
  };

  try {
    const result = await handler.handle(commandCtx, cmd);
    await sendResult(ctx, result);

    // Campaign 模式下骰子命令结果反馈给 AI KP（错误结果不触发）
    if (mode === 'campaign' && campaignHandler && ctx.groupId && !result.error) {
      const diceCommands = new Set(['r', 'ra', 'rc', 'sc', 'rb', 'rp']);
      if (diceCommands.has(cmd.name)) {
        const diceGid = ctx.groupId;
        let diceThinkingId = 0;
        const onDiceThinking = () => {
          actionClient.sendGroupMessage(diceGid, '💭 KP 正在思考...').then((id) => { diceThinkingId = id; }).catch(() => {});
        };
        const diceOutput = await campaignHandler.handleDiceResult(
          diceGid,
          ctx.userId,
          senderName ?? String(ctx.userId),
          result.text,
          onDiceThinking,
        ).catch((err) => {
          console.error('[Bot] campaign dice feedback error:', err);
          return { text: null, images: [] as Array<{ absPath: string; caption: string; id: string }> };
        });
        if (diceThinkingId) actionClient.deleteMsg(diceThinkingId).catch(() => {});
        await sendCampaignOutput(diceGid, diceOutput.text, diceOutput.images);
      }
    }
  } catch (err) {
    console.error(`[Bot] command error (${cmd.name}):`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    await sendResult(ctx, { text: `命令执行出错: ${errMsg}` });
  }
}

async function sendResult(ctx: MessageContext, result: CommandResult): Promise<void> {
  try {
    // 暗骰：私聊发结果，群里发提示
    if (result.private) {
      await actionClient.sendPrivateMessage(ctx.userId, result.text);
      if (result.publicHint && ctx.groupId) {
        await actionClient.sendGroupMessage(ctx.groupId, result.publicHint);
      }
      return;
    }

    // 正常回复
    if (ctx.messageType === 'group' && ctx.groupId) {
      await actionClient.sendGroupMessage(ctx.groupId, result.text);
    } else {
      await actionClient.sendPrivateMessage(ctx.userId, result.text);
    }
  } catch (err) {
    console.error('[Bot] send message error:', err);
  }
}

/* ─── NapCat events ─── */

transport.on('message', (raw) => {
  const event = raw as OneBotEvent;
  console.log(`[Bot] 收到消息: user=${event.user_id} group=${event.group_id ?? 'private'} raw=${event.raw_message ?? ''}`);
  
  const ctx = normalizer.normalizeMessage(event);
  if (!ctx) {
    console.log('[Bot] 消息归一化失败，跳过');
    return;
  }

  // 提取发送者昵称：优先用 .nn 设置的称呼，否则用群名片/QQ昵称
  const qqName = (event.sender?.card as string) || (event.sender?.nickname as string) || undefined;
  const nnName = ctx.userId ? userSettings.getNickname(ctx.userId, ctx.groupId) : null;
  const senderName = nnName ?? qqName;

  console.log(`[Bot] 解析: text="${ctx.plainText}" isCmd=${ctx.isCommand} cmd=${ctx.commandName ?? 'none'}`);

  handleMessage(ctx, senderName).catch(err => {
    console.error('[Bot] unhandled error:', err);
  });
});

transport.on('lifecycle', (data) => {
  const event = data as OneBotEvent;
  if (event.self_id) {
    normalizer.setSelfId(event.self_id);
    console.log(`[Bot] self_id = ${event.self_id}`);
  }
});

/* ─── HTTP server ─── */

const WEB_DIST = Bun.file(WEB_DIST_DIR + '/index.html');

const server = Bun.serve({
  port: SERVER_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // 内置命令列表接口（保留兼容性）
    if (url.pathname === '/api/commands') {
      return Response.json(registry.getAllDescriptions());
    }

    // Web API 路由（/api/*）
    if (url.pathname.startsWith('/api/')) {
      const apiRes = await apiRouter.handle(req);
      if (apiRes) return apiRes;
    }

    // SPA 静态文件服务（Web 控制台前端）
    if (existsSync(WEB_DIST_DIR)) {
      const filePath = WEB_DIST_DIR + url.pathname;
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
      // SPA fallback：所有未匹配路径返回 index.html
      return new Response(WEB_DIST);
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[Server] HTTP on http://localhost:${SERVER_PORT}`);

/* ─── connect ─── */

transport.connect().then(() => {
  // 获取自身信息
  actionClient.getLoginInfo()
    .then(info => {
      normalizer.setSelfId(info.user_id);
      console.log(`[Bot] logged in as ${info.nickname} (${info.user_id})`);
    })
    .catch(() => console.log('[Bot] failed to get login info'));
}).catch(err => {
  console.error('[Bot] NapCat connection failed:', err);
  console.log('[Bot] will retry automatically...');
});

console.log('=== CoC Bot 就绪 ===');
console.log('支持的命令:');
for (const desc of registry.getAllDescriptions()) {
  console.log(`  .${desc.name} - ${desc.description}`);
}
