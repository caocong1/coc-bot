import type { DirectorCue, DirectorCueType, DirectorSeed, OpeningAssignment } from '@shared/types/StoryDirector';
import type { SessionSnapshot } from './SessionState';

export interface SessionDirectorInput {
  snapshot: SessionSnapshot;
  upcomingCycle: number;
  idleCycleStreak: number;
}

const CUE_COOLDOWN_CYCLES = 3;

export class SessionDirector {
  maybeCreateCue(input: SessionDirectorInput): DirectorCue | null {
    if (input.idleCycleStreak < 2) return null;

    const candidates = this.buildCandidates(input.snapshot);
    for (const candidate of candidates) {
      if (this.isCueTypeCooling(candidate.type, input.snapshot.recentDirectorCues, input.upcomingCycle)) {
        continue;
      }
      return {
        id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        issuedAtCycle: input.upcomingCycle,
        ...candidate,
      };
    }
    return null;
  }

  private buildCandidates(snapshot: SessionSnapshot): Array<Omit<DirectorCue, 'id' | 'issuedAtCycle'>> {
    const focusChannelId = snapshot.focusChannelId;
    const focusSeeds = snapshot.unresolvedDirectorSeeds.filter((seed) => seed.channelId === focusChannelId);
    const mergeSeeds = snapshot.unresolvedDirectorSeeds.filter((seed) => seed.kind === 'merge_goal');

    const candidates: Array<Omit<DirectorCue, 'id' | 'issuedAtCycle'>> = [];

    if (snapshot.activeChannels.length > 1 && (snapshot.openingMergeGoal || mergeSeeds.length > 0)) {
      candidates.push(this.buildMergeOpportunityCue(focusChannelId, mergeSeeds, snapshot.openingMergeGoal));
    }

    const personalSeed = focusSeeds.find((seed) => seed.kind === 'personal_hook');
    if (personalSeed) {
      candidates.push({
        type: 'personal_hook',
        channelId: focusChannelId,
        relatedSeedIds: [personalSeed.id],
        reason: `当前频道已经连续停滞，适合重新触发 ${personalSeed.title}`,
        guidance: `围绕“${personalSeed.title}”给这个频道一个新的个人化牵引，可以是一通来电、一份旧识消息、一个突然想起的委托细节或与其背景相关的异样，但不要替玩家做决定。`,
        boundaries: '允许补充合理的私人引子和生活细节；不要改写模组真相，不要直接送出终局答案。',
      });
    }

    const npcSeed = focusSeeds.find((seed) => seed.kind === 'npc_hook');
    if (npcSeed) {
      candidates.push({
        type: 'npc_followup',
        channelId: focusChannelId,
        relatedSeedIds: [npcSeed.id],
        reason: `需要让 NPC 线索重新动起来：${npcSeed.title}`,
        guidance: `安排一个与“${npcSeed.title}”有关的 NPC 跟进，可以是回电、登门、拦路、转述消息或态度变化，让调查员获得新的反应空间。`,
        boundaries: '允许补充模组内合理的 NPC 行为和过场；不要让 NPC 直接公布所有真相。',
      });
    }

    const pressureSeed = focusSeeds.find((seed) => seed.kind === 'pressure_clock');
    if (pressureSeed || snapshot.ingameTime) {
      candidates.push({
        type: 'time_pressure',
        channelId: focusChannelId,
        relatedSeedIds: pressureSeed ? [pressureSeed.id] : [],
        reason: pressureSeed
          ? `需要重新提醒时间压力：${pressureSeed.title}`
          : '当前局面停滞，需要外界时程推着调查继续前进',
        guidance: '通过天色、营业时间、约定时限、天气变化、交通班次或即将错过的会面制造有限的时间压力，让玩家感到局面正在向前流动。',
        boundaries: '只制造压力，不替玩家选择路线；不要把时间压力写成必死倒计时。',
      });
    }

    if (snapshot.activeEntities.length > 0) {
      const entity = snapshot.activeEntities[0];
      candidates.push({
        type: 'npc_followup',
        channelId: focusChannelId,
        relatedSeedIds: [],
        reason: `场景中已有可利用的实体：${entity.name}`,
        guidance: `让 ${entity.name} 有一个简短但有效的跟进行为，推动调查员重新表态或获得新的小信息。`,
        boundaries: '允许延展实体的公开行为与态度；不要凭空增加与其设定矛盾的能力或秘密。',
      });
    }

    candidates.push({
      type: 'offscreen_consequence',
      channelId: focusChannelId,
      relatedSeedIds: [],
      reason: '局面停滞，需要让场外世界给出回声',
      guidance: '用电话、邻居议论、报纸消息、远处动静或他处的结果反馈说明世界在继续运转，为当前频道制造新的可响应信息。',
      boundaries: '可以补充模组内合理的场外后果；不要用场外事件直接替代关键线索链。',
    });

    candidates.push({
      type: 'atmospheric_push',
      channelId: focusChannelId,
      relatedSeedIds: [],
      reason: '仍需轻推节奏，但不适合强行导入实体或时间压力',
      guidance: '补一小段氛围、异常感或微妙动静，暗示有值得继续跟进的细节，再把话语权交还给玩家。',
      boundaries: '只做轻推，不直接给编号选项，不替玩家决定行动。',
    });

    return candidates;
  }

  private buildMergeOpportunityCue(
    focusChannelId: string,
    mergeSeeds: DirectorSeed[],
    mergeGoal: string | null,
  ): Omit<DirectorCue, 'id' | 'issuedAtCycle'> {
    return {
      type: 'merge_opportunity',
      channelId: focusChannelId,
      relatedSeedIds: mergeSeeds.map((seed) => seed.id),
      reason: mergeGoal
        ? `多频道分头持续过久，需要制造自然汇合机会：${mergeGoal}`
        : '多频道分头持续过久，需要制造自然汇合机会',
      guidance: mergeGoal
        ? `创造一个能让调查员自然靠近“${mergeGoal}”的契机，例如同一通电话、同一地点的目击、共同需要确认的地址或同一位联系人。`
        : '创造一个合理的汇合契机，例如共享线索、共同联系人或同一地点的新动静，让分头调查有机会重新汇流。',
      boundaries: '允许制造自然的会合机会；不要强制所有人立刻汇合，不要瞬移角色。',
    };
  }

  private isCueTypeCooling(type: DirectorCueType, cues: DirectorCue[], upcomingCycle: number): boolean {
    const latestSameType = [...cues]
      .reverse()
      .find((cue) => cue.type === type);
    if (!latestSameType) return false;
    return upcomingCycle - latestSameType.issuedAtCycle <= CUE_COOLDOWN_CYCLES;
  }
}

export function buildOpeningAssignmentsByTarget(assignments: OpeningAssignment[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const assignment of assignments) {
    map.set(normalizeTarget(assignment.target), assignment.channelId);
  }
  return map;
}

function normalizeTarget(value: string): string {
  return value.toLowerCase().replace(/[\s【】（）()：:，,、]/g, '').trim();
}
