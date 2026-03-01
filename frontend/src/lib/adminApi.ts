import type { FullGameData } from '../types';

const API_BASE = '/api';

function getAdminSecret(): string | null {
  return sessionStorage.getItem('sandlot_admin_secret');
}

export function setAdminSecret(secret: string): void {
  sessionStorage.setItem('sandlot_admin_secret', secret);
}

export function clearAdminSecret(): void {
  sessionStorage.removeItem('sandlot_admin_secret');
}

export function isAdminAuthenticated(): boolean {
  return !!getAdminSecret();
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
      ...options.headers,
    },
  });

  if (res.status === 401 || res.status === 403) {
    clearAdminSecret();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// --- Types ---

export interface ChallengeHealth {
  rounds: number;
  roundsReady: boolean;
  playerSlots: number;
  blurbsMissing: number;
  blurbsReady: boolean;
  portraitsMissing: number;
  portraitsReady: boolean;
}

export interface PipelineChallenge {
  id: number;
  challengeDate: string;
  positionOrder: string[];
  status: string;
  theme: string | null;
  queuePosition: number | null;
  createdAt: string;
  publishedAt: string | null;
  enrichmentPhase: 'blurbs' | 'portraits' | 'preseed' | null;
  health: ChallengeHealth;
}

export interface HistoryChallenge {
  id: number;
  challengeDate: string;
  theme: string | null;
  status: string;
  createdAt: string;
  playerCount: number;
  avgScore: number | null;
  bestScore: number | null;
}

export interface DetailedHealth {
  challengeId: number;
  status: string;
  rounds: number;
  roundsExpected: number;
  roundsReady: boolean;
  playerSlots: number;
  playerSlotsExpected: number;
  blurbs: { present: number; missing: number; total: number };
  blurbsReady: boolean;
  portraits: { present: number; missing: number; total: number };
  portraitsReady: boolean;
  legendScoreRange: { min: number; max: number } | null;
  drafts: { total: number; preseed: number; real: number };
  draftsReady: boolean;
}

export interface YearScore {
  year: number;
  zScorePosition: number;
  legendScore: number;
  team: string;
}

export interface AdminRoundOption {
  id: number;
  roundId: number;
  playerSlot: number;
  playerId: string;
  playerName: string;
  yearOptions: number[];
  portraitUrl: string | null;
  blurbs: Record<string, string> | null;
  yearScores: YearScore[];
}

export interface AdminRound {
  id: number;
  challengeId: number;
  roundNumber: number;
  position: string;
  options: AdminRoundOption[];
}

export interface AdminChallengeDetail {
  challenge: {
    id: number;
    challengeDate: string;
    positionOrder: string[];
    status: string;
    theme: string | null;
  };
  rounds: AdminRound[];
}

// --- API Functions ---

export async function getPipeline(): Promise<{ challenges: PipelineChallenge[] }> {
  return adminFetch('/admin/challenges/pipeline');
}

export async function getHistory(): Promise<{ challenges: HistoryChallenge[] }> {
  return adminFetch('/admin/challenges/history');
}

export async function getChallengeDetail(id: number): Promise<AdminChallengeDetail> {
  return adminFetch(`/admin/challenges/${id}`);
}

export async function getChallengeHealth(id: number): Promise<DetailedHealth> {
  return adminFetch(`/admin/challenges/${id}/health`);
}

export async function generateChallenge(count = 1, theme?: string): Promise<{ challengeIds: number[]; count: number }> {
  return adminFetch('/admin/challenges/generate', {
    method: 'POST',
    body: JSON.stringify({ count, theme }),
  });
}

export async function generateThemedBatch(count = 25): Promise<{ challengeIds: number[]; count: number; themes: string[] }> {
  return adminFetch('/admin/challenges/generate-themed', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

export async function generateBlurbs(id: number): Promise<{ generated: number; failed: number }> {
  return adminFetch(`/admin/challenges/${id}/blurbs`, { method: 'POST' });
}

export async function preseedStats(id: number, count?: number): Promise<{ roundsSeeded: number; totalPicks: number; syntheticSessions: number }> {
  return adminFetch(`/admin/challenges/${id}/preseed`, {
    method: 'POST',
    body: JSON.stringify(count != null ? { count } : {}),
  });
}

export async function generatePortraits(id: number): Promise<{ generated: number; skipped: number; failed: number }> {
  return adminFetch(`/admin/challenges/${id}/portraits`, { method: 'POST' });
}

export async function updateChallenge(id: number, updates: {
  status?: string;
  theme?: string;
  challengeDate?: string;
}): Promise<{ challenge: PipelineChallenge }> {
  return adminFetch(`/admin/challenges/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteChallenge(id: number): Promise<{ deleted: boolean }> {
  return adminFetch(`/admin/challenges/${id}`, { method: 'DELETE' });
}

export async function queueChallenges(challengeIds: number[]): Promise<{ queued: number }> {
  return adminFetch('/admin/challenges/queue', {
    method: 'POST',
    body: JSON.stringify({ challengeIds }),
  });
}

export async function dequeueChallenges(challengeId: number): Promise<{ dequeued: boolean }> {
  return adminFetch('/admin/challenges/dequeue', {
    method: 'POST',
    body: JSON.stringify({ challengeId }),
  });
}

export async function reorderQueue(challengeIds: number[]): Promise<{ reordered: number }> {
  return adminFetch('/admin/challenges/reorder', {
    method: 'POST',
    body: JSON.stringify({ challengeIds }),
  });
}

export async function promoteNext(): Promise<{ activated: number | null; completed: number }> {
  return adminFetch('/admin/promote-next', { method: 'POST' });
}

export async function forceActivate(challengeId: number): Promise<{ activated: number; deactivated: number | null }> {
  return adminFetch(`/admin/challenges/${challengeId}/activate`, { method: 'POST' });
}

export async function startPlaytest(challengeId: number): Promise<FullGameData> {
  return adminFetch(`/admin/challenges/${challengeId}/playtest`, { method: 'POST' });
}

// --- Stats ---

export interface TodayStats {
  active: boolean;
  challengeId?: number;
  theme?: string | null;
  sessions?: { started: number; completed: number; completionRate: number };
  avgScore?: number;
  scoreDistribution?: number[];
  roundStats?: Array<{
    roundNumber: number;
    position: string;
    mostPicked: { playerName: string; pickCount: number; portraitUrl: string | null; selectedYear: number; team: string | null } | null;
  }>;
}

export interface DailyStat {
  date: string;
  challengeId: number;
  theme: string | null;
  completions: number;
  uniqueUsers: number;
  avgScore: number;
}

export async function getTodayStats(): Promise<TodayStats> {
  return adminFetch('/admin/stats/today');
}

export async function getHistoryStats(days = 30): Promise<{ days: number; stats: DailyStat[] }> {
  return adminFetch(`/admin/stats/history?days=${days}`);
}

// --- Bake ---

export interface BakeResult {
  blurbs: { generated: number; failed: number };
  portraits: { generated: number; skipped: number; failed: number };
  preseed: { roundsSeeded: number; totalPicks: number; syntheticSessions: number };
}

export async function bakeChallenge(id: number): Promise<BakeResult> {
  return adminFetch(`/admin/challenges/${id}/bake`, { method: 'POST' });
}

export function streamBakeAll(onEvent: (event: Record<string, unknown>) => void): { abort: () => void } {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const controller = new AbortController();

  fetch(`${API_BASE}/admin/challenges/bake-all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', error: `HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', error: String(err) });
    }
  });

  return { abort: () => controller.abort() };
}

// --- Agent Session State (shared with AgentChatPanel) ---

export type AgentPhase = 'idle' | 'thinking' | 'searching' | 'building' | 'submitting';

export interface AgentChatMessage {
  id: number;
  type: 'user' | 'agent' | 'tool' | 'success' | 'error' | 'proposal';
  text: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  proposal?: ProposalData;
  streaming?: boolean; // true while message_delta tokens are still arriving
}

export interface AgentSessionState {
  sessionId: string | null;
  challengeTitle: string | null;
  messages: AgentChatMessage[];
  awaitingFeedback: boolean;
  running: boolean;
  phase: AgentPhase;
  startedAt: number | null;
  nextMsgId: number;
}

export const INITIAL_SESSION_STATE: AgentSessionState = {
  sessionId: null,
  challengeTitle: null,
  messages: [],
  awaitingFeedback: false,
  running: false,
  phase: 'idle',
  startedAt: null,
  nextMsgId: 0,
};

// --- Reducer for atomic state updates (fixes stale closure race condition) ---

export type AgentAction =
  | { type: 'SESSION'; sessionId: string }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'AGENT_MESSAGE'; text: string }
  | { type: 'MESSAGE_DELTA'; delta: string }
  | { type: 'TOOL_CALL'; text: string; toolName: string; toolArgs?: Record<string, unknown> }
  | { type: 'PROPOSAL'; text: string; proposal: ProposalData }
  | { type: 'AWAITING_FEEDBACK'; sessionId?: string }
  | { type: 'SUCCESS'; text: string }
  | { type: 'ERROR'; text: string }
  | { type: 'ERROR_RECOVERABLE'; text: string }
  | { type: 'COMPLETE' }
  | { type: 'START_RUNNING' }
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'RESET' };

function addMsg(state: AgentSessionState, msg: Omit<AgentChatMessage, 'id'>): AgentSessionState {
  const id = state.nextMsgId + 1;
  return { ...state, messages: [...state.messages, { ...msg, id }], nextMsgId: id };
}

function phaseFromTool(toolName: string): AgentPhase {
  if (toolName === 'search_players' || toolName === 'query_players') return 'searching';
  if (toolName === 'preview_challenge') return 'building';
  if (toolName === 'submit_challenge') return 'submitting';
  return 'thinking';
}

/** Finalize any in-progress streaming message (set streaming=false) */
function finalizeStream(state: AgentSessionState): AgentSessionState {
  const last = state.messages[state.messages.length - 1];
  if (!last?.streaming) return state;
  return { ...state, messages: [...state.messages.slice(0, -1), { ...last, streaming: false }] };
}

export function agentReducer(state: AgentSessionState, action: AgentAction): AgentSessionState {
  // Finalize any streaming message when a non-delta action arrives
  if (action.type !== 'MESSAGE_DELTA') {
    state = finalizeStream(state);
  }

  switch (action.type) {
    case 'SESSION':
      return { ...state, sessionId: action.sessionId };
    case 'SET_TITLE':
      return { ...state, challengeTitle: action.title };
    case 'AGENT_MESSAGE':
      return { ...addMsg(state, { type: 'agent', text: action.text }), phase: 'thinking' };
    case 'MESSAGE_DELTA': {
      const last = state.messages[state.messages.length - 1];
      if (last?.streaming) {
        // Append to the existing streaming message
        return {
          ...state,
          messages: [...state.messages.slice(0, -1), { ...last, text: last.text + action.delta }],
        };
      }
      // Start a new streaming message
      const id = state.nextMsgId + 1;
      return {
        ...state,
        messages: [...state.messages, { id, type: 'agent', text: action.delta, streaming: true }],
        nextMsgId: id,
        phase: 'thinking',
      };
    }
    case 'TOOL_CALL':
      return {
        ...addMsg(state, { type: 'tool', text: action.text, toolName: action.toolName, toolArgs: action.toolArgs }),
        phase: phaseFromTool(action.toolName),
      };
    case 'PROPOSAL':
      return addMsg(state, { type: 'proposal', text: action.text, proposal: action.proposal });
    case 'AWAITING_FEEDBACK':
      return { ...state, awaitingFeedback: true, running: false, sessionId: action.sessionId || state.sessionId, phase: 'idle', startedAt: null };
    case 'SUCCESS':
      return { ...addMsg(state, { type: 'success', text: action.text }), running: false, awaitingFeedback: false, sessionId: null, phase: 'idle', startedAt: null };
    case 'ERROR':
      return { ...addMsg(state, { type: 'error', text: action.text }), running: false, phase: 'idle', startedAt: null };
    case 'ERROR_RECOVERABLE':
      return addMsg(state, { type: 'error', text: action.text });
    case 'COMPLETE':
      return { ...state, running: false, phase: 'idle', startedAt: null };
    case 'START_RUNNING':
      return { ...state, running: true, awaitingFeedback: false, phase: 'thinking', startedAt: Date.now() };
    case 'USER_MESSAGE': {
      // Set the first user message as the working title (replaced by model's theme on preview)
      const title = state.challengeTitle === null ? action.text.split('\n')[0].slice(0, 60) : state.challengeTitle;
      return { ...addMsg(state, { type: 'user', text: action.text }), challengeTitle: title };
    }
    case 'RESET':
      return { ...INITIAL_SESSION_STATE };
  }
}

// --- Agent Builder ---

export interface ProposalPlayerYear {
  year: number;
  team: string;
  zScore: number;
  sandlotScore: number;
}

export interface ProposalPlayer {
  playerId: string;
  playerName: string;
  years: ProposalPlayerYear[];
}

export interface ProposalRound {
  position: string;
  autoFilled: boolean;
  players: ProposalPlayer[];
}

export interface ProposalData {
  theme: string;
  rounds: ProposalRound[];
  missingPositions: string[];
  incompleteRounds?: Array<{ position: string; have: number }>;
}

export interface AgentEvent {
  type: 'thinking' | 'message' | 'message_delta' | 'tool_call' | 'success' | 'error' | 'error_recoverable' | 'complete' | 'proposal' | 'awaiting_feedback' | 'session' | 'theme';
  message?: string;
  delta?: string;
  tool?: string;
  args?: Record<string, unknown>;
  challengeId?: number;
  theme?: string;
  title?: string;
  proposal?: ProposalData;
  sessionId?: string;
}

export function streamAgentBuild(
  prompt: string,
  onEvent: (event: AgentEvent) => void,
): { abort: () => void } {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const controller = new AbortController();

  fetch(`${API_BASE}/admin/challenges/generate-agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
    body: JSON.stringify({ prompt }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', message: `HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', message: String(err) });
    }
  });

  return { abort: () => controller.abort() };
}

export function streamAgentContinue(
  sessionId: string,
  message: string,
  onEvent: (event: AgentEvent) => void,
): { abort: () => void } {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const controller = new AbortController();

  fetch(`${API_BASE}/admin/challenges/generate-agent/continue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
    body: JSON.stringify({ sessionId, message }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', message: `HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', message: String(err) });
    }
  });

  return { abort: () => controller.abort() };
}

// --- Portrait Quality Audit (SSE streaming) ---

export interface AuditStreamEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  total?: number;
  skipped?: number;
  index?: number;
  optionId?: number;
  playerId?: string;
  playerName?: string;
  challengeId?: number;
  pass?: boolean;
  reason?: string;
  failed?: number;
  passed?: number;
  error?: string;
}

export interface RegenStreamEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  total?: number;
  index?: number;
  optionId?: number;
  playerId?: string;
  playerName?: string;
  pass?: boolean;
  attempts?: number;
  portraitUrl?: string;
  regenerated?: number;
  failed?: number;
  error?: string;
}

function createSSEStream<T>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
): { abort: () => void } {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const controller = new AbortController();

  fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', error: `HTTP ${res.status}` } as T);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', error: String(err) } as T);
    }
  });

  return { abort: () => controller.abort() };
}

export function streamAuditPortraits(
  onEvent: (event: AuditStreamEvent) => void,
  challengeIds?: number[],
): { abort: () => void } {
  return createSSEStream('/admin/portraits/audit', { challengeIds }, onEvent);
}

export function streamRegeneratePortraits(
  optionIds: number[],
  onEvent: (event: RegenStreamEvent) => void,
): { abort: () => void } {
  return createSSEStream('/admin/portraits/regenerate', { optionIds }, onEvent);
}

export async function validatePortrait(playerId: string, validated: boolean): Promise<{ playerId: string; validated: boolean }> {
  return adminFetch(`/admin/portraits/${playerId}/validate`, {
    method: 'PATCH',
    body: JSON.stringify({ validated }),
  });
}

// --- Single-player operations ---

export async function regenerateOptionPortrait(optionId: number): Promise<{ generated: boolean; portraitUrl: string }> {
  return adminFetch(`/admin/options/${optionId}/portrait`, { method: 'POST' });
}

export async function regenerateOptionBlurbs(optionId: number): Promise<{ generated: number; failed: number; blurbs: Record<string, string> }> {
  return adminFetch(`/admin/options/${optionId}/blurbs`, { method: 'POST' });
}

export async function updateOptionBlurb(optionId: number, year: number, blurb: string): Promise<{ blurbs: Record<string, string> }> {
  return adminFetch(`/admin/options/${optionId}/blurb`, {
    method: 'PATCH',
    body: JSON.stringify({ year, blurb }),
  });
}

// --- Player Replacement ---

export interface ReplacementSuggestionYear {
  year: number;
  team: string;
  zScore: number;
  sandlotScore: number;
}

export interface ReplacementSuggestion {
  playerId: string;
  playerName: string;
  years: ReplacementSuggestionYear[];
  reasoning: string;
  hasExistingPortrait: boolean;
}

export interface ReplacementEvent {
  type: 'thinking' | 'message' | 'message_delta' | 'tool_call' | 'suggestion' | 'error' | 'error_recoverable' | 'complete' | 'awaiting_feedback' | 'session';
  message?: string;
  delta?: string;
  tool?: string;
  args?: Record<string, unknown>;
  suggestion?: ReplacementSuggestion;
  sessionId?: string;
}

export function streamReplacementAgent(
  optionId: number,
  prompt: string,
  onEvent: (event: ReplacementEvent) => void,
  sessionId?: string,
): { abort: () => void } {
  const secret = getAdminSecret();
  if (!secret) throw new Error('Not authenticated');

  const controller = new AbortController();

  fetch(`${API_BASE}/admin/options/${optionId}/replace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': secret,
    },
    body: JSON.stringify({ prompt, sessionId }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', message: `HTTP ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onEvent({ type: 'error', message: String(err) });
    }
  });

  return { abort: () => controller.abort() };
}

export interface ReplacementResult {
  option: { id: number; playerId: string; playerName: string; yearOptions: number[] };
  blurbs: { generated: number; failed: number };
  portrait: { generated: boolean; skipped: boolean; portraitUrl: string | null };
}

export async function confirmReplacement(
  optionId: number,
  playerId: string,
  playerName: string,
  yearOptions: number[],
): Promise<ReplacementResult> {
  return adminFetch(`/admin/options/${optionId}/replace/confirm`, {
    method: 'POST',
    body: JSON.stringify({ playerId, playerName, yearOptions }),
  });
}
