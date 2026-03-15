import type { Database } from 'bun:sqlite';
import {
  createDefaultRoomDirectorPrefs,
  type RoomDirectorPrefs,
  type RoomRelationship,
  type RoomRelationType,
} from '@shared/types/StoryDirector';

interface RoomRelationshipRow {
  room_id: string;
  user_a: number;
  user_b: number;
  relation_type: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const ROOM_RELATION_TYPES: RoomRelationType[] = [
  'heard_of',
  'acquainted',
  'close',
  'bound',
  'secret_tie',
];

export function normalizeRoomRelationPair(userA: number, userB: number): [number, number] {
  if (userA === userB) {
    throw new Error('不能为自己设置人物关系');
  }
  return userA < userB ? [userA, userB] : [userB, userA];
}

export function isRoomRelationType(value: string): value is RoomRelationType {
  return ROOM_RELATION_TYPES.includes(value as RoomRelationType);
}

export function listRoomRelationships(db: Database, roomId: string): RoomRelationship[] {
  return db.query<RoomRelationshipRow, [string]>(
    `SELECT room_id, user_a, user_b, relation_type, notes, created_at, updated_at
       FROM campaign_room_relationships
      WHERE room_id = ?
      ORDER BY updated_at DESC, user_a ASC, user_b ASC`,
  ).all(roomId).map(rowToRoomRelationship);
}

export function getRoomRelationship(
  db: Database,
  roomId: string,
  userA: number,
  userB: number,
): RoomRelationship | null {
  const [left, right] = normalizeRoomRelationPair(userA, userB);
  const row = db.query<RoomRelationshipRow, [string, number, number]>(
    `SELECT room_id, user_a, user_b, relation_type, notes, created_at, updated_at
       FROM campaign_room_relationships
      WHERE room_id = ? AND user_a = ? AND user_b = ?
      LIMIT 1`,
  ).get(roomId, left, right);
  return row ? rowToRoomRelationship(row) : null;
}

export function upsertRoomRelationship(
  db: Database,
  roomId: string,
  userA: number,
  userB: number,
  relationType: RoomRelationType,
  notes = '',
): RoomRelationship {
  const [left, right] = normalizeRoomRelationPair(userA, userB);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO campaign_room_relationships
       (room_id, user_a, user_b, relation_type, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, user_a, user_b) DO UPDATE SET
       relation_type = excluded.relation_type,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    [roomId, left, right, relationType, notes.trim(), now, now],
  );
  return getRoomRelationship(db, roomId, left, right)!;
}

export function deleteRoomRelationship(
  db: Database,
  roomId: string,
  userA: number,
  userB: number,
): void {
  const [left, right] = normalizeRoomRelationPair(userA, userB);
  db.run(
    'DELETE FROM campaign_room_relationships WHERE room_id = ? AND user_a = ? AND user_b = ?',
    [roomId, left, right],
  );
}

export function countRoomRelationships(db: Database, roomId: string): number {
  const row = db.query<{ cnt: number }, [string]>(
    'SELECT COUNT(*) as cnt FROM campaign_room_relationships WHERE room_id = ?',
  ).get(roomId);
  return row?.cnt ?? 0;
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

function rowToRoomRelationship(row: RoomRelationshipRow): RoomRelationship {
  return {
    roomId: row.room_id,
    userA: row.user_a,
    userB: row.user_b,
    relationType: isRoomRelationType(row.relation_type) ? row.relation_type : 'acquainted',
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
