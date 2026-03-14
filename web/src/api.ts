/**
 * API 请求封装
 */

const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('player_token') ?? new URLSearchParams(location.search).get('token');
}

function getAdminSecret(): string | null {
  return localStorage.getItem('admin_secret');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  auth: 'player' | 'admin' | 'none' = 'player',
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (auth === 'player') {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } else if (auth === 'admin') {
    const secret = getAdminSecret();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Player API ──────────────────────────────────────────────────────────────

export const playerApi = {
  getMe: () => request<{ qqId: number; groupId: number | null; characterCount: number }>('/player/me'),

  listCharacters: () => request<CharacterSummary[]>('/player/characters'),

  createCharacter: (data: CharacterPayload) =>
    request<{ id: string }>('/player/characters', { method: 'POST', body: JSON.stringify(data) }),

  updateCharacter: (id: string, data: CharacterPayload) =>
    request<{ ok: boolean }>(`/player/characters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteCharacter: (id: string) =>
    request<{ ok: boolean }>(`/player/characters/${id}`, { method: 'DELETE' }),

  importExcel: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}/player/characters/import-excel`, {
      method: 'POST', body: formData, headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
      throw new Error(err.error ?? res.statusText);
    }
    return res.json();
  },

  listCampaigns: () => request<CampaignSummary[]>('/player/campaigns'),

  getCampaign: (id: string) => request<CampaignDetail>(`/player/campaigns/${id}`),

  getCampaignMessages: (id: string) => request<Message[]>(`/player/campaigns/${id}/messages`),

  listScenarios: () => request<ScenarioSummary[]>('/player/scenarios'),
  listModules: () => request<ScenarioSummary[]>('/player/modules'),

  // ── 跑团房间 ──────────────────────────────────────────────────────────────
  getRoomTime: (id: string) => request<{ ingameTime: string | null }>(`/player/rooms/${id}/time`),
  getRoomMessages: (id: string) => request<Message[]>(`/player/rooms/${id}/messages`),

  listRooms: () => request<RoomSummary[]>('/player/rooms'),

  createRoom: (data: CreateRoomPayload) =>
    request<{ id: string }>('/player/rooms', { method: 'POST', body: JSON.stringify(data) }),

  getRoom: (id: string) => request<RoomDetail>(`/player/rooms/${id}`),

  deleteRoom: (id: string, force?: boolean) =>
    request<{ ok: boolean }>(`/player/rooms/${id}`, { method: 'DELETE', body: force ? JSON.stringify({ force: true }) : undefined }),

  joinRoom: (id: string) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/join`, { method: 'POST' }),

  setRoomCharacter: (id: string, characterId: string | null) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/character`, { method: 'PUT', body: JSON.stringify({ characterId }) }),

  startRoom: (id: string) =>
    request<{ ok: boolean; summary: string }>(`/player/rooms/${id}/start`, { method: 'POST' }),

  readyRoom: (id: string) =>
    request<{ ok: boolean; readyCount: number; total: number; allReady: boolean }>(`/player/rooms/${id}/ready`, { method: 'POST' }),

  cancelReview: (id: string) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/cancel-review`, { method: 'POST' }),

  updateRoomConstraints: (id: string, data: { scenarioName?: string; constraints: RoomConstraints }) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/constraints`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── 参考数据（公开） ──
  getReference: <T = unknown>(key: string) => request<T>(`/player/reference/${key}`, {}, 'none'),
};

// ─── Admin API ───────────────────────────────────────────────────────────────

export const adminApi = {
  listSessions: () => request<SessionInfo[]>('/admin/sessions', {}, 'admin'),

  startSession: (groupId: number, templateId?: string) =>
    request<{ parts: string[] }>(`/admin/sessions/${groupId}/start`, {
      method: 'POST', body: JSON.stringify({ templateId }),
    }, 'admin'),

  pauseSession: (groupId: number) =>
    request<{ message: string }>(`/admin/sessions/${groupId}/pause`, { method: 'POST' }, 'admin'),

  resumeSession: (groupId: number) =>
    request<{ parts: string[] }>(`/admin/sessions/${groupId}/resume`, { method: 'POST' }, 'admin'),

  stopSession: (groupId: number) =>
    request<{ message: string }>(`/admin/sessions/${groupId}/stop`, { method: 'POST' }, 'admin'),

  setSegment: (groupId: number, segmentId: string) =>
    request<{ ok: boolean }>(`/admin/sessions/${groupId}/segment`, {
      method: 'PUT', body: JSON.stringify({ segmentId }),
    }, 'admin'),

  listClues: (groupId: number) => request<Clue[]>(`/admin/sessions/${groupId}/clues`, {}, 'admin'),

  discoverClue: (groupId: number, clueId: string) =>
    request<{ ok: boolean }>(`/admin/sessions/${groupId}/clues/${clueId}/discover`, { method: 'POST' }, 'admin'),

  injectInfo: (groupId: number, content: string) =>
    request<{ ok: boolean }>(`/admin/sessions/${groupId}/inject`, {
      method: 'POST', body: JSON.stringify({ content }),
    }, 'admin'),

  listKnowledge: () => request<KnowledgeFile[]>('/admin/knowledge', {}, 'admin'),

  listKnowledgeJobs: () => request<ImportJob[]>('/admin/knowledge/jobs', {}, 'admin'),

  uploadKnowledge: async (file: File, category: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    const secret = getAdminSecret();
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch('/api/admin/knowledge/upload', { method: 'POST', body: formData, headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ ok: boolean; filename: string; jobId: string }>;
  },

  deleteKnowledge: (name: string) =>
    request<{ ok: boolean }>('/admin/knowledge/entry', { method: 'DELETE', body: JSON.stringify({ name }) }, 'admin'),

  listKpTemplates: () => request<KpTemplate[]>('/admin/kp-templates', {}, 'admin'),

  createKpTemplate: (data: KpTemplatePayload) =>
    request<{ ok: boolean; id: string }>('/admin/kp-templates', { method: 'POST', body: JSON.stringify(data) }, 'admin'),

  updateKpTemplate: (id: string, data: KpTemplatePayload) =>
    request<{ ok: boolean }>(`/admin/kp-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),

  deleteKpTemplate: (id: string) =>
    request<{ ok: boolean }>(`/admin/kp-templates/${id}`, { method: 'DELETE' }, 'admin'),

  messagesStreamUrl: (groupId: number) => `/api/admin/sessions/${groupId}/messages/stream`,
  getSessionMessages: (groupId: number) => request<Message[]>(`/admin/sessions/${groupId}/messages`, {}, 'admin'),

  listSegments: (groupId: number) => request<SessionSegments>(`/admin/sessions/${groupId}/segments`, {}, 'admin'),

  getTimeline: (groupId: number) => request<TimelineData>(`/admin/sessions/${groupId}/timeline`, {}, 'admin'),

  adjustTime: (groupId: number, data: { type: 'set'; value: string } | { type: 'advance'; minutes: number }) =>
    request<{ ok: boolean; ingameTime: string }>(`/admin/sessions/${groupId}/time`, {
      method: 'POST', body: JSON.stringify(data),
    }, 'admin'),

  listRooms: () => request<AdminRoomSummary[]>('/admin/rooms', {}, 'admin'),
  getRoomDetail: (id: string) => request<AdminRoomDetail>(`/admin/rooms/${id}`, {}, 'admin'),
  confirmRoom: (id: string) => request<{ ok: boolean }>(`/admin/rooms/${id}/confirm`, { method: 'POST' }, 'admin'),
  cancelReview: (id: string) => request<{ ok: boolean }>(`/admin/rooms/${id}/cancel-review`, { method: 'POST' }, 'admin'),
  deleteRoom: (id: string) => request<{ ok: boolean }>(`/admin/rooms/${id}`, { method: 'DELETE' }, 'admin'),
  updateRoomKpSettings: (id: string, data: { templateId?: string; customPrompts?: string }) =>
    request<{ ok: boolean }>(`/admin/rooms/${id}/kp-settings`, { method: 'PATCH', body: JSON.stringify(data) }, 'admin'),

  // ── 模组管理 ──────────────────────────────────────────────────────────────
  listModules: () => request<ScenarioModule[]>('/admin/modules', {}, 'admin'),
  createModule: (data: CreateModulePayload) =>
    request<{ id: string }>('/admin/modules', { method: 'POST', body: JSON.stringify(data) }, 'admin'),
  getModule: (id: string) => request<ModuleDetail>(`/admin/modules/${id}`, {}, 'admin'),
  updateModule: (id: string, data: CreateModulePayload) =>
    request<{ ok: boolean }>(`/admin/modules/${id}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
  deleteModule: (id: string) =>
    request<{ ok: boolean }>(`/admin/modules/${id}`, { method: 'DELETE' }, 'admin'),
  uploadModuleFile: async (moduleId: string, file: File, label?: string, description?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (label) formData.append('label', label);
    if (description) formData.append('description', description);
    const secret = getAdminSecret();
    const headers: Record<string, string> = {};
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(`/api/admin/modules/${moduleId}/files`, { method: 'POST', body: formData, headers });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ ok: boolean; id: string; fileType: string }>;
  },
  deleteModuleFile: (moduleId: string, fileId: string) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/files/${fileId}`, { method: 'DELETE' }, 'admin'),
  generateModuleImage: (moduleId: string, data: { description: string; label?: string; size?: string }) =>
    request<{ ok: boolean; id: string }>(`/admin/modules/${moduleId}/images/generate`, { method: 'POST', body: JSON.stringify(data) }, 'admin'),
  moduleImageUrl: (moduleId: string, fileId: string) => `/api/admin/modules/${moduleId}/images/${fileId}`,
};

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface CharacterSummary {
  id: string;
  name: string;
  occupation: string | null;
  age: number | null;
  hp: number | null;
  san: number | null;
  updatedAt: string;
  readonly: boolean;
}

export interface CharacterPayload {
  name: string;
  occupation?: string;
  age?: number;
  era?: string;
  currency?: string;
  attributes?: Record<string, number>;
  derived?: Record<string, number>;
  skills?: Record<string, number>;
  backstory?: Record<string, string>;
  assets?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CampaignSummary {
  id: string;
  groupId: number;
  status: string;
  currentScene: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface CampaignDetail extends CampaignSummary {
  kpTemplate: string;
  currentScene: { name: string; activeNpcs: string[] } | null;
  discoveredClues: Clue[];
  players: { qqId: number; joinedAt: string }[];
}

export interface Message {
  id: string;
  role: string;
  displayName: string | null;
  content: string;
  timestamp: string;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  era: string | null;
  allowedOccupations: string[];
  minStats: Record<string, number>;
}

export interface ScenarioModule extends ScenarioSummary {
  fileCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleFile {
  id: string;
  filename: string;
  originalName: string;
  fileType: 'document' | 'image';
  label: string | null;
  description: string | null;
  charCount: number;
  chunkCount: number;
  importStatus: 'pending' | 'done' | 'failed';
  importError: string | null;
  createdAt: string;
}

export interface ModuleDetail extends ScenarioModule {
  files: ModuleFile[];
}

export interface CreateModulePayload {
  name: string;
  description?: string;
  era?: string;
  allowedOccupations?: string[];
  minStats?: Record<string, number>;
}

export interface SessionInfo {
  id: string;
  groupId: number;
  status: string;
  kpTemplate: string;
  scenarioFile: string | null;
  currentSegmentId: string | null;
  currentScene: string | null;
  activeNpcs: string[];
  segmentCount: number;
  messageCount: number;
  startedAt: string;
  updatedAt: string;
}

export interface Clue {
  id: string;
  title: string;
  keeperContent?: string;
  playerDescription: string;
  isDiscovered: boolean;
  discoveredAt: string | null;
}

export type KnowledgeCategory = 'rules' | 'scenario' | 'keeper_secret';

export interface KnowledgeFile {
  name: string;
  charCount: number;
  chunkCount: number;
  category: KnowledgeCategory;
  importedAt: string | null;
  title: string | null;
}

export interface ImportJob {
  id: string;
  filename: string;
  category: KnowledgeCategory;
  status: 'pending' | 'done' | 'failed';
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface RoomConstraints {
  era?: string;
  allowedOccupations?: string[];
  minStats?: Record<string, number>;
}

export interface CreateRoomPayload {
  name: string;
  groupId?: number;
  moduleId?: string;
  scenarioName?: string;
  constraints?: RoomConstraints;
}

export interface RoomMember {
  qqId: number;
  joinedAt: string;
  readyAt: string | null;
  isCreator: boolean;
  character: {
    id: string;
    name: string;
    occupation: string | null;
    hp: number | null;
    san: number | null;
    attributes: Record<string, number>;
  } | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  groupId: number | null;
  creatorQqId: number;
  isCreator: boolean;
  scenarioName: string | null;
  constraints: RoomConstraints;
  status: 'waiting' | 'reviewing' | 'running' | 'ended';
  kpSessionId: string | null;
  createdAt: string;
  memberCount: number;
}

export interface RoomDetail extends RoomSummary {
  members: RoomMember[];
  warnings: string[];
}

export interface Segment {
  id: string;
  seq: number;
  title: string;
  summary: string;
  fullText: string;
  charCount: number;
  createdAt: string;
}

export interface SessionSegments {
  currentSegmentId: string | null;
  segments: Segment[];
}

export interface AdminRoomSummary {
  id: string;
  name: string;
  groupId: number | null;
  creatorQqId: number;
  scenarioName: string | null;
  status: 'waiting' | 'reviewing' | 'running' | 'ended';
  kpSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface AdminRoomDetailMember {
  qqId: number;
  characterId: string | null;
  readyAt: string | null;
  joinedAt: string;
  character: {
    id: string;
    name: string;
    occupation: string | null;
    age: number | null;
    hp: number | null;
    san: number | null;
    attributes: Record<string, number>;
    skills: Record<string, number>;
  } | null;
}

export interface AdminRoomDetail extends AdminRoomSummary {
  moduleId: string | null;
  constraints: RoomConstraints;
  kpTemplateId: string;
  kpCustomPrompts: string;
  members: AdminRoomDetailMember[];
  warnings: string[];
  session: {
    id: string;
    groupId: number;
    status: string;
    segmentCount: number;
    messageCount: number;
  } | null;
}

export interface KpTemplate {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  tone: number;
  flexibility: number;
  guidance: number;
  lethality: number;
  pacing: number;
  customPrompts: string;
}

export interface TimelineEvent {
  id: string;
  ingameTime: string;
  deltaMinutes: number | null;
  description: string;
  trigger: 'ai' | 'system' | 'admin';
  messageId: string | null;
  createdAt: string;
}

export interface TimelineData {
  sessionId: string;
  ingameTime: string | null;
  events: TimelineEvent[];
}

export interface KpTemplatePayload {
  name: string;
  description?: string;
  tone?: number;
  flexibility?: number;
  guidance?: number;
  lethality?: number;
  pacing?: number;
  customPrompts?: string;
}
