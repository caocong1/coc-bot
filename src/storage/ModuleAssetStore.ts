import type { Database } from 'bun:sqlite';
import type {
  ModuleExtractionDraftStatus,
  ModuleRulePack,
  ReviewStatus,
  ScenarioAttack,
  ScenarioCombatProfile,
  ScenarioEntity,
  ScenarioEntityRelation,
  ScenarioItem,
} from '@shared/types/ScenarioAssets';

type JsonRecord = Record<string, number>;

interface ModuleEntityRow {
  id: string;
  module_id: string;
  type: string;
  name: string;
  identity: string | null;
  motivation: string | null;
  public_image: string | null;
  hidden_truth: string | null;
  speaking_style: string | null;
  faction: string | null;
  danger_level: string | null;
  default_location: string | null;
  attributes_json: string | null;
  skills_json: string | null;
  combat_json: string | null;
  free_text: string | null;
  relationships_json: string | null;
  is_key: number;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

interface ModuleItemRow {
  id: string;
  module_id: string;
  name: string;
  category: string | null;
  public_description: string | null;
  kp_notes: string | null;
  default_owner: string | null;
  default_location: string | null;
  visibility_condition: string | null;
  usage: string | null;
  is_key: number;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

interface ModuleRulePackRow {
  id: string;
  module_id: string;
  san_rules: string | null;
  combat_rules: string | null;
  death_rules: string | null;
  time_rules: string | null;
  revelation_rules: string | null;
  forbidden_assumptions: string | null;
  free_text: string | null;
  review_status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

export function listModuleEntities(
  db: Database,
  moduleId: string,
  statuses?: ReviewStatus[],
): ScenarioEntity[] {
  const { clause, params } = buildStatusClause(statuses);
  const rows = db.query<ModuleEntityRow, [string, ...string[]]>(
    `SELECT * FROM module_entities WHERE module_id = ?${clause} ORDER BY is_key DESC, created_at ASC`,
  ).all(moduleId, ...params);
  return filterEntityRelationships(rows.map(rowToScenarioEntity));
}

export function getModuleEntity(
  db: Database,
  moduleId: string,
  entityId: string,
): ScenarioEntity | null {
  const row = db.query<ModuleEntityRow, [string, string]>(
    'SELECT * FROM module_entities WHERE module_id = ? AND id = ? LIMIT 1',
  ).get(moduleId, entityId);
  return row ? rowToScenarioEntity(row) : null;
}

export function listModuleItems(
  db: Database,
  moduleId: string,
  statuses?: ReviewStatus[],
): ScenarioItem[] {
  const { clause, params } = buildStatusClause(statuses);
  const rows = db.query<ModuleItemRow, [string, ...string[]]>(
    `SELECT * FROM module_items WHERE module_id = ?${clause} ORDER BY is_key DESC, created_at ASC`,
  ).all(moduleId, ...params);
  return rows.map(rowToScenarioItem);
}

export function getModuleItem(
  db: Database,
  moduleId: string,
  itemId: string,
): ScenarioItem | null {
  const row = db.query<ModuleItemRow, [string, string]>(
    'SELECT * FROM module_items WHERE module_id = ? AND id = ? LIMIT 1',
  ).get(moduleId, itemId);
  return row ? rowToScenarioItem(row) : null;
}

export function getModuleRulePack(
  db: Database,
  moduleId: string,
  statuses?: ReviewStatus[],
): ModuleRulePack | null {
  const { clause, params } = buildStatusClause(statuses);
  const row = db.query<ModuleRulePackRow, [string, ...string[]]>(
    `SELECT * FROM module_rule_packs WHERE module_id = ?${clause} ORDER BY updated_at DESC LIMIT 1`,
  ).get(moduleId, ...params);
  return row ? rowToModuleRulePack(row) : null;
}

export function summarizeModuleDraftStatus(
  db: Database,
  moduleId: string,
): ModuleExtractionDraftStatus {
  const entityRows = db.query<{ review_status: ReviewStatus; count: number }, [string]>(
    'SELECT review_status, COUNT(*) as count FROM module_entities WHERE module_id = ? GROUP BY review_status',
  ).all(moduleId);
  const itemRows = db.query<{ review_status: ReviewStatus; count: number }, [string]>(
    'SELECT review_status, COUNT(*) as count FROM module_items WHERE module_id = ? GROUP BY review_status',
  ).all(moduleId);
  const rulePack = db.query<{ review_status: ReviewStatus }, [string]>(
    'SELECT review_status FROM module_rule_packs WHERE module_id = ? LIMIT 1',
  ).get(moduleId);

  return {
    entities: buildCounters(entityRows),
    items: buildCounters(itemRows),
    rulePack: rulePack?.review_status ?? null,
  };
}

export function rowToScenarioEntity(row: ModuleEntityRow): ScenarioEntity {
  return {
    id: row.id,
    moduleId: row.module_id,
    source: 'module',
    type: row.type === 'creature' ? 'creature' : 'npc',
    name: row.name,
    identity: row.identity ?? '',
    motivation: row.motivation ?? '',
    publicImage: row.public_image ?? '',
    hiddenTruth: row.hidden_truth ?? '',
    speakingStyle: row.speaking_style ?? '',
    faction: row.faction ?? '',
    dangerLevel: row.danger_level ?? '',
    defaultLocation: row.default_location ?? '',
    attributes: parseNumberRecord(row.attributes_json),
    skills: parseNumberRecord(row.skills_json),
    combat: parseCombatProfile(row.combat_json),
    freeText: row.free_text ?? '',
    relationships: parseRelationships(row.relationships_json),
    isKey: row.is_key === 1,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToScenarioItem(row: ModuleItemRow): ScenarioItem {
  return {
    id: row.id,
    moduleId: row.module_id,
    source: 'module',
    name: row.name,
    category: row.category ?? '',
    publicDescription: row.public_description ?? '',
    kpNotes: row.kp_notes ?? '',
    defaultOwner: row.default_owner ?? '',
    defaultLocation: row.default_location ?? '',
    visibilityCondition: row.visibility_condition ?? '',
    usage: row.usage ?? '',
    isKey: row.is_key === 1,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentOwner: row.default_owner ?? '',
    currentLocation: row.default_location ?? '',
  };
}

export function rowToModuleRulePack(row: ModuleRulePackRow): ModuleRulePack {
  return {
    id: row.id,
    moduleId: row.module_id,
    sanRules: row.san_rules ?? '',
    combatRules: row.combat_rules ?? '',
    deathRules: row.death_rules ?? '',
    timeRules: row.time_rules ?? '',
    revelationRules: row.revelation_rules ?? '',
    forbiddenAssumptions: row.forbidden_assumptions ?? '',
    freeText: row.free_text ?? '',
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseNumberRecord(raw: string | null | undefined): JsonRecord {
  const parsed = parseJson(raw, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
  return Object.fromEntries(entries) as JsonRecord;
}

export function parseCombatProfile(raw: string | null | undefined): ScenarioCombatProfile {
  const parsed = parseJson(raw, {}) as Record<string, unknown>;
  const attacks = Array.isArray(parsed.attacks) ? parsed.attacks.map(normalizeAttack).filter(Boolean) as ScenarioAttack[] : [];
  return {
    hp: numberOrNull(parsed.hp),
    armor: numberOrNull(parsed.armor),
    mov: numberOrNull(parsed.mov),
    build: numberOrNull(parsed.build),
    attacks,
  };
}

export function parseRelationships(raw: string | null | undefined): ScenarioEntityRelation[] {
  const parsed = parseJson(raw, []);
  if (!Array.isArray(parsed)) return [];
  const result: ScenarioEntityRelation[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const relation = (item as Record<string, unknown>).relation;
    const targetId = String((item as Record<string, unknown>).targetId ?? '').trim();
    if (!targetId) continue;
    result.push({
      targetId,
      relation: typeof relation === 'string' ? relation as ScenarioEntityRelation['relation'] : 'unknown',
      notes: stringOrEmpty((item as Record<string, unknown>).notes),
    });
  }
  return result;
}

export function filterEntityRelationships(entities: ScenarioEntity[]): ScenarioEntity[] {
  const validIds = new Set(entities.map((entity) => entity.id));
  return entities.map((entity) => ({
    ...entity,
    relationships: entity.relationships.filter((relation) => validIds.has(relation.targetId)),
  }));
}

function buildStatusClause(statuses?: ReviewStatus[]): { clause: string; params: string[] } {
  if (!statuses || statuses.length === 0) return { clause: '', params: [] };
  const normalized = Array.from(new Set(statuses));
  const placeholders = normalized.map(() => '?').join(', ');
  return {
    clause: ` AND review_status IN (${placeholders})`,
    params: normalized,
  };
}

function buildCounters(rows: Array<{ review_status: ReviewStatus; count: number }>) {
  const counters = { draft: 0, approved: 0, rejected: 0 };
  for (const row of rows) {
    counters[row.review_status] = row.count;
  }
  return counters;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeAttack(value: unknown): ScenarioAttack | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const name = stringOrEmpty(record.name);
  const damage = stringOrEmpty(record.damage);
  if (!name && !damage) return null;
  return {
    name,
    skill: numberOrNull(record.skill),
    damage,
    rof: numberOrNull(record.rof),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
