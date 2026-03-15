import type { Database } from 'bun:sqlite';
import {
  createDefaultRoomDirectorPrefs,
  type RoomDirectorPrefs,
  type RoomRelationship,
  type RoomRelationshipParticipant,
} from '@shared/types/StoryDirector';

interface LegacyRoomRelationshipRow {
  room_id: string;
  user_a: number;
  user_b: number;
  relation_type: string;
  notes: string | null;
}

interface RoomRelationGroupRow {
  id: string;
  room_id: string;
  relation_label: string;
  notes: string | null;
  created_by_qq_id: number | null;
  created_at: string;
  updated_at: string;
}

interface RoomRelationParticipantRow {
  relation_id: string;
  character_id: string;
  character_name: string | null;
  qq_id: number | null;
}

interface BoundRoomCharacterRow {
  character_id: string;
  character_name: string;
  qq_id: number;
}

const LEGACY_RELATION_LABELS: Record<string, string> = {
  heard_of: '听说过',
  acquainted: '旧识',
  close: '熟人',
  bound: '牵连',
  secret_tie: '秘密联系',
};

export interface SaveRoomRelationshipInput {
  participantCharacterIds: string[];
  relationLabel: string;
  notes?: string;
  createdByQqId?: number | null;
}

export function listRoomRelationships(db: Database, roomId: string): RoomRelationship[] {
  ensureLegacyRoomRelationshipsMigrated(db, roomId);
  pruneInvalidRoomRelationships(db, roomId);

  const groups = db.query<RoomRelationGroupRow, [string]>(
    `SELECT id, room_id, relation_label, notes, created_by_qq_id, created_at, updated_at
       FROM campaign_room_relation_groups
      WHERE room_id = ?
      ORDER BY updated_at DESC, created_at DESC, id ASC`,
  ).all(roomId);

  if (groups.length === 0) return [];

  const participants = db.query<RoomRelationParticipantRow, [string]>(
    `SELECT
        p.relation_id,
        p.character_id,
        c.name AS character_name,
        m.qq_id
       FROM campaign_room_relation_participants p
       JOIN campaign_room_relation_groups g ON g.id = p.relation_id
       LEFT JOIN characters c ON c.id = p.character_id
       LEFT JOIN campaign_room_members m
         ON m.room_id = g.room_id
        AND m.character_id = p.character_id
      WHERE g.room_id = ?
      ORDER BY p.relation_id ASC, c.name ASC, p.character_id ASC`,
  ).all(roomId);

  const groupedParticipants = new Map<string, RoomRelationshipParticipant[]>();
  for (const row of participants) {
    if (!row.character_name || row.qq_id == null) continue;
    const list = groupedParticipants.get(row.relation_id) ?? [];
    list.push({
      characterId: row.character_id,
      characterName: row.character_name,
      qqId: row.qq_id,
    });
    groupedParticipants.set(row.relation_id, list);
  }

  return groups
    .map((group) => ({
      id: group.id,
      roomId: group.room_id,
      relationLabel: group.relation_label,
      notes: group.notes ?? '',
      participants: groupedParticipants.get(group.id) ?? [],
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    }))
    .filter((group) => group.participants.length >= 2);
}

export function getRoomRelationship(db: Database, roomId: string, relationId: string): RoomRelationship | null {
  return listRoomRelationships(db, roomId).find((relation) => relation.id === relationId) ?? null;
}

export function createRoomRelationship(
  db: Database,
  roomId: string,
  input: SaveRoomRelationshipInput,
): RoomRelationship {
  ensureLegacyRoomRelationshipsMigrated(db, roomId);
  pruneInvalidRoomRelationships(db, roomId);

  const normalizedCharacterIds = normalizeParticipantCharacterIds(input.participantCharacterIds);
  const relationLabel = normalizeRelationLabel(input.relationLabel);
  validateRoomRelationshipInput(db, roomId, normalizedCharacterIds, relationLabel, null);

  const relationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.run(
      `INSERT INTO campaign_room_relation_groups
         (id, room_id, relation_label, notes, created_by_qq_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [relationId, roomId, relationLabel, normalizeRelationNotes(input.notes), input.createdByQqId ?? null, now, now],
    );
    for (const characterId of normalizedCharacterIds) {
      db.run(
        'INSERT INTO campaign_room_relation_participants (relation_id, character_id) VALUES (?, ?)',
        [relationId, characterId],
      );
    }
  });
  tx();

  return getRoomRelationship(db, roomId, relationId)!;
}

export function updateRoomRelationship(
  db: Database,
  roomId: string,
  relationId: string,
  input: SaveRoomRelationshipInput,
): RoomRelationship {
  ensureLegacyRoomRelationshipsMigrated(db, roomId);
  pruneInvalidRoomRelationships(db, roomId);

  const existing = db.query<{ id: string }, [string, string]>(
    'SELECT id FROM campaign_room_relation_groups WHERE room_id = ? AND id = ?',
  ).get(roomId, relationId);
  if (!existing) {
    throw new Error('人物关系不存在');
  }

  const normalizedCharacterIds = normalizeParticipantCharacterIds(input.participantCharacterIds);
  const relationLabel = normalizeRelationLabel(input.relationLabel);
  validateRoomRelationshipInput(db, roomId, normalizedCharacterIds, relationLabel, relationId);

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.run(
      `UPDATE campaign_room_relation_groups
          SET relation_label = ?, notes = ?, updated_at = ?
        WHERE room_id = ? AND id = ?`,
      [relationLabel, normalizeRelationNotes(input.notes), now, roomId, relationId],
    );
    db.run('DELETE FROM campaign_room_relation_participants WHERE relation_id = ?', [relationId]);
    for (const characterId of normalizedCharacterIds) {
      db.run(
        'INSERT INTO campaign_room_relation_participants (relation_id, character_id) VALUES (?, ?)',
        [relationId, characterId],
      );
    }
  });
  tx();

  return getRoomRelationship(db, roomId, relationId)!;
}

export function deleteRoomRelationship(db: Database, roomId: string, relationId: string): void {
  const tx = db.transaction(() => {
    db.run(
      'DELETE FROM campaign_room_relation_participants WHERE relation_id IN (SELECT id FROM campaign_room_relation_groups WHERE room_id = ? AND id = ?)',
      [roomId, relationId],
    );
    db.run('DELETE FROM campaign_room_relation_groups WHERE room_id = ? AND id = ?', [roomId, relationId]);
  });
  tx();
}

export function deleteRoomRelationshipsByCharacter(db: Database, roomId: string, characterId: string): void {
  const relationIds = db.query<{ relation_id: string }, [string, string]>(
    `SELECT p.relation_id
       FROM campaign_room_relation_participants p
       JOIN campaign_room_relation_groups g ON g.id = p.relation_id
      WHERE g.room_id = ? AND p.character_id = ?`,
  ).all(roomId, characterId).map((row) => row.relation_id);

  if (relationIds.length === 0) return;

  const tx = db.transaction(() => {
    for (const relationId of relationIds) {
      db.run('DELETE FROM campaign_room_relation_participants WHERE relation_id = ? AND character_id = ?', [relationId, characterId]);
    }
    db.run(
      `DELETE FROM campaign_room_relation_groups
        WHERE room_id = ?
          AND id IN (
            SELECT g.id
              FROM campaign_room_relation_groups g
              LEFT JOIN campaign_room_relation_participants p ON p.relation_id = g.id
             WHERE g.room_id = ?
             GROUP BY g.id
            HAVING COUNT(p.character_id) < 2
          )`,
      [roomId, roomId],
    );
  });
  tx();
}

export function countRoomRelationships(db: Database, roomId: string): number {
  ensureLegacyRoomRelationshipsMigrated(db, roomId);
  pruneInvalidRoomRelationships(db, roomId);
  const row = db.query<{ cnt: number }, [string]>(
    'SELECT COUNT(*) as cnt FROM campaign_room_relation_groups WHERE room_id = ?',
  ).get(roomId);
  return row?.cnt ?? 0;
}

export function listRoomBoundCharacters(db: Database, roomId: string): RoomRelationshipParticipant[] {
  return db.query<BoundRoomCharacterRow, [string]>(
    `SELECT m.character_id, c.name AS character_name, m.qq_id
       FROM campaign_room_members m
       JOIN characters c ON c.id = m.character_id
      WHERE m.room_id = ? AND m.character_id IS NOT NULL
      ORDER BY c.name ASC, m.qq_id ASC`,
  ).all(roomId).map((row) => ({
    characterId: row.character_id,
    characterName: row.character_name,
    qqId: row.qq_id,
  }));
}

export function getRoomDirectorPrefs(db: Database, roomId: string): RoomDirectorPrefs {
  const row = db.query<{ director_prefs_json: string | null }, [string]>(
    'SELECT director_prefs_json FROM campaign_rooms WHERE id = ?',
  ).get(roomId);
  return parseRoomDirectorPrefs(row?.director_prefs_json);
}

export function updateRoomDirectorPrefs(
  db: Database,
  roomId: string,
  partial: Partial<RoomDirectorPrefs>,
): RoomDirectorPrefs {
  const merged = {
    ...getRoomDirectorPrefs(db, roomId),
    ...sanitizeRoomDirectorPrefs(partial),
  };
  db.run(
    'UPDATE campaign_rooms SET director_prefs_json = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(merged), new Date().toISOString(), roomId],
  );
  return merged;
}

export function parseRoomDirectorPrefs(raw: string | null | undefined): RoomDirectorPrefs {
  const defaults = createDefaultRoomDirectorPrefs();
  if (!raw?.trim()) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<RoomDirectorPrefs>;
    return {
      ...defaults,
      ...sanitizeRoomDirectorPrefs(parsed),
    };
  } catch {
    return defaults;
  }
}

function sanitizeRoomDirectorPrefs(input: Partial<RoomDirectorPrefs> | null | undefined): Partial<RoomDirectorPrefs> {
  const prefs = input ?? {};
  return {
    allowSplitOpening: typeof prefs.allowSplitOpening === 'boolean' ? prefs.allowSplitOpening : undefined,
    preferredStartStyle: ['auto', 'together', 'split', 'mixed'].includes(String(prefs.preferredStartStyle))
      ? prefs.preferredStartStyle
      : undefined,
    allowModuleExpansion: typeof prefs.allowModuleExpansion === 'boolean' ? prefs.allowModuleExpansion : undefined,
    expansionLevel: ['light', 'medium', 'high'].includes(String(prefs.expansionLevel))
      ? prefs.expansionLevel
      : undefined,
    privateHookLevel: ['none', 'light', 'medium'].includes(String(prefs.privateHookLevel))
      ? prefs.privateHookLevel
      : undefined,
    notes: typeof prefs.notes === 'string' ? prefs.notes.trim() : undefined,
  };
}

function ensureLegacyRoomRelationshipsMigrated(db: Database, roomId: string): void {
  const legacyCount = db.query<{ cnt: number }, [string]>(
    'SELECT COUNT(*) as cnt FROM campaign_room_relationships WHERE room_id = ?',
  ).get(roomId)?.cnt ?? 0;
  if (legacyCount === 0) return;

  const legacyRows = db.query<LegacyRoomRelationshipRow, [string]>(
    `SELECT room_id, user_a, user_b, relation_type, notes
       FROM campaign_room_relationships
      WHERE room_id = ?
      ORDER BY updated_at DESC, user_a ASC, user_b ASC`,
  ).all(roomId);

  const memberCharacters = new Map<number, string>();
  const members = db.query<{ qq_id: number; character_id: string | null }, [string]>(
    'SELECT qq_id, character_id FROM campaign_room_members WHERE room_id = ?',
  ).all(roomId);
  for (const member of members) {
    if (member.character_id) memberCharacters.set(member.qq_id, member.character_id);
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const legacy of legacyRows) {
      const leftCharacterId = memberCharacters.get(legacy.user_a);
      const rightCharacterId = memberCharacters.get(legacy.user_b);
      if (!leftCharacterId || !rightCharacterId || leftCharacterId === rightCharacterId) continue;

      const normalizedCharacterIds = normalizeParticipantCharacterIds([leftCharacterId, rightCharacterId]);
      const relationLabel = LEGACY_RELATION_LABELS[legacy.relation_type] ?? '旧识';
      if (hasDuplicateRoomRelationship(db, roomId, normalizedCharacterIds, relationLabel, null)) continue;

      const relationId = crypto.randomUUID();
      db.run(
        `INSERT INTO campaign_room_relation_groups
           (id, room_id, relation_label, notes, created_by_qq_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [relationId, roomId, relationLabel, normalizeRelationNotes(legacy.notes), legacy.user_a, now, now],
      );
      for (const characterId of normalizedCharacterIds) {
        db.run(
          'INSERT INTO campaign_room_relation_participants (relation_id, character_id) VALUES (?, ?)',
          [relationId, characterId],
        );
      }
    }

    db.run('DELETE FROM campaign_room_relationships WHERE room_id = ?', [roomId]);
  });
  tx();
}

function pruneInvalidRoomRelationships(db: Database, roomId: string): void {
  const tx = db.transaction(() => {
    db.run(
      `DELETE FROM campaign_room_relation_participants
        WHERE relation_id IN (
          SELECT g.id
            FROM campaign_room_relation_groups g
            LEFT JOIN campaign_room_members m
              ON m.room_id = g.room_id
             AND m.character_id = campaign_room_relation_participants.character_id
           WHERE g.room_id = ? AND m.character_id IS NULL
        )`,
      [roomId],
    );

    db.run(
      `DELETE FROM campaign_room_relation_groups
        WHERE room_id = ?
          AND id IN (
            SELECT g.id
              FROM campaign_room_relation_groups g
              LEFT JOIN campaign_room_relation_participants p ON p.relation_id = g.id
             WHERE g.room_id = ?
             GROUP BY g.id
            HAVING COUNT(p.character_id) < 2
          )`,
      [roomId, roomId],
    );
  });
  tx();
}

function validateRoomRelationshipInput(
  db: Database,
  roomId: string,
  participantCharacterIds: string[],
  relationLabel: string,
  excludeRelationId: string | null,
): void {
  if (participantCharacterIds.length < 2) {
    throw new Error('人物关系至少需要选择两张已绑定的角色卡');
  }
  if (!relationLabel) {
    throw new Error('关系名不能为空');
  }

  const availableCharacterIds = new Set(listRoomBoundCharacters(db, roomId).map((participant) => participant.characterId));
  for (const characterId of participantCharacterIds) {
    if (!availableCharacterIds.has(characterId)) {
      throw new Error('只能选择当前房间里已绑定的角色卡');
    }
  }

  if (hasDuplicateRoomRelationship(db, roomId, participantCharacterIds, relationLabel, excludeRelationId)) {
    throw new Error('已存在完全相同参与者和关系名的人物关系');
  }
}

function hasDuplicateRoomRelationship(
  db: Database,
  roomId: string,
  participantCharacterIds: string[],
  relationLabel: string,
  excludeRelationId: string | null,
): boolean {
  const targetKey = participantCharacterIds.join('|');
  return listRoomRelationships(db, roomId).some((relationship) => {
    if (excludeRelationId && relationship.id === excludeRelationId) return false;
    if (normalizeRelationLabel(relationship.relationLabel) !== relationLabel) return false;
    const participantKey = normalizeParticipantCharacterIds(
      relationship.participants.map((participant) => participant.characterId),
    ).join('|');
    return participantKey === targetKey;
  });
}

function normalizeParticipantCharacterIds(characterIds: string[]): string[] {
  return [...new Set(
    characterIds
      .map((characterId) => String(characterId).trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function normalizeRelationLabel(label: string): string {
  return String(label ?? '').trim();
}

function normalizeRelationNotes(notes: string | null | undefined): string {
  return String(notes ?? '').trim();
}
