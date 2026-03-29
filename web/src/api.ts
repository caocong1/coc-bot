/**
 * API 请求封装
 */

const BASE = '/api';

function handlePlayerAuthExpired(): void {
  localStorage.removeItem('player_token');
  if (location.pathname.startsWith('/player') || new URLSearchParams(location.search).has('token')) {
    location.replace('/');
  }
}

function handleAdminAuthExpired(): void {
  localStorage.removeItem('admin_secret');
  if (location.pathname.startsWith('/admin')) {
    location.replace('/');
  }
}

function getToken(): string | null {
  return localStorage.getItem('player_token') ?? new URLSearchParams(location.search).get('token');
}

function getAdminSecret(): string | null {
  return localStorage.getItem('admin_secret');
}

function withAdminSecret(url: string): string {
  const secret = getAdminSecret();
  if (!secret) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}admin_secret=${encodeURIComponent(secret)}`;
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
  if (auth === 'player' && res.status === 401) {
    handlePlayerAuthExpired();
    throw new Error('登录已过期');
  }
  if (auth === 'admin' && res.status === 401) {
    handleAdminAuthExpired();
    throw new Error('管理端认证已失效');
  }
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

  getCharacter: (id: string) => request<CharacterDetail>(`/player/characters/${id}`),

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
    if (res.status === 401) {
      handlePlayerAuthExpired();
      throw new Error('登录已过期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
      throw new Error(err.error ?? res.statusText);
    }
    return res.json();
  },

  downloadCharacterTemplate: async () => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}/player/characters/template-excel`, { headers });
    if (res.status === 401) {
      handlePlayerAuthExpired();
      throw new Error('登录已过期');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
      throw new Error(err.error ?? res.statusText);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '[充实车卡版本]空白卡.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  listCampaigns: () => request<CampaignSummary[]>('/player/campaigns'),

  getCampaign: (id: string) => request<CampaignDetail>(`/player/campaigns/${id}`),

  getCampaignMessages: (id: string) => request<Message[]>(`/player/campaigns/${id}/messages`),

  getCampaignRedirect: (id: string) => request<CampaignRedirect>(`/player/campaigns/${id}/redirect`),

  listScenarios: () => request<ScenarioSummary[]>('/player/scenarios'),
  listModules: () => request<ScenarioSummary[]>('/player/modules'),

  // ── 房间（一个房间就是一场跑团） ───────────────────────────────────────
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

  readyRoom: (id: string) =>
    request<{ ok: boolean; readyCount: number; total: number; allReady: boolean }>(`/player/rooms/${id}/ready`, { method: 'POST' }),

  cancelReview: (id: string) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/cancel-review`, { method: 'POST' }),

  updateRoomConstraints: (id: string, data: { scenarioName?: string; constraints: RoomConstraints }) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/constraints`, { method: 'PATCH', body: JSON.stringify(data) }),

  updateRoomModule: (id: string, data: { moduleId: string | null }) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/module`, { method: 'PATCH', body: JSON.stringify(data) }),

  listRoomRelationships: (id: string) =>
    request<RoomRelationship[]>(`/player/rooms/${id}/relationships`),

  createRoomRelationship: (id: string, data: RoomRelationshipInput) =>
    request<RoomRelationship>(`/player/rooms/${id}/relationships`, { method: 'POST', body: JSON.stringify(data) }),

  updateRoomRelationship: (id: string, relationId: string, data: RoomRelationshipInput) =>
    request<RoomRelationship>(`/player/rooms/${id}/relationships/${relationId}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteRoomRelationship: (id: string, relationId: string) =>
    request<{ ok: boolean }>(`/player/rooms/${id}/relationships/${relationId}`, { method: 'DELETE' }),

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
    if (res.status === 401) {
      handleAdminAuthExpired();
      throw new Error('管理端认证已失效');
    }
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

  // AI 配置
  getAIConfig: () => request<AIConfig>('/admin/ai-config', {}, 'admin'),
  updateAIConfig: (patch: Partial<AIConfig>) =>
    request<{ ok: boolean; config: AIConfig }>('/admin/ai-config', { method: 'PUT', body: JSON.stringify(patch) }, 'admin'),

  // AI Provider 管理（新版）
  aiProviders: {
    list: () => request<{ data: AIProvider[] }>('/admin/ai/providers', {}, 'admin'),
    get: (id: string) => request<{ data: AIProvider }>(`/admin/ai/providers/${id}`, {}, 'admin'),
    create: (data: AIProviderPayload) =>
      request<{ data: AIProvider }>('/admin/ai/providers', { method: 'POST', body: JSON.stringify(data) }, 'admin'),
    update: (id: string, data: Partial<AIProviderPayload>) =>
      request<{ data: AIProvider }>(`/admin/ai/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
    delete: (id: string, force = false) =>
      request<{ data: { deleted: boolean } }>(`/admin/ai/providers/${id}?force=${force}`, { method: 'DELETE' }, 'admin'),
    listModels: (providerId: string) =>
      request<{ data: AIModel[] }>(`/admin/ai/providers/${providerId}/models`, {}, 'admin'),
    createModel: (providerId: string, data: AIModelPayload) =>
      request<{ data: AIModel }>(`/admin/ai/providers/${providerId}/models`, { method: 'POST', body: JSON.stringify(data) }, 'admin'),
    updateModel: (providerId: string, modelId: string, data: Partial<AIModelPayload>) =>
      request<{ data: AIModel }>(`/admin/ai/providers/${providerId}/models/${modelId}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
    deleteModel: (providerId: string, modelId: string, force = false) =>
      request<{ data: { deleted: boolean } }>(`/admin/ai/providers/${providerId}/models/${modelId}?force=${force}`, { method: 'DELETE' }, 'admin'),
    listFeatures: () => request<{ data: AIFeatureBinding[] }>('/admin/ai/features', {}, 'admin'),
    updateFeature: (feature: string, data: AIFeatureBindingPayload) =>
      request<{ data: AIFeatureBinding; warning?: string }>('/admin/ai/features', { method: 'PUT', body: JSON.stringify({ feature, ...data }) }, 'admin'),
    getConfigSource: () => request<{ data: { configSource: string } }>('/admin/ai/config-source', {}, 'admin'),
    setConfigSource: (source: 'legacy' | 'providers') =>
      request<{ data: { configSource: string } }>('/admin/ai/config-source', { method: 'PUT', body: JSON.stringify({ source }) }, 'admin'),
  },

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
  getRoomMessages: (id: string) => request<Message[]>(`/admin/rooms/${id}/messages`, {}, 'admin'),
  getRoomTime: (id: string) => request<{ ingameTime: string | null }>(`/admin/rooms/${id}/time`, {}, 'admin'),
  confirmRoom: (id: string) => request<{ ok: boolean }>(`/admin/rooms/${id}/confirm`, { method: 'POST' }, 'admin'),
  cancelReview: (id: string) => request<{ ok: boolean }>(`/admin/rooms/${id}/cancel-review`, { method: 'POST' }, 'admin'),
  deleteRoom: (id: string) => request<{ ok: boolean }>(`/admin/rooms/${id}`, { method: 'DELETE' }, 'admin'),
  updateRoomModule: (id: string, data: { moduleId: string | null }) =>
    request<{ ok: boolean }>(`/admin/rooms/${id}/module`, { method: 'PATCH', body: JSON.stringify(data) }, 'admin'),
  updateRoomKpSettings: (id: string, data: { templateId?: string; customPrompts?: string }) =>
    request<{ ok: boolean }>(`/admin/rooms/${id}/kp-settings`, { method: 'PATCH', body: JSON.stringify(data) }, 'admin'),
  listRoomRelationships: (id: string) =>
    request<RoomRelationship[]>(`/admin/rooms/${id}/relationships`, {}, 'admin'),
  createRoomRelationship: (id: string, data: RoomRelationshipInput) =>
    request<RoomRelationship>(`/admin/rooms/${id}/relationships`, { method: 'POST', body: JSON.stringify(data) }, 'admin'),
  updateRoomRelationship: (id: string, relationId: string, data: RoomRelationshipInput) =>
    request<RoomRelationship>(`/admin/rooms/${id}/relationships/${relationId}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
  deleteRoomRelationship: (id: string, relationId: string) =>
    request<{ ok: boolean }>(`/admin/rooms/${id}/relationships/${relationId}`, { method: 'DELETE' }, 'admin'),

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
    if (res.status === 401) {
      handleAdminAuthExpired();
      throw new Error('管理端认证已失效');
    }
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ ok: boolean; id: string; fileType: string }>;
  },
  deleteModuleFile: (moduleId: string, fileId: string) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/files/${fileId}`, { method: 'DELETE' }, 'admin'),
  generateModuleImage: (moduleId: string, data: { description: string; label?: string; size?: string }) =>
    request<{ ok: boolean; id: string }>(`/admin/modules/${moduleId}/images/generate`, { method: 'POST', body: JSON.stringify(data) }, 'admin'),
  regenerateModuleImage: (moduleId: string, imageId: string, data?: { description?: string; label?: string; size?: string }) =>
    request<{ ok: boolean; id: string; createdAt: string; label: string }>(`/admin/modules/${moduleId}/images/${imageId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }, 'admin'),
  moduleImageUrl: (moduleId: string, fileId: string) => withAdminSecret(`/api/admin/modules/${moduleId}/images/${fileId}`),
  adminAssetUrl: (url: string) => withAdminSecret(url),
  listModuleEntities: (moduleId: string, status?: ReviewStatus[]) =>
    request<ScenarioEntity[]>(`/admin/modules/${moduleId}/entities${status?.length ? `?status=${status.join(',')}` : ''}`, {}, 'admin'),
  createModuleEntity: (moduleId: string, data: Partial<ScenarioEntity>) =>
    request<{ id: string }>(`/admin/modules/${moduleId}/entities`, { method: 'POST', body: JSON.stringify(data) }, 'admin'),
  getModuleEntity: (moduleId: string, entityId: string) =>
    request<ScenarioEntity>(`/admin/modules/${moduleId}/entities/${entityId}`, {}, 'admin'),
  updateModuleEntity: (moduleId: string, entityId: string, data: Partial<ScenarioEntity>) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/entities/${entityId}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
  deleteModuleEntity: (moduleId: string, entityId: string) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/entities/${entityId}`, { method: 'DELETE' }, 'admin'),
  reviewModuleEntity: (moduleId: string, entityId: string, reviewStatus: ReviewStatus) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/entities/${entityId}/review`, { method: 'POST', body: JSON.stringify({ reviewStatus }) }, 'admin'),
  listModuleItems: (moduleId: string, status?: ReviewStatus[]) =>
    request<ScenarioItem[]>(`/admin/modules/${moduleId}/items${status?.length ? `?status=${status.join(',')}` : ''}`, {}, 'admin'),
  createModuleItem: (moduleId: string, data: Partial<ScenarioItem>) =>
    request<{ id: string }>(`/admin/modules/${moduleId}/items`, { method: 'POST', body: JSON.stringify(data) }, 'admin'),
  getModuleItem: (moduleId: string, itemId: string) =>
    request<ScenarioItem>(`/admin/modules/${moduleId}/items/${itemId}`, {}, 'admin'),
  updateModuleItem: (moduleId: string, itemId: string, data: Partial<ScenarioItem>) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
  deleteModuleItem: (moduleId: string, itemId: string) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/items/${itemId}`, { method: 'DELETE' }, 'admin'),
  reviewModuleItem: (moduleId: string, itemId: string, reviewStatus: ReviewStatus) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/items/${itemId}/review`, { method: 'POST', body: JSON.stringify({ reviewStatus }) }, 'admin'),
  getModuleRulePack: (moduleId: string, status?: ReviewStatus[]) =>
    request<ModuleRulePack | null>(`/admin/modules/${moduleId}/rule-pack${status?.length ? `?status=${status.join(',')}` : ''}`, {}, 'admin'),
  updateModuleRulePack: (moduleId: string, data: Partial<ModuleRulePack>) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/rule-pack`, { method: 'PUT', body: JSON.stringify(data) }, 'admin'),
  reviewModuleRulePack: (moduleId: string, reviewStatus: ReviewStatus) =>
    request<{ ok: boolean }>(`/admin/modules/${moduleId}/rule-pack/review`, { method: 'POST', body: JSON.stringify({ reviewStatus }) }, 'admin'),
};

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export interface CharacterSummary {
  id: string;
  name: string;
  occupation: string | null;
  age: number | null;
  era: string | null;
  hp: number | null;
  san: number | null;
  primaryAttributeTotal: number | null;
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

export interface CharacterDetail extends CharacterPayload {
  id: string;
  updatedAt: string;
  readonly: boolean;
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

export interface CampaignRedirect {
  sessionId: string;
  roomId: string | null;
  archived: boolean;
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
  totalPoints: number | null;
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

export type ReviewStatus = 'draft' | 'approved' | 'rejected';

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
  relation: string;
  notes?: string;
}

export interface ScenarioEntity {
  id: string;
  moduleId: string | null;
  source: 'module' | 'session';
  type: 'npc' | 'creature';
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
}

export interface ModuleRulePack {
  id: string;
  moduleId: string;
  playPrivacyMode: 'public' | 'secret';
  privacyNotes: string;
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

export interface ModuleSceneImage {
  id: string;
  source: 'module_file' | 'document_extract' | 'document_generated';
  label: string;
  description: string | null;
  url: string;
  createdAt: string;
  sourceFileId: string | null;
  sourceFileName: string | null;
  canDelete: boolean;
  canRegenerate: boolean;
}

export interface ModuleDetail extends ScenarioModule {
  files: ModuleFile[];
  images: ModuleSceneImage[];
  entities: ScenarioEntity[];
  items: ScenarioItem[];
  rulePack: ModuleRulePack | null;
  extractionDraftStatus: ModuleExtractionDraftStatus;
}

export interface CreateModulePayload {
  name: string;
  description?: string;
  era?: string;
  allowedOccupations?: string[];
  totalPoints?: number | null;
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
  totalPoints?: number | null;
}

export interface CreateRoomPayload {
  name: string;
  groupId?: number;
  moduleId?: string;
  scenarioName?: string;
  constraints?: RoomConstraints;
}

export interface RoomRelationshipParticipant {
  characterId: string;
  characterName: string;
  qqId: number;
}

export interface RoomRelationshipInput {
  participantCharacterIds: string[];
  relationLabel: string;
  notes?: string;
}

export interface RoomRelationship {
  id: string;
  roomId: string;
  relationLabel: string;
  notes: string;
  participants: RoomRelationshipParticipant[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  groupId: number | null;
  creatorQqId: number;
  isCreator: boolean;
  moduleId: string | null;
  scenarioName: string | null;
  constraints: RoomConstraints;
  status: 'waiting' | 'reviewing' | 'running' | 'ended';
  kpSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface RoomRuntimeSummary {
  sessionId: string;
  groupId: number;
  status: string;
  ingameTime: string | null;
  messageCount: number;
  segmentCount: number;
  startedAt: string;
}

export interface RoomCharacterView {
  id: string;
  name: string;
  occupation: string | null;
  age?: number | null;
  hp: number | null;
  san: number | null;
  attributes: Record<string, number>;
  skills?: Record<string, number>;
}

export interface RoomMemberView {
  qqId: number;
  joinedAt: string;
  readyAt: string | null;
  isCreator: boolean;
  character: RoomCharacterView | null;
}

export interface RoomDetailView extends RoomSummary {
  members: RoomMemberView[];
  warnings: string[];
  relationships: RoomRelationship[];
  runtime: RoomRuntimeSummary | null;
}

export interface RoomDetail extends RoomDetailView {
}

export interface RoomAdminPanelData {
  kpTemplateId: string;
  kpCustomPrompts: string;
}

export interface AdminRoomDetail extends RoomDetailView {
  moduleId: string | null;
  adminPanel: RoomAdminPanelData;
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

export type AdminRoomDetailMember = RoomMemberView;

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

// ─── AI Config ────────────────────────────────────────────────────────────────

export type LegacyAIProvider = 'dashscope' | 'openlimits';

export interface AIConfig {
  provider: LegacyAIProvider;
  chatModel: string;
  guardrailModel: string;
  openingModel: string;
  recapModel: string;
  imagePromptModel: string;
  embedModel: string;
  capabilities: {
    imageGeneration: boolean;
    embedding: boolean;
  };
}

// ─── AI Provider 配置系统（新版）─────────────────────────────────────────────

export type AIProviderType = 'openai-compatible' | 'openai-responses' | 'anthropic' | 'ollama' | 'dashscope' | 'opencode';
export type AuthType = 'bearer' | 'basic' | 'none';

export interface AIModelCapabilities {
  supportsChat: boolean;
  supportsVision: boolean;
  supportsImageGeneration: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  contextWindow?: number;
}

export interface AIProvider {
  id: string;
  type: AIProviderType;
  name: string;
  baseUrl?: string;
  credentialsEncrypted: string | null;
  authType: AuthType;
  providerOptionsJson: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface AIModel {
  id: string;
  providerId: string;
  modelId: string;
  name: string;
  capabilities: AIModelCapabilities;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export type FeatureId =
  | 'kp.chat' | 'kp.guardrail' | 'kp.opening' | 'kp.recap'
  | 'image.prompt' | 'image.generate'
  | 'knowledge.embedding'
  | 'fun.jrrp' | 'fun.v50' | 'fun.gugu'
  | 'module.extract';

export interface SingleRoutingPolicy {
  type: 'single';
  providerId: string;
  modelId: string;
}

export interface FallbackRoutingPolicy {
  type: 'fallback';
  primary: { providerId: string; modelId: string };
  fallback: { providerId: string; modelId: string };
  fallbackOnRateLimit: boolean;
}

export type RoutingPolicy = SingleRoutingPolicy | FallbackRoutingPolicy;

export interface AIFeatureBinding {
  feature: FeatureId;
  routingPolicy: RoutingPolicy;
  fallbackOnRateLimit: boolean;
  updatedAt: number;
}

export interface ProviderCredentials {
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface AIProviderPayload {
  type: AIProviderType;
  name: string;
  baseUrl?: string;
  credentials?: ProviderCredentials;
  authType?: AuthType;
  providerOptionsJson?: string;
}

export interface AIModelPayload {
  modelId: string;
  name: string;
  capabilities: AIModelCapabilities;
}

export interface AIFeatureBindingPayload {
  routingPolicy: RoutingPolicy;
  fallbackOnRateLimit?: boolean;
}
