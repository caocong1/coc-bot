export type ReviewStatus = 'draft' | 'approved' | 'rejected';

export type ScenarioEntityType = 'npc' | 'creature';

export type ScenarioRelationType =
  | 'knows'
  | 'hostile'
  | 'dependent'
  | 'ally'
  | 'unknown';

export interface ScenarioAttack {
  name: string;
  skill: number | null;
  damage: string;
  rof: number | null;
}

export interface ScenarioCombatProfile {
  hp: number | null;
  armor: number | null;
  mov: number | null;
  build: number | null;
  attacks: ScenarioAttack[];
}

export interface ScenarioEntityRelation {
  targetId: string;
  relation: ScenarioRelationType;
  notes?: string;
}

export interface ScenarioEntity {
  id: string;
  moduleId: string | null;
  source: 'module' | 'session';
  type: ScenarioEntityType;
  name: string;
  identity: string;
  motivation: string;
  publicImage: string;
  hiddenTruth: string;
  speakingStyle: string;
  faction: string;
  dangerLevel: string;
  defaultLocation: string;
  attributes: Record<string, number>;
  skills: Record<string, number>;
  combat: ScenarioCombatProfile;
  freeText: string;
  relationships: ScenarioEntityRelation[];
  isKey: boolean;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  channelId?: string | null;
  visibility?: string | null;
}

export interface ScenarioItem {
  id: string;
  moduleId: string | null;
  source: 'module' | 'session';
  name: string;
  category: string;
  publicDescription: string;
  kpNotes: string;
  defaultOwner: string;
  defaultLocation: string;
  visibilityCondition: string;
  usage: string;
  isKey: boolean;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  currentOwner?: string | null;
  currentLocation?: string | null;
  stateNotes?: string;
  channelId?: string | null;
  visibility?: string | null;
}

export interface ModuleRulePack {
  id: string;
  moduleId: string;
  sanRules: string;
  combatRules: string;
  deathRules: string;
  timeRules: string;
  revelationRules: string;
  forbiddenAssumptions: string;
  freeText: string;
  reviewStatus: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEntityOverlay extends ScenarioEntity {
  source: 'session';
}

export interface SessionItemOverlay extends ScenarioItem {
  source: 'session';
}

export interface ModuleDraftCounters {
  draft: number;
  approved: number;
  rejected: number;
}

export interface ModuleExtractionDraftStatus {
  entities: ModuleDraftCounters;
  items: ModuleDraftCounters;
  rulePack: ReviewStatus | null;
}
