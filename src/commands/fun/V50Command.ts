/**
 * 疯狂星期四文案生成器：.v50 [方向]
 *
 *   .v50           随机声腔，全力骗读者进去，最后一秒暴露
 *   .v50 三体      以"三体"为灵魂，笑点在这个题材怎么会走到疯四
 *
 * - 自由模式：随机声腔卡（谁在说/在哪说/有什么物件），BAD_PATTERNS 过滤 + 一次重试
 * - 定向模式：两阶段生成（骨架草图 → 正文），强制桥从题材内部长出来
 * - 无 fallback，出错报错
 */

import type { CommandHandler, CommandContext, CommandResult } from '../CommandRegistry';
import type { ParsedCommand } from '../CommandParser';
import type { DashScopeClient, VisionMessage } from '../../ai/client/DashScopeClient';

// ── 声腔卡 ──────────────────────────────────────────────────────────────────
// "谁在说、在哪说、有什么物件"，比"玄幻/武侠"更接近互联网真实声腔

interface VoiceCard {
  name: string;
  narrator: string[];
  scene: string[];
  details: string[];
}

const VOICE_CARDS: VoiceCard[] = [
  {
    name: '微信长文卖惨型',
    narrator: ['刚被分手的人', '被老板PUA的打工人', '凌晨发朋友圈的人', '和前任拉拉扯扯的人'],
    scene: ['公司厕所隔间', '打车路上', '家门口台阶上', '下班路上的天桥'],
    details: ['聊天截图', '转账记录', '备注名', '语音条', '共享定位', '删了又加的好友'],
  },
  {
    name: '豆瓣小组离谱经历型',
    narrator: ['和合租室友产生矛盾的人', '相亲遇到奇葩的人', '租房纠纷当事人', '维权中的消费者'],
    scene: ['小区电梯里', '地铁末班车', '派出所走廊', '业主群里'],
    details: ['借条', '录音', '调解记录', '押金单', '群公告截图', '物业通知'],
  },
  {
    name: '游戏圈退坑/奔现型',
    narrator: ['准备出号的玩家', '被队友坑了的选手', '打算奔现的网友', '刚被封号的玩家'],
    scene: ['凌晨服务器维护期间', '赛季最后一天', '奔现当天', '战绩结算页面前'],
    details: ['战绩截图', '封号通知', '充值记录', '维护公告', '赛季排名', '公会日志'],
  },
  {
    name: '一本正经伪科普型',
    narrator: ['纪录片解说员', '冷知识博主', '学术论文作者', '研究机构发言人'],
    scene: ['研究报告结尾', '纪录片最后一幕', '科普视频末尾', '学术发布会现场'],
    details: ['统计数据', '样本数量', '研究结论', '对照组', '观察周期', '误差范围'],
  },
  {
    name: '法律/维权求助型',
    narrator: ['劳动仲裁申请人', '刚从法院出来的人', '收到律师函的人', '正在报警的人'],
    scene: ['派出所门口', '开庭前十分钟', '仲裁庭外走廊', '律师事务所等候区'],
    details: ['证据清单', '调解协议', '立案通知', '转账截图', '录音文件', '诉前通知'],
  },
  {
    name: '克苏鲁/调查员型',
    narrator: ['独立调查员', '深海考察队成员', '神话学会最后一个成员', '临终前的研究者'],
    scene: ['地下档案室', '废弃研究站', '深夜的港口', '封存的密室'],
    details: ['调查报告', '密文档案', '失踪记录', 'SAN值', '神话生物样本', '最后一卷胶卷'],
  },
  {
    name: '网抑云/深夜独白型',
    narrator: ['失眠的人', '凌晨刷手机的人', '给自己写备忘录的人', '想发又没发朋友圈的人'],
    scene: ['凌晨两点的出租屋', '阳台上', '床上盯着天花板', '浴室里'],
    details: ['备忘录草稿', '未发出的消息', '删了又写的朋友圈', '外卖记录', '日历提醒'],
  },
  {
    name: '诈骗公告/系统通知型',
    narrator: ['系统安全团队', '运营官方号', '群管理员', '客服机器人'],
    scene: ['系统弹窗通知', '群管理公告', '安全邮件正文', '账号异常提示页'],
    details: ['异常登录IP', '安全风险提示', '账号核验流程', '补偿方案', '操作截止时间'],
  },
];

// ── 结尾类型 ─────────────────────────────────────────────────────────────────
// 呼应前文 > 只说星期四 ≈ 只说V我50 > 完整公式（最低优先级）

type EndingType = 'implicitRef' | 'thursdayOnly' | 'v50Only' | 'fullFormula';

const ENDING_WEIGHTS: [EndingType, number][] = [
  ['implicitRef',  0.35],
  ['thursdayOnly', 0.25],
  ['v50Only',      0.25],
  ['fullFormula',  0.15],
];

const ENDING_DESCRIPTIONS: Record<EndingType, string> = {
  implicitRef:  '用一个与前文具体细节呼应的意象或动作自然收尾，让读者停顿一秒才反应过来，不要直接提肯德基/V我50',
  thursdayOnly: '只说"今天星期四"然后停止，或用谐音/双关暗示，不解释',
  v50Only:      '只说"V我50"或"29.9"，不提肯德基也不提疯狂星期四',
  fullFormula:  '今天是肯德基疯狂星期四，V我50',
};

// ── BAD_PATTERNS 过滤 ────────────────────────────────────────────────────────
// 命中 ≥2 条说明 AI 在套模板，重试一次

const BAD_PATTERNS = [
  '命运总爱在这种时刻',
  '就在这时我看了一眼手机',
  '就在这时，我不小心',
  '原来今天是',
  '直到那一刻我才明白',
  '一切都说得通了',
  '然而命运',
  '我愣住了',
  '万万没想到',
  '此刻我才恍然',
];

function countBadPatterns(text: string): number {
  return BAD_PATTERNS.filter(p => text.includes(p)).length;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickSome<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

function weightedPick<T>(weights: [T, number][]): T {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [item, w] of weights) {
    r -= w;
    if (r <= 0) return item;
  }
  return weights[weights.length - 1][0];
}

// ── Prompt 构建 ──────────────────────────────────────────────────────────────

function buildFreeSystemPrompt(card: VoiceCard, narrator: string, scene: string, detailHints: string, endingType: EndingType): string {
  return `你要写的是疯四文学——中文互联网群聊里流传的那种短文案。
目标：让人先认真读进去三秒，最后一秒才反应过来。

规则（全部可执行）：
1. 90-200字，像群聊消息而不是作文
2. 只输出正文，无前缀无标题无emoji
3. 你是【${narrator}】，在【${scene}】，遇到了具体的事
4. 前80%绝对不能出现：肯德基/KFC/疯狂星期四/星期四/V我50/套餐/优惠/29.9
5. 必须有具体物件和动作，不能空转情绪（好：工资条/录音/删好友/截图；坏：命运/深渊/绝望/轮回）
6. 桥不是万能句——必须从【${scene}】里长出来，不能用通用过渡句
7. 结尾类型：${ENDING_DESCRIPTIONS[endingType]}
8. 禁止：命运总爱……/就在这时我看了眼手机/原来今天是/直到那刻/万万没想到/我愣住了
9. 不要升华，不要讲道理，不要解释梗

参考细节词（至少用1个）：${detailHints}

示例（看风格，不要抄结构）：
---
张可也没想到这会是最后一条消息。三年半，一千三百多天，她翻遍了聊天记录，只找到二十四条对方主动发的内容，其中十九条是发票报销模板。她把截图发给闺蜜，闺蜜说：我帮你盘一下。然后消失了。今天星期四。
---
临近开庭前十分钟，我在法院走廊刷完了最后一遍证据清单。对方律师经过我身边，点了一下头。我点了回去。然后我发现手机没电了，去找了一圈共享充电宝。充上之后，看见备忘录里有一条备注：疯四，29.9。V我50。
---
[本地服务器时间 03:12:55] 检测到您的账号本周已在14个不同IP登录。根据§8.3.2条，账号存在安全风险。如确认为本人操作，请在24小时内完成验证，否则将暂停服务。验证方式：V我50（微信）。
---

用【${card.name}】的口吻直接写正文。`;
}

function buildSkeletonSystemPrompt(topic: string): string {
  return `用户给了一个方向："${topic}"
设计一个疯四文案骨架，只输出JSON，不写正文。

找出把"${topic}"引向"疯四/V我50"最荒诞但"好像也说得通"的路径。
桥必须来自"${topic}"内部逻辑，不能用通用硬切。

输出格式（只输出这个JSON，不要其他内容）：
{
  "narrator": "谁在说（具体身份，和${topic}强相关）",
  "scene": "发生在哪个具体场景（来自${topic}的世界）",
  "conflict": "遇到了什么具体事（1-2句，核心矛盾）",
  "bridge": "怎么从conflict自然拐到疯四（这段逻辑必须离谱但又好像说得通）",
  "ending": "呼应型|星期四型|V我50型|完整公式型"
}`;
}

interface Skeleton {
  narrator: string;
  scene: string;
  conflict: string;
  bridge: string;
  ending: string;
}

function buildProseSystemPrompt(skeleton: Skeleton, topic: string): string {
  const endingMap: Record<string, string> = {
    '呼应型': '用一个与前文具体细节呼应的意象收尾，不直接提KFC/V我50，让读者停一秒才反应过来',
    '星期四型': '只说"今天星期四"然后停，或谐音暗示',
    'V我50型': '只说"V我50"或"29.9"，不提肯德基',
    '完整公式型': '今天是肯德基疯狂星期四，V我50',
  };
  const endingDesc = endingMap[skeleton.ending] ?? endingMap['V我50型'];

  return `根据以下骨架，写出疯四文案正文。

骨架：
- 谁在说：${skeleton.narrator}
- 发生在：${skeleton.scene}
- 冲突：${skeleton.conflict}
- 如何拐到疯四：${skeleton.bridge}
- 结尾方式：${endingDesc}

规则：
1. 90-200字，一气呵成，像群聊里的长消息
2. 只输出正文，无前缀无标题
3. 具体动作和物件，不能空转情绪（"${topic}"必须贯穿始终，是灵魂不是装饰）
4. 前80%不出现：肯德基/KFC/疯狂星期四/星期四/V我50
5. 结尾按上面描述的方式，越克制越好
6. 像真人说话，不像AI在努力写好
7. 禁止：命运总爱……/就在这时我看了眼手机/原来今天是/直到那刻/万万没想到`;
}

// ── 命令 ─────────────────────────────────────────────────────────────────────

export class V50Command implements CommandHandler {
  name = 'v50';
  aliases = [];
  description = '疯狂星期四文案：.v50 [方向]';

  constructor(private readonly aiClient: DashScopeClient) {}

  async handle(_ctx: CommandContext, cmd: ParsedCommand): Promise<CommandResult> {
    const topic = cmd.rawArgs.trim();
    try {
      const text = topic
        ? await this.generateDirected(topic)
        : await this.generateFree();
      return { text };
    } catch (err) {
      console.error('[V50] 生成失败:', err);
      return { text: 'AI 开小差了，今天疯四先欠着。' };
    }
  }

  private async generateFree(): Promise<string> {
    const card = pickRandom(VOICE_CARDS);
    const narrator = pickRandom(card.narrator);
    const scene = pickRandom(card.scene);
    const detailHints = pickSome(card.details, 3).join('、');
    const endingType = weightedPick(ENDING_WEIGHTS);

    const systemPrompt = buildFreeSystemPrompt(card, narrator, scene, detailHints, endingType);
    let result = await this.callChat(systemPrompt);

    if (countBadPatterns(result) >= 2) {
      // 一次重试，第二次无论如何使用
      result = await this.callChat(systemPrompt);
    }

    return result;
  }

  private async generateDirected(topic: string): Promise<string> {
    // Stage 1: 骨架草图
    const skeletonRaw = await this.callChat(buildSkeletonSystemPrompt(topic));
    const skeleton = this.parseSkeleton(skeletonRaw);

    if (!skeleton) {
      // JSON 解析失败，降级到单阶段直接生成
      const fallbackPrompt = buildProseSystemPrompt(
        { narrator: '相关人物', scene: '相关场景', conflict: '围绕该题材的核心冲突', bridge: '通过该题材内部逻辑自然拐向疯四', ending: 'V我50型' },
        topic,
      );
      return this.callChat(fallbackPrompt);
    }

    // Stage 2: 根据骨架写正文
    return this.callChat(buildProseSystemPrompt(skeleton, topic));
  }

  private parseSkeleton(raw: string): Skeleton | null {
    try {
      // 提取 JSON 块（模型有时会在 JSON 外加解释文字）
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      if (
        typeof obj.narrator === 'string' &&
        typeof obj.scene === 'string' &&
        typeof obj.conflict === 'string' &&
        typeof obj.bridge === 'string' &&
        typeof obj.ending === 'string'
      ) {
        return obj as unknown as Skeleton;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async callChat(systemPrompt: string): Promise<string> {
    const messages: VisionMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '开始创作' },
    ];
    const raw = await this.aiClient.chat('qwen3.5-plus', messages);
    return raw
      .replace(/^<think>[\s\S]*?<\/think>\s*/m, '')
      .trim();
  }
}
