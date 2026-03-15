export type RoomRelationType =
  | 'heard_of'
  | 'acquainted'
  | 'close'
  | 'bound'
  | 'secret_tie';

export interface RoomRelationship {
  roomId: string;
  userA: number;
  userB: number;
  relationType: RoomRelationType;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type OpeningStartStyle = 'together' | 'split' | 'mixed';
export type OpeningExpansionLevel = 'light' | 'medium' | 'high';
export type OpeningPrivateHookLevel = 'none' | 'light' | 'medium';

export interface RoomDirectorPrefs {
  allowSplitOpening: boolean;
  preferredStartStyle: OpeningStartStyle;
  allowModuleExpansion: boolean;
  expansionLevel: OpeningExpansionLevel;
  privateHookLevel: OpeningPrivateHookLevel;
  notes: string;
}

export interface OpeningPlanLink {
  participants: string[];
  relationType: RoomRelationType;
  notes: string;
  source: 'room' | 'assumed';
  reason?: string;
}

export interface OpeningAssignment {
  target: string;
  channelId: string;
}

export interface OpeningSceneState {
  description: string;
  activeNpcs: string[];
}

export type OpeningBeatPurpose = 'intro' | 'hook' | 'merge_setup';

export interface OpeningBeatSkeleton {
  id: string;
  channelId: string;
  participants: string[];
  sceneName: string;
  purpose: OpeningBeatPurpose;
  advanceMinutes: number;
  sceneState: OpeningSceneState;
  privateTargets: string[];
}

export interface OpeningBeatPrivateText {
  target: string;
  text: string;
}

export interface OpeningBeatText {
  publicText: string;
  privateTexts: OpeningBeatPrivateText[];
  followupHint: string;
}

export type DirectorSeedKind =
  | 'personal_hook'
  | 'merge_goal'
  | 'npc_hook'
  | 'pressure_clock';

export interface DirectorSeed {
  id: string;
  kind: DirectorSeedKind;
  title: string;
  description: string;
  channelId: string;
  targets: string[];
  resolved: boolean;
}

export interface OpeningDirectorPlanSkeleton {
  startTime: string;
  randomSeed: string;
  assumedLinks: OpeningPlanLink[];
  initialAssignments: OpeningAssignment[];
  beats: OpeningBeatSkeleton[];
  mergeGoal: string;
  directorSeeds: DirectorSeed[];
}

export interface OpeningDirectorPlan extends OpeningDirectorPlanSkeleton {
  beatTexts: Record<string, OpeningBeatText>;
}

export type DirectorCueType =
  | 'personal_hook'
  | 'npc_followup'
  | 'time_pressure'
  | 'offscreen_consequence'
  | 'merge_opportunity'
  | 'atmospheric_push';

export interface DirectorCue {
  id: string;
  type: DirectorCueType;
  channelId: string;
  relatedSeedIds: string[];
  reason: string;
  guidance: string;
  boundaries: string;
  issuedAtCycle: number;
}

export function createDefaultRoomDirectorPrefs(): RoomDirectorPrefs {
  return {
    allowSplitOpening: true,
    preferredStartStyle: 'mixed',
    allowModuleExpansion: true,
    expansionLevel: 'medium',
    privateHookLevel: 'light',
    notes: '',
  };
}
