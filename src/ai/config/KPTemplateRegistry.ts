/**
 * KP 模板注册表
 *
 * 管理内置和自定义的 KP 人格模板
 */

import type { KPTemplateParams } from '@shared/contracts/AIContracts';
import type { Database as BunDB } from 'bun:sqlite';

/**
 * KP 模板
 */
export interface KPTemplate extends KPTemplateParams {
  id: string;
  builtin: boolean;
}

/** 旧 ID → 新 ID 映射 */
const LEGACY_MAPPING: Record<string, string> = {
  'serious': 'classic',
  'old-school': 'hardboiled',
  'strict': 'hardboiled',
  'humorous': 'classic',
  'creative': 'storyteller',
  'freeform': 'storyteller',
  'babysitter': 'nurturing',
  'killer': 'hardboiled',
};

/**
 * KP 模板注册表
 */
export class KPTemplateRegistry {
  private builtinTemplates: Map<string, KPTemplate> = new Map();
  private db?: BunDB;

  constructor(db?: BunDB) {
    this.db = db;
    this.registerBuiltinTemplates();
  }

  /**
   * 注册内置模板
   */
  private registerBuiltinTemplates(): void {
    const templates: KPTemplate[] = [
      {
        id: 'classic',
        name: '经典',
        description: '均衡的守秘人风格，适合大多数模组',
        builtin: true,
        tone: 6,
        flexibility: 5,
        guidance: 4,
        lethality: 5,
        pacing: 5,
        defaultPromptBlock: '你是一位经验丰富的守秘人，在规则与叙事之间保持平衡，营造恰到好处的悬疑氛围。',
      },
      {
        id: 'nurturing',
        name: '新手友好',
        description: '耐心引导，低危险，适合新手玩家',
        builtin: true,
        tone: 4,
        flexibility: 7,
        guidance: 9,
        lethality: 2,
        pacing: 4,
        defaultPromptBlock: '你是一位温和耐心的守秘人，善于引导新手玩家，主动给出方向性提示，确保每个人都能享受游戏。',
      },
      {
        id: 'hardboiled',
        name: '硬核',
        description: '严格规则，高致命，不给提示',
        builtin: true,
        tone: 8,
        flexibility: 3,
        guidance: 3,
        lethality: 8,
        pacing: 6,
        defaultPromptBlock: '你是一位冷酷严格的守秘人，严格执行规则，陷阱致命，怪物凶残。愚蠢的行动将付出惨痛代价。',
      },
      {
        id: 'storyteller',
        name: '演绎',
        description: '沉浸角色扮演，好 RP 有奖励',
        builtin: true,
        tone: 5,
        flexibility: 9,
        guidance: 6,
        lethality: 4,
        pacing: 4,
        defaultPromptBlock: '你是一位注重角色扮演的守秘人，鼓励玩家深入演绎角色。精彩的 RP 可以获得额外信息或降低检定难度，NPC 对话生动有性格。',
      },
      {
        id: 'cosmic',
        name: '宇宙恐怖',
        description: '极致克苏鲁恐怖氛围，慢热压迫',
        builtin: true,
        tone: 10,
        flexibility: 5,
        guidance: 4,
        lethality: 7,
        pacing: 3,
        defaultPromptBlock: '你是一位专注宇宙恐怖的守秘人，擅长营造洛夫克拉夫特式的未知恐惧。通过感官细节、环境异常、心理压迫渲染恐怖，让玩家感受到人类在宇宙面前的渺小与无力。',
      },
    ];

    for (const t of templates) {
      this.builtinTemplates.set(t.id, t);
    }
  }

  /**
   * 获取模板（内置 → 数据库 → legacy 映射）
   */
  get(id: string): KPTemplate | undefined {
    // 1. 内置
    const builtin = this.builtinTemplates.get(id);
    if (builtin) return builtin;

    // 2. 数据库自定义
    if (this.db) {
      const row = this.db.query<{
        id: string; name: string; description: string;
        tone: number; flexibility: number; guidance: number;
        lethality: number; pacing: number; custom_prompts: string;
      }, string>(
        'SELECT id, name, description, tone, flexibility, guidance, lethality, pacing, custom_prompts FROM kp_templates WHERE id = ?',
      ).get(id);
      if (row) return this.rowToTemplate(row);
    }

    // 3. Legacy 映射
    const mapped = LEGACY_MAPPING[id];
    if (mapped) return this.builtinTemplates.get(mapped);

    return undefined;
  }

  /**
   * 获取所有模板（内置 + 数据库自定义）
   */
  getAll(): KPTemplate[] {
    const result = Array.from(this.builtinTemplates.values());

    if (this.db) {
      const rows = this.db.query<{
        id: string; name: string; description: string;
        tone: number; flexibility: number; guidance: number;
        lethality: number; pacing: number; custom_prompts: string;
      }, []>(
        'SELECT id, name, description, tone, flexibility, guidance, lethality, pacing, custom_prompts FROM kp_templates ORDER BY created_at',
      ).all();
      for (const row of rows) {
        result.push(this.rowToTemplate(row));
      }
    }

    return result;
  }

  /**
   * 获取内置模板
   */
  getBuiltin(): KPTemplate[] {
    return Array.from(this.builtinTemplates.values());
  }

  private rowToTemplate(row: {
    id: string; name: string; description: string;
    tone: number; flexibility: number; guidance: number;
    lethality: number; pacing: number; custom_prompts: string;
  }): KPTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      builtin: false,
      tone: row.tone,
      flexibility: row.flexibility,
      guidance: row.guidance,
      lethality: row.lethality,
      pacing: row.pacing,
      defaultPromptBlock: '',
      customPrompts: row.custom_prompts || undefined,
    };
  }
}
