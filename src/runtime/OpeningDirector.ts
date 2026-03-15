import { DashScopeClient } from '../ai/client/DashScopeClient';
import type { Character } from '@shared/types/Character';
import type { ModuleRulePack, ScenarioEntity, ScenarioItem } from '@shared/types/ScenarioAssets';
import {
  createDefaultRoomDirectorPrefs,
  type OpeningAssignment,
  type OpeningBeatPrivateText,
  type OpeningBeatSkeleton,
  type OpeningBeatText,
  type OpeningDirectorPlan,
  type OpeningDirectorPlanSkeleton,
  type OpeningPlanLink,
  type RoomDirectorPrefs,
  type RoomRelationship,
} from '@shared/types/StoryDirector';

const OPENING_MODEL = 'qwen3.5-plus';
const DEFAULT_START_TIME = '1925-03-15T10:00';

export interface OpeningDirectorInput {
  characters: Character[];
  roomRelationships: RoomRelationship[];
  directorPrefs?: RoomDirectorPrefs | null;
  scenarioText?: string | null;
  scenarioLabel?: string | null;
  approvedEntities?: ScenarioEntity[];
  approvedItems?: ScenarioItem[];
  moduleRulePack?: ModuleRulePack | null;
}

interface ResolvedOpeningDirectorInput {
  characters: Character[];
  roomRelationships: RoomRelationship[];
  directorPrefs: RoomDirectorPrefs;
  scenarioText: string;
  scenarioLabel: string;
  approvedEntities: ScenarioEntity[];
  approvedItems: ScenarioItem[];
  moduleRulePack: ModuleRulePack | null;
}

export class OpeningDirector {
  constructor(private readonly client: DashScopeClient) {}

  async createPlan(input: OpeningDirectorInput): Promise<OpeningDirectorPlan> {
    const normalizedInput: ResolvedOpeningDirectorInput = {
      characters: input.characters,
      roomRelationships: input.roomRelationships,
      directorPrefs: input.directorPrefs ?? createDefaultRoomDirectorPrefs(),
      approvedEntities: input.approvedEntities ?? [],
      approvedItems: input.approvedItems ?? [],
      moduleRulePack: input.moduleRulePack ?? null,
      scenarioText: input.scenarioText ?? '',
      scenarioLabel: input.scenarioLabel ?? '未知模组',
    };

    try {
      const skeleton = await this.generateSkeleton(normalizedInput)
        .catch((err) => {
          console.warn('[OpeningDirector] skeleton generation failed, fallback to deterministic plan:', err);
          return this.buildFallbackSkeleton(normalizedInput);
        });

      const beatEntries = await Promise.all(skeleton.beats.map(async (beat) => {
        try {
          const text = await this.generateBeatText(normalizedInput, skeleton, beat);
          return [beat.id, text] as const;
        } catch (err) {
          console.warn(`[OpeningDirector] beat text generation failed for ${beat.id}, using fallback:`, err);
          return [beat.id, this.buildFallbackBeatText(normalizedInput, skeleton, beat)] as const;
        }
      }));

      return {
        ...skeleton,
        beatTexts: Object.fromEntries(beatEntries),
      };
    } catch (err) {
      console.warn('[OpeningDirector] createPlan failed unexpectedly, using full deterministic fallback:', err);
      return this.createFallbackPlan(input);
    }
  }

  createFallbackPlan(input: OpeningDirectorInput): OpeningDirectorPlan {
    const normalizedInput: ResolvedOpeningDirectorInput = {
      characters: input.characters,
      roomRelationships: input.roomRelationships,
      directorPrefs: input.directorPrefs ?? createDefaultRoomDirectorPrefs(),
      approvedEntities: input.approvedEntities ?? [],
      approvedItems: input.approvedItems ?? [],
      moduleRulePack: input.moduleRulePack ?? null,
      scenarioText: input.scenarioText ?? '',
      scenarioLabel: input.scenarioLabel ?? '未知模组',
    };
    const skeleton = this.buildFallbackSkeleton(normalizedInput);
    const beatEntries = skeleton.beats.map((beat) => [
      beat.id,
      this.buildFallbackBeatText(normalizedInput, skeleton, beat),
    ] as const);
    return {
      ...skeleton,
      beatTexts: Object.fromEntries(beatEntries),
    };
  }

  private async generateSkeleton(input: ResolvedOpeningDirectorInput): Promise<OpeningDirectorPlanSkeleton> {
    const privacyMode = getPlayPrivacyMode(input.moduleRulePack);
    const systemPrompt = [
      '你是一位擅长 CoC 跑团开场编排的导演型守秘人。',
      '你的任务是生成一个严格合法的 JSON 开场骨架，不要输出任何解释、Markdown 或代码块。',
      '你可以在不改写模组核心真相、关键谜底、关键线索链和终局条件的前提下，补充合理的连接场景、非关键路人、委托细节、天气、路途和个人化引子。',
      '显式房间关系优先，未设定的关系可以推断为轻量关系，但只能写进 assumedLinks，不能假定所有人都互相认识。',
      '优先参考模组原文、已审核实体、已审核物品、已审核规则包和调查员职业背景。',
      privacyMode === 'secret'
        ? '这是秘密团，可以在内部调度上安排不同调查员分线开场，并在需要时设置 privateTargets。'
        : '这是公开团，所有剧情默认在群内公开推进。不要依赖私聊或玩家可见分镜；initialAssignments 应全部为 main，privateTargets 应为空数组。',
      '如果系统导演策略允许，可以把不同调查员安排为不同时间和地点进场，并给出自然汇合目标。',
      '严格返回 JSON 对象，字段必须符合约定：startTime, randomSeed, assumedLinks, initialAssignments, beats, mergeGoal, directorSeeds。',
      'beats 数量控制在 2 到 5 个；initialAssignments 必须覆盖所有调查员；directorSeeds 至少包含 2 个 seed。',
    ].join('\n');

    const userPrompt = [
      '【调查员列表】',
      this.buildCharacterSummary(input.characters),
      '',
      '【房间显式关系】',
      this.buildRoomRelationshipSummary(input.roomRelationships, input.characters),
      '',
      '【系统导演策略】',
      this.buildDirectorPrefsSummary(input.directorPrefs),
      '',
      '【模组规则包】',
      this.buildRulePackSummary(input.moduleRulePack),
      '',
      '【关键实体】',
      this.buildEntitySummary(input.approvedEntities),
      '',
      '【关键物品】',
      this.buildItemSummary(input.approvedItems),
      '',
      `【模组正文前段】\n${compact(input.scenarioText, 6000) || '（暂无模组正文）'}`,
      '',
      '【JSON 结构要求】',
      `{
  "startTime": "YYYY-MM-DDTHH:MM",
  "randomSeed": "短字符串",
  "assumedLinks": [{ "participants": ["角色名A","角色名B"], "relationType": "heard_of|acquainted|close|bound|secret_tie", "notes": "简短备注", "source": "assumed", "reason": "为什么这样推断" }],
  "initialAssignments": [{ "target": "角色名", "channelId": "频道名" }],
  "beats": [{
    "id": "beat-1",
    "channelId": "频道名",
    "participants": ["角色名"],
    "sceneName": "场景名",
    "purpose": "intro|hook|merge_setup",
    "advanceMinutes": 0,
    "sceneState": { "description": "当前场景描述", "activeNpcs": ["名字1"] },
    "privateTargets": ["角色名"]
  }],
  "mergeGoal": "一句话说明自然汇合目标",
  "directorSeeds": [{
    "id": "seed-1",
    "kind": "personal_hook|merge_goal|npc_hook|pressure_clock",
    "title": "种子标题",
    "description": "一句话说明",
    "channelId": "频道名",
    "targets": ["角色名"],
    "resolved": false
  }]
}`,
    ].join('\n');

    const raw = await this.client.chat(OPENING_MODEL, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = parseJsonResponse(raw) as Partial<OpeningDirectorPlanSkeleton> | null;
    if (!parsed) {
      throw new Error('opening skeleton JSON parse failed');
    }
    return normalizeOpeningSkeleton(parsed, input);
  }

  private async generateBeatText(
    input: ResolvedOpeningDirectorInput,
    skeleton: OpeningDirectorPlanSkeleton,
    beat: OpeningBeatSkeleton,
  ): Promise<OpeningBeatText> {
    const privacyMode = getPlayPrivacyMode(input.moduleRulePack);
    const systemPrompt = [
      '你是一位克苏鲁跑团守秘人，负责为一个开场 beat 生成文本。',
      '只返回 JSON 对象，不要输出解释、Markdown 或代码块。',
      'publicText 可以略长一些，但必须自然、沉浸、克制，不泄露 KP ONLY 内容。',
      '允许补充合理的连接内容和轻量原创细节，但不要改写模组核心真相、幕后身份、终局条件或关键解法。',
      privacyMode === 'secret'
        ? 'privateTexts 只给 beat.privateTargets 中的角色写私密引子；没有则返回空数组。'
        : '这是公开团。不要使用私聊语气；若是单人感知或个人细节，也直接写进 publicText，例如“只有你注意到……”。privateTexts 必须返回空数组。',
      'beat 之间如果需要切到另一位调查员，请使用正常 KP 话术，例如“与此同时”“而在另一边”，不要提及镜头、频道或导演调度。',
      '返回结构：{"publicText":"...","privateTexts":[{"target":"角色名","text":"..."}],"followupHint":"一句对后续推进有用的隐藏提示"}',
    ].join('\n');

    const userPrompt = [
      `【模组】${input.scenarioLabel}`,
      '',
      '【调查员】',
      this.buildCharacterSummary(input.characters),
      '',
      '【显式与假设关系】',
      this.buildCombinedLinksSummary(skeleton.assumedLinks, input.roomRelationships, input.characters),
      '',
      '【汇合目标】',
      skeleton.mergeGoal,
      '',
      '【当前 beat 骨架】',
      JSON.stringify(beat, null, 2),
      '',
      '【模组关键实体】',
      this.buildEntitySummary(input.approvedEntities),
      '',
      '【模组关键物品】',
      this.buildItemSummary(input.approvedItems),
      '',
      `【模组正文前段】\n${compact(input.scenarioText, 3500) || '（暂无模组正文）'}`,
    ].join('\n');

    const raw = await this.client.chat(OPENING_MODEL, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = parseJsonResponse(raw) as Partial<OpeningBeatText> | null;
    if (!parsed) {
      throw new Error(`opening beat JSON parse failed for ${beat.id}`);
    }

    const publicText = String(parsed.publicText ?? '').trim();
    if (!publicText) {
      throw new Error(`opening beat publicText missing for ${beat.id}`);
    }

    const allowedTargets = new Set(beat.privateTargets.map(normalizeName));
    const privateTexts = Array.isArray(parsed.privateTexts)
      ? parsed.privateTexts
        .map((item) => ({
          target: String((item as OpeningBeatPrivateText).target ?? '').trim(),
          text: String((item as OpeningBeatPrivateText).text ?? '').trim(),
        }))
        .filter((item) => item.target && item.text && allowedTargets.has(normalizeName(item.target)))
      : [];

    return {
      publicText,
      privateTexts,
      followupHint: String(parsed.followupHint ?? '').trim(),
    };
  }

  private buildFallbackSkeleton(input: ResolvedOpeningDirectorInput): OpeningDirectorPlanSkeleton {
    const cast = input.characters.map((character) => character.name);
    const randomSeed = `seed-${Math.random().toString(36).slice(2, 8)}`;
    const secretMode = getPlayPrivacyMode(input.moduleRulePack) === 'secret';
    const allowSplit = shouldUseSplitOpening(input);
    const firstGroup = allowSplit ? cast.filter((_, index) => index % 2 === 0) : cast;
    const secondGroup = allowSplit ? cast.filter((_, index) => index % 2 === 1) : cast;
    const assignments: OpeningAssignment[] = cast.map((target, index) => ({
      target,
      channelId: secretMode && allowSplit && secondGroup.includes(target) ? `line-${Math.max(1, index)}` : 'main',
    }));

    const beats: OpeningBeatSkeleton[] = [];
    beats.push({
      id: 'beat-1',
      channelId: 'main',
      participants: firstGroup.length > 0 ? firstGroup : cast,
      sceneName: '开场',
      purpose: 'intro',
      advanceMinutes: 0,
      sceneState: {
        description: '调查员们以各自合理的身份与理由，被推向同一场事件的边缘。',
        activeNpcs: [],
      },
      privateTargets: [],
    });
    beats.push({
      id: 'beat-2',
      channelId: secretMode && allowSplit && secondGroup.length > 0 ? assignments.find((item) => item.target === secondGroup[0])?.channelId ?? 'side-1' : 'main',
      participants: allowSplit && secondGroup.length > 0 ? secondGroup : cast,
      sceneName: '异样浮现',
      purpose: cast.length > 1 ? 'merge_setup' : 'hook',
      advanceMinutes: 10,
      sceneState: {
        description: '一条把众人逐步引向同一个谜团的线索悄然浮现。',
        activeNpcs: [],
      },
      privateTargets: secretMode && input.directorPrefs.privateHookLevel !== 'none' ? [cast[0]].filter(Boolean) : [],
    });

    const mergeGoal = cast.length > 1
      ? '让所有调查员都自然意识到，他们各自碰上的异样其实指向同一件事。'
      : '让调查员在当前场景里抓住第一个值得追查的异样。';

    return {
      startTime: DEFAULT_START_TIME,
      randomSeed,
      assumedLinks: [],
      initialAssignments: assignments,
      beats,
      mergeGoal,
      directorSeeds: [
        {
          id: 'seed-personal-1',
          kind: 'personal_hook',
          title: '个人引子',
          description: '让至少一名调查员的职业、人设或背景与开场异样发生连接。',
          channelId: beats[0].channelId,
          targets: beats[0].participants.slice(0, 1),
          resolved: false,
        },
        {
          id: 'seed-merge-1',
          kind: 'merge_goal',
          title: '自然汇合',
          description: mergeGoal,
          channelId: beats[beats.length - 1].channelId,
          targets: cast,
          resolved: false,
        },
      ],
    };
  }

  private buildFallbackBeatText(
    input: ResolvedOpeningDirectorInput,
    skeleton: OpeningDirectorPlanSkeleton,
    beat: OpeningBeatSkeleton,
  ): OpeningBeatText {
    const participants = beat.participants.join('、');
    const intro = beat.purpose === 'merge_setup'
      ? `${participants}还不知道彼此已被同一股阴影牵住。`
      : `${participants}此刻出现在这里并不突兀，而像是命运把他们推向了同一条线索的不同入口。`;
    const publicText = [
      `${intro} ${beat.sceneState.description || `${beat.sceneName}的异样逐渐浮现。`}` ,
      input.directorPrefs.allowModuleExpansion
        ? '周围一些原本不值一提的小人物、天气和日常声响，都在这个时刻变得略显不合时宜。'
        : '模组原有的开场异样正以一种足够自然的方式逼近。',
      skeleton.mergeGoal ? `你隐约能感觉到，这一切最终会把人引向同一个问题：${skeleton.mergeGoal}` : '',
    ].filter(Boolean).join(' ');

    const privateTexts = getPlayPrivacyMode(input.moduleRulePack) === 'secret'
      ? beat.privateTargets.slice(0, 1).map((target) => ({
          target,
          text: `${target}会比其他人更早注意到一点只对自己有意义的细节，它足以让你多留一个心眼，但还不足以直接说明真相。`,
        }))
      : [];

    return {
      publicText,
      privateTexts,
      followupHint: `围绕 ${beat.sceneName} 继续推进，给玩家留下主动表态的空间。`,
    };
  }

  private buildCharacterSummary(characters: Character[]): string {
    if (characters.length === 0) return '（暂无调查员角色卡）';
    return characters.map((character) => {
      const backstory = [
        character.backstory?.traits && `特质：${character.backstory.traits}`,
        character.backstory?.ideology && `信念：${character.backstory.ideology}`,
        character.backstory?.significantPeople && `重要之人：${character.backstory.significantPeople}`,
        character.backstory?.significantPlaces && `重要地点：${character.backstory.significantPlaces}`,
      ].filter(Boolean).join('；');
      return `- ${character.name}${character.occupation ? `（${character.occupation}）` : ''}${character.age ? `，${character.age}岁` : ''}${backstory ? `：${backstory}` : ''}`;
    }).join('\n');
  }

  private buildRoomRelationshipSummary(relationships: RoomRelationship[], characters: Character[]): string {
    const links = roomRelationshipsToLinks(relationships, characters);
    if (links.length === 0) return '（暂无显式房间关系）';
    return links.map((link) => `- ${link.participants.join(' / ')}：${link.relationType}${link.notes ? `，${link.notes}` : ''}`).join('\n');
  }

  private buildCombinedLinksSummary(
    assumedLinks: OpeningPlanLink[],
    relationships: RoomRelationship[],
    characters: Character[],
  ): string {
    const explicit = roomRelationshipsToLinks(relationships, characters);
    const all = [...explicit, ...assumedLinks];
    if (all.length === 0) return '（暂无角色关系）';
    return all.map((link) => {
      const meta = [link.source === 'room' ? '显式' : '推断', link.reason].filter(Boolean).join('；');
      return `- ${link.participants.join(' / ')}：${link.relationType}${link.notes ? `，${link.notes}` : ''}${meta ? `（${meta}）` : ''}`;
    }).join('\n');
  }

  private buildDirectorPrefsSummary(prefs: RoomDirectorPrefs): string {
    return [
      `allowSplitOpening=${prefs.allowSplitOpening}`,
      prefs.preferredStartStyle === 'auto'
        ? 'preferredStartStyle=auto（根据调查员职业、背景和人物关系自然判断是否分头或同场开场）'
        : `preferredStartStyle=${prefs.preferredStartStyle}`,
      `allowModuleExpansion=${prefs.allowModuleExpansion}`,
      `expansionLevel=${prefs.expansionLevel}`,
      `privateHookLevel=${prefs.privateHookLevel}`,
      prefs.notes ? `notes=${prefs.notes}` : '',
    ].filter(Boolean).join('\n');
  }

  private buildRulePackSummary(rulePack: ModuleRulePack | null): string {
    if (!rulePack) return '（暂无已审核规则包，默认按公开团处理）';
    return [
      `隐私模式：${rulePack.playPrivacyMode === 'secret' ? '秘密团' : '公开团'}` ,
      rulePack.privacyNotes && `隐私说明：${rulePack.privacyNotes}` ,
      rulePack.sanRules && `理智规则：${rulePack.sanRules}` ,
      rulePack.combatRules && `战斗规则：${rulePack.combatRules}` ,
      rulePack.timeRules && `时间规则：${rulePack.timeRules}` ,
      rulePack.revelationRules && `信息揭示：${rulePack.revelationRules}` ,
      rulePack.forbiddenAssumptions && `禁止假设：${rulePack.forbiddenAssumptions}` ,
      rulePack.freeText && `补充：${rulePack.freeText}` ,
    ].filter(Boolean).join('\n');
  }

  private buildEntitySummary(entities: ScenarioEntity[]): string {
    if (entities.length === 0) return '（暂无已审核关键实体）';
    return entities.slice(0, 8).map((entity) => {
      const parts = [entity.identity, entity.motivation, entity.defaultLocation].filter(Boolean).join('；');
      return `- ${entity.name}${parts ? `：${parts}` : ''}`;
    }).join('\n');
  }

  private buildItemSummary(items: ScenarioItem[]): string {
    if (items.length === 0) return '（暂无已审核关键物品）';
    return items.slice(0, 8).map((item) => {
      const parts = [item.category, item.publicDescription, item.defaultLocation].filter(Boolean).join('；');
      return `- ${item.name}${parts ? `：${parts}` : ''}`;
    }).join('\n');
  }
}

function roomRelationshipsToLinks(relationships: RoomRelationship[], characters: Character[]): OpeningPlanLink[] {
  const byUserId = new Map(characters.map((character) => [character.playerId, character.name]));
  return relationships.map((relationship) => ({
    participants: [
      byUserId.get(relationship.userA) ?? `QQ${relationship.userA}`,
      byUserId.get(relationship.userB) ?? `QQ${relationship.userB}`,
    ],
    relationType: relationship.relationType,
    notes: relationship.notes,
    source: 'room',
  }));
}

function parseJsonResponse(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^<think>[\s\S]*?<\/think>\s*/m, '')
    .trim();
  const codeFenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeFenceMatch?.[1]?.trim() || cleaned;

  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeOpeningSkeleton(
  parsed: Partial<OpeningDirectorPlanSkeleton>,
  input: ResolvedOpeningDirectorInput,
): OpeningDirectorPlanSkeleton {
  const cast = input.characters.map((character) => character.name);
  const castSet = new Set(cast.map(normalizeName));
  const secretMode = getPlayPrivacyMode(input.moduleRulePack) === 'secret';
  const assignments = normalizeAssignments(parsed.initialAssignments, cast, secretMode);
  const beats = normalizeBeats(parsed.beats, cast, assignments, secretMode);
  const mergeGoal = String(parsed.mergeGoal ?? '').trim() || (cast.length > 1
    ? '让调查员从不同入口逐渐意识到，他们面对的是同一桩异样。'
    : '让调查员抓住眼前最值得追查的异样。');
  const assumedLinks = normalizeAssumedLinks(parsed.assumedLinks, castSet);
  const directorSeeds = normalizeDirectorSeeds(parsed.directorSeeds, beats, cast, mergeGoal);

  return {
    startTime: normalizeStartTime(parsed.startTime),
    randomSeed: String(parsed.randomSeed ?? '').trim() || `seed-${Math.random().toString(36).slice(2, 8)}`,
    assumedLinks,
    initialAssignments: assignments,
    beats,
    mergeGoal,
    directorSeeds,
  };
}

function normalizeAssignments(raw: unknown, cast: string[], allowSecretSplit: boolean): OpeningAssignment[] {
  const assignments = Array.isArray(raw) ? raw : [];
  const byTarget = new Map<string, OpeningAssignment>();
  for (const item of assignments) {
    const target = String((item as OpeningAssignment).target ?? '').trim();
    const channelId = allowSecretSplit
      ? normalizeChannelId(String((item as OpeningAssignment).channelId ?? '').trim() || 'main')
      : 'main';
    if (!target) continue;
    byTarget.set(normalizeName(target), { target, channelId });
  }
  for (const target of cast) {
    if (!byTarget.has(normalizeName(target))) {
      byTarget.set(normalizeName(target), { target, channelId: 'main' });
    }
  }
  return Array.from(byTarget.values());
}

function normalizeBeats(
  raw: unknown,
  cast: string[],
  assignments: OpeningAssignment[],
  allowSecretSplit: boolean,
): OpeningBeatSkeleton[] {
  const assignmentMap = new Map(assignments.map((assignment) => [normalizeName(assignment.target), assignment.channelId]));
  const beats = (Array.isArray(raw) ? raw : [])
    .map((item, index) => {
      const beat = item as Partial<OpeningBeatSkeleton>;
      const participants = Array.isArray(beat.participants)
        ? beat.participants.map((participant) => String(participant).trim()).filter(Boolean)
        : [];
      if (participants.length === 0) return null;
      const channelId = allowSecretSplit
        ? normalizeChannelId(String(beat.channelId ?? assignmentMap.get(normalizeName(participants[0])) ?? 'main'))
        : 'main';
      const purpose = beat.purpose === 'hook' || beat.purpose === 'merge_setup' ? beat.purpose : 'intro';
      return {
        id: String(beat.id ?? `beat-${index + 1}`),
        channelId,
        participants,
        sceneName: String(beat.sceneName ?? `开场 ${index + 1}`).trim() || `开场 ${index + 1}`,
        purpose,
        advanceMinutes: clampNumber(Number(beat.advanceMinutes ?? 0), 0, 180),
        sceneState: {
          description: String(beat.sceneState?.description ?? '').trim(),
          activeNpcs: Array.isArray(beat.sceneState?.activeNpcs)
            ? beat.sceneState!.activeNpcs.map((name) => String(name).trim()).filter(Boolean)
            : [],
        },
        privateTargets: allowSecretSplit && Array.isArray(beat.privateTargets)
          ? beat.privateTargets.map((target) => String(target).trim()).filter((target) => participants.some((p) => normalizeName(p) === normalizeName(target)))
          : [],
      } satisfies OpeningBeatSkeleton;
    })
    .filter((beat): beat is OpeningBeatSkeleton => Boolean(beat));

  if (beats.length >= 2) return beats.slice(0, 5);

  const mainParticipants = cast.length > 0 ? cast : ['调查员'];
  return [
    {
      id: 'beat-1',
      channelId: 'main',
      participants: mainParticipants,
      sceneName: '开场',
      purpose: 'intro',
      advanceMinutes: 0,
      sceneState: { description: '调查员以各自合理的方式卷入故事。', activeNpcs: [] },
      privateTargets: [],
    },
    {
      id: 'beat-2',
      channelId: 'main',
      participants: mainParticipants,
      sceneName: '异样浮现',
      purpose: mainParticipants.length > 1 ? 'merge_setup' : 'hook',
      advanceMinutes: 10,
      sceneState: { description: '一条值得追查的异样开始浮现。', activeNpcs: [] },
      privateTargets: [],
    },
  ];
}

function normalizeAssumedLinks(raw: unknown, castSet: Set<string>): OpeningPlanLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => item as Partial<OpeningPlanLink>)
    .map((link) => ({
      participants: Array.isArray(link.participants)
        ? link.participants.map((participant) => String(participant).trim()).filter(Boolean)
        : [],
      relationType: isRelationType(String(link.relationType ?? 'acquainted')) ? String(link.relationType) as OpeningPlanLink['relationType'] : 'acquainted',
      notes: String(link.notes ?? '').trim(),
      source: 'assumed' as const,
      reason: String(link.reason ?? '').trim(),
    }))
    .filter((link) =>
      link.participants.length >= 2 &&
      link.participants.every((participant) => castSet.has(normalizeName(participant))),
    );
}

function normalizeDirectorSeeds(
  raw: unknown,
  beats: OpeningBeatSkeleton[],
  cast: string[],
  mergeGoal: string,
): OpeningDirectorPlanSkeleton['directorSeeds'] {
  const seeds = Array.isArray(raw)
    ? raw.map((item, index) => {
      const seed = item as Partial<OpeningDirectorPlanSkeleton['directorSeeds'][number]>;
      const targets = Array.isArray(seed.targets)
        ? seed.targets.map((target) => String(target).trim()).filter(Boolean)
        : [];
      const channelId = normalizeChannelId(String(seed.channelId ?? beats[0]?.channelId ?? 'main'));
      const kind = ['personal_hook', 'merge_goal', 'npc_hook', 'pressure_clock'].includes(String(seed.kind))
        ? String(seed.kind) as OpeningDirectorPlanSkeleton['directorSeeds'][number]['kind']
        : 'personal_hook';
      return {
        id: String(seed.id ?? `seed-${index + 1}`),
        kind,
        title: String(seed.title ?? `开场种子 ${index + 1}`).trim() || `开场种子 ${index + 1}`,
        description: String(seed.description ?? '').trim() || '等待在后续叙事中自然触发。',
        channelId,
        targets: targets.length > 0 ? targets : cast.slice(0, 1),
        resolved: seed.resolved === true,
      };
    })
    : [];

  if (seeds.length >= 2) return seeds.slice(0, 6);

  return [
    {
      id: 'seed-1',
      kind: 'personal_hook',
      title: '个人引子',
      description: '让至少一名调查员的职业、人设或背景与开场事件发生连接。',
      channelId: beats[0]?.channelId ?? 'main',
      targets: beats[0]?.participants.slice(0, 1) ?? cast.slice(0, 1),
      resolved: false,
    },
    {
      id: 'seed-2',
      kind: 'merge_goal',
      title: '自然汇合',
      description: mergeGoal,
      channelId: beats[beats.length - 1]?.channelId ?? 'main',
      targets: cast,
      resolved: false,
    },
  ];
}

function normalizeStartTime(value: unknown): string {
  const raw = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? raw : DEFAULT_START_TIME;
}

function normalizeChannelId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'main';
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[\s【】（）()：:，,、]/g, '').trim();
}

function getPlayPrivacyMode(rulePack: ModuleRulePack | null | undefined): 'public' | 'secret' {
  return rulePack?.playPrivacyMode === 'secret' ? 'secret' : 'public';
}

function isRelationType(value: string): boolean {
  return ['heard_of', 'acquainted', 'close', 'bound', 'secret_tie'].includes(value);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function shouldUseSplitOpening(input: ResolvedOpeningDirectorInput): boolean {
  if (getPlayPrivacyMode(input.moduleRulePack) !== 'secret') return false;
  if (!input.directorPrefs.allowSplitOpening || input.characters.length <= 1) return false;
  if (input.directorPrefs.preferredStartStyle === 'together') return false;
  if (input.directorPrefs.preferredStartStyle === 'split') return true;
  if (input.directorPrefs.preferredStartStyle === 'mixed') return input.characters.length > 1;

  const occupations = new Set(
    input.characters
      .map((character) => character.occupation?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const relationshipCount = roomRelationshipsToLinks(input.roomRelationships, input.characters).length;
  return input.characters.length >= 3 || occupations.size >= 2 || relationshipCount === 0;
}

function compact(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}
