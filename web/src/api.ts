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
  getMe: () => request<{ qqId: number; characterCount: number }>('/player/me'),

  listCharacters: () => request<CharacterSummary[]>('/player/characters'),

  createCharacter: (data: CharacterPayload) =>
    request<{ id: string }>('/player/characters', { method: 'POST', body: JSON.stringify(data) }),

  updateCharacter: (id: string, data: CharacterPayload) =>
    request<{ ok: boolean }>(`/player/characters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteCharacter: (id: string) =>
    request<{ ok: boolean }>(`/player/characters/${id}`, { method: 'DELETE' }),

  listCampaigns: () => request<CampaignSummary[]>('/player/campaigns'),

  getCampaign: (id: string) => request<CampaignDetail>(`/player/campaigns/${id}`),

  getCampaignMessages: (id: string) => request<Message[]>(`/player/campaigns/${id}/messages`),

  listScenarios: () => request<ScenarioSummary[]>('/player/scenarios'),
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

  listKpTemplates: () => request<KpTemplate[]>('/admin/kp-templates', {}, 'admin'),

  messagesStreamUrl: (groupId: number) => `/api/admin/sessions/${groupId}/messages/stream`,
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
  name: string;
  description: string;
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

export interface KpTemplate {
  id: string;
  name: string;
  description: string;
  humorLevel: number;
  rulesStrictness: number;
  narrativeFlexibility: number;
}
