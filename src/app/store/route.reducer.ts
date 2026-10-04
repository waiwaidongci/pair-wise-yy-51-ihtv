import { createReducer, on } from '@ngrx/store'
import type {
  AuditEntry,
  ConflictRecord,
  PendingItem,
  ReviewComment,
  RouteMutation,
  RoutePackage,
} from '../types'
import {
  activeSegments,
  applyDetour,
  applyReorder,
  currentTime,
  detourKey,
  normalizeRoute,
  recomputeRoute,
  validateDetour,
  validateReorder,
} from '../services/route-domain'
import * as RouteActions from './route.actions'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  loading: boolean
  error: string
  online: boolean
  /** 待补交 / 已并入 / 冲突保留的离线操作 */
  pending: PendingItem[]
  conflicts: ConflictRecord[]
  audit: AuditEntry[]
  /** 已生效改动占用的插入位置 key → 先到操作号（先到生效依据） */
  occupiedKeys: Record<string, number>
  seqCounter: number
  notice: { text: string; kind: 'info' | 'error' | 'success' } | null
}

export const initialState: RouteState = {
  routes: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  loading: false,
  error: '',
  online: true,
  pending: [],
  conflicts: [],
  audit: [],
  occupiedKeys: {},
  seqCounter: 1000,
  notice: null,
  comments: [
    { id: 'RV-31', routeId: 'HG-260929-018', routeVersion: 1, segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认', createdAt: '今天 16:42' },
    { id: 'RV-32', routeId: 'HG-260929-018', routeVersion: 1, segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', createdAt: '今天 16:05' },
  ],
}

function findRoute(state: RouteState, routeId: string): RoutePackage | undefined {
  return state.routes.find((route) => route.id === routeId)
}

type Notice = NonNullable<RouteState['notice']>
function notice(text: string, kind: Notice['kind']): Notice {
  return { text, kind }
}

function pushAudit(state: RouteState, text: string, detail: string, routeId: string, routeVersion: number): AuditEntry[] {
  return [{ id: state.audit.length + 1, time: currentTime(), text, detail, routeId, routeVersion }, ...state.audit]
}

interface MergeOutcome {
  state: RouteState
  /** 冲突时为后到操作号 */
  conflictLoser: number | null
}

/**
 * 按操作号合并单个改动：
 * - 同一插入位置已被占用 → 先到生效，后到留冲突；
 * - 核对不通过（首尾不连续 / 缺坐标）→ 拦住，不产生新版本；
 * - force 用于冲突后“强制并入”，锚点重定到当前同站址活跃区段。
 */
function mergeMutation(state: RouteState, item: PendingItem, force = false): MergeOutcome {
  const { mutation } = item
  const route = findRoute(state, mutation.routeId)
  if (!route) {
    return { state: failItem(state, item, '运输单不存在，无法合并该操作'), conflictLoser: null }
  }

  if (mutation.type === 'detour') {
    const key = detourKey(mutation.routeId, mutation.draft.anchorSegmentId)
    const winnerSeq = state.occupiedKeys[key]
    if (winnerSeq !== undefined && winnerSeq !== mutation.seq && !force) {
      return { state: registerConflict(state, item, key, winnerSeq, `同一插入位置（锚点 ${mutation.draft.anchorSegmentId}）已被操作号 #${winnerSeq} 先行改动，先到生效，本操作保留冲突`), conflictLoser: mutation.seq }
    }

    let draft = mutation.draft
    if (force) {
      const active = activeSegments(route)
      // 强制并入时按车站而非旧锚点 id 重新定位：bypass 找同首尾区段，continue 找首站衔接原锚点尾的正常区段
      const replacement = draft.mode === 'bypass'
        ? active.find((segment) => segment.from === draft.from && segment.to === draft.to)
        : active.find((segment) => segment.kind === 'normal' && segment.to === draft.from)
      if (replacement && replacement.id !== draft.anchorSegmentId) {
        draft = { ...draft, anchorSegmentId: replacement.id }
      }
    }

    const validation = validateDetour(draft, route)
    if (!validation.ok || !validation.value) {
      return { state: failItem(state, item, validation.message ?? '绕行段核对未通过'), conflictLoser: null }
    }

    const detourId = `D-${mutation.seq}`
    const { route: nextRoute } = applyDetour(route, draft, validation.value, detourId, currentTime())
    return {
      state: commitMutation(state, item, nextRoute, key, force,
        `${mutation.operator} 插入绕行段「${draft.name}」，${route.id} 升级 v${nextRoute.version}`,
        `操作号 #${mutation.seq} · 锚点 ${draft.anchorSegmentId} · 首尾车站连续、坐标核对通过，里程/风险/地图/会签已按新版本重算`),
      conflictLoser: null,
    }
  }

  const validation = validateReorder(mutation.draft, route)
  if (!validation.ok || !validation.value) {
    return { state: failItem(state, item, validation.message ?? '区段顺序核对未通过'), conflictLoser: null }
  }
  const nextRoute = applyReorder(route, validation.value, currentTime())
  return {
    state: commitMutation(state, item, nextRoute, undefined, force,
      `${mutation.operator} 调整运行区段顺序，${route.id} 升级 v${nextRoute.version}`,
      `操作号 #${mutation.seq} · 首尾车站连续性核对通过，里程、风险、地图与会签依据已重算`),
    conflictLoser: null,
  }
}

function commitMutation(
  state: RouteState,
  item: PendingItem,
  nextRoute: RoutePackage,
  occupyKey: string | undefined,
  force: boolean,
  auditText: string,
  auditDetail: string,
): RouteState {
  const pending = state.pending.some((entry) => entry.seq === item.seq)
    ? state.pending.map((entry) => entry.seq === item.seq
      ? { ...entry, status: force ? '已并入' as const : entry.status === '待补交' ? '已并入' as const : entry.status, reason: force ? '冲突后强制并入' : '' }
      : entry)
    : [...state.pending, { ...item, status: '已并入' as const, reason: '' }]
  const occupiedKeys = occupyKey ? { ...state.occupiedKeys, [occupyKey]: state.occupiedKeys[occupyKey] ?? item.seq } : state.occupiedKeys
  const audit = pushAudit(state, auditText, auditDetail, nextRoute.id, nextRoute.version)
  return patchRoute(state, nextRoute, { pending, occupiedKeys, audit })
}

function failItem(state: RouteState, item: PendingItem, message: string): RouteState {
  const pending = state.pending.some((entry) => entry.seq === item.seq)
    ? state.pending.map((entry) => entry.seq === item.seq ? { ...entry, status: '已放弃' as const, reason: message } : entry)
    : [...state.pending, { ...item, status: '已放弃' as const, reason: message }]
  const audit = pushAudit(state, `操作号 #${item.seq} 被拦截`, message, item.mutation.routeId, findRoute(state, item.mutation.routeId)?.version ?? 0)
  return { ...state, pending, audit, notice: notice(message, 'error') }
}

function registerConflict(state: RouteState, item: PendingItem, key: string, winnerSeq: number, reason: string): RouteState {
  const conflict: ConflictRecord = {
    key,
    winnerSeq,
    loserSeq: item.seq,
    routeId: item.mutation.routeId,
    reason,
    resolved: false,
    createdAt: currentTime(),
  }
  const pending = state.pending.some((entry) => entry.seq === item.seq)
    ? state.pending.map((entry) => entry.seq === item.seq ? { ...entry, status: '冲突保留' as const, conflictWith: winnerSeq, reason } : entry)
    : [...state.pending, { ...item, status: '冲突保留' as const, conflictWith: winnerSeq, reason }]
  const audit = pushAudit(state, `操作号 #${item.seq} 与先到操作 #${winnerSeq} 冲突`, reason, item.mutation.routeId, findRoute(state, item.mutation.routeId)?.version ?? 0)
  return { ...state, conflicts: [...state.conflicts, conflict], pending, audit, notice: notice(reason, 'error') }
}

function patchRoute(state: RouteState, nextRoute: RoutePackage, patch: Partial<RouteState>): RouteState {
  const routes = state.routes.map((route) => route.id === nextRoute.id ? nextRoute : route)
  const selectedSegmentId = nextRoute.segments.some((segment) => segment.id === state.selectedSegmentId)
    ? state.selectedSegmentId
    : activeSegments(nextRoute)[0]?.id ?? ''
  return {
    ...state,
    ...patch,
    routes,
    selectedRouteId: nextRoute.id,
    selectedSegmentId,
    notice: notice(`已合并到 ${nextRoute.id} 当前版本 v${nextRoute.version}：运输单、地图、会签依据同源`, 'success'),
  }
}

function queueItem(state: RouteState, mutation: RouteMutation): { state: RouteState; item: PendingItem } {
  const seq = state.seqCounter + 1
  const numbered: RouteMutation = { ...mutation, seq } as RouteMutation
  const item: PendingItem = { seq, mutation: numbered, status: '待补交', conflictWith: null, reason: '', createdAt: currentTime() }
  const pending = [...state.pending, item]
  const audit = pushAudit({ ...state, seqCounter: seq }, `断网登记操作号 #${seq}（待补交）`,
    mutation.type === 'detour'
      ? `${mutation.operator} 拟在 ${mutation.draft.anchorSegmentId} 插入绕行段「${mutation.draft.name}」，恢复网络后按操作号合并`
      : `${mutation.operator} 调整区段顺序，恢复网络后按操作号合并`,
    mutation.routeId, findRoute(state, mutation.routeId)?.version ?? 0)
  return { state: { ...state, seqCounter: seq, pending, audit, notice: notice(`当前断网，操作号 #${seq} 已排入待补交队列，恢复后按操作号合并`, 'info') }, item }
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => {
    const normalized = routes.map(normalizeRoute)
    return {
      ...state,
      loading: false,
      routes: normalized,
      selectedRouteId: state.selectedRouteId || normalized[0]?.id || '',
      selectedSegmentId: state.selectedSegmentId || activeSegments(normalized[0] ?? { segments: [] })[0]?.id || '',
    }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(RouteActions.selectRoute, (state, { id }) => ({
    ...state,
    selectedRouteId: id,
    selectedSegmentId: activeSegments(findRoute(state, id) ?? { segments: [] })[0]?.id ?? '',
  })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),

  on(RouteActions.updateSegmentLevel, (state, { id, level }) => {
    const target = state.routes.find((route) => route.segments.some((segment) => segment.id === id))
    if (!target) return state
    const segments = target.segments.map((segment) => segment.id === id
      ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const, routeVersion: target.version + 1 }
      : segment)
    const next: RoutePackage = { ...target, version: target.version + 1, segments, updatedAt: currentTime() }
    const { score } = recomputeRoute(next)
    const audit = pushAudit(state, `${target.id} 区段 ${id} 风险等级调整为「${level}」`, `风险与地图按 v${next.version} 重算，历史会签意见保留原版本号`, next.id, next.version)
    return patchRoute(state, { ...next, score }, { audit })
  }),

  on(RouteActions.insertDetour, (state, { draft, operator }) => {
    if (!state.online) {
      const { state: queued } = queueItem(state, { seq: 0, type: 'detour', routeId: draft.routeId, operator, draft })
      return queued
    }
    const seq = state.seqCounter + 1
    const item: PendingItem = { seq, mutation: { seq, type: 'detour', routeId: draft.routeId, operator, draft }, status: '待补交', conflictWith: null, reason: '', createdAt: currentTime() }
    const merged = mergeMutation({ ...state, seqCounter: seq }, item)
    return merged.state
  }),

  on(RouteActions.reorderSegments, (state, { draft, operator }) => {
    if (!state.online) {
      const { state: queued } = queueItem(state, { seq: 0, type: 'reorder', routeId: draft.routeId, operator, draft })
      return queued
    }
    const seq = state.seqCounter + 1
    const item: PendingItem = { seq, mutation: { seq, type: 'reorder', routeId: draft.routeId, operator, draft }, status: '待补交', conflictWith: null, reason: '', createdAt: currentTime() }
    const merged = mergeMutation({ ...state, seqCounter: seq }, item)
    return merged.state
  }),

  on(RouteActions.setOnline, (state, { online }) => ({
    ...state,
    online,
    notice: online
      ? (state.pending.some((item) => item.status === '待补交') ? notice('网络已恢复，正在按操作号顺序合并待补交改动…', 'info') : state.notice)
      : notice('已切换为断网模式，改动将登记为待补交，恢复后按操作号合并', 'info'),
  })),

  on(RouteActions.flushPending, (state) => {
    if (!state.online) return state
    const queue = state.pending.filter((item) => item.status === '待补交').sort((a, b) => a.seq - b.seq)
    return queue.reduce((current, item) => mergeMutation(current, item).state, state)
  }),

  on(RouteActions.resolveConflict, (state, { seq, resolution }) => {
    const item = state.pending.find((entry) => entry.seq === seq)
    if (!item) return state
    const conflicts = state.conflicts.map((conflict) => conflict.loserSeq === seq ? { ...conflict, resolved: true, resolution } : conflict)
    if (resolution === '放弃') {
      const pending = state.pending.map((entry) => entry.seq === seq ? { ...entry, status: '已放弃' as const } : entry)
      const audit = pushAudit(state, `操作号 #${seq} 冲突处理：放弃`, item.reason, item.mutation.routeId, findRoute(state, item.mutation.routeId)?.version ?? 0)
      return { ...state, conflicts, pending, audit, notice: notice(`操作号 #${seq} 已放弃，先到操作保持生效`, 'info') }
    }
    const forced: PendingItem = { ...item, status: '待补交', reason: '' }
    const merged = mergeMutation(state, forced, true)
    return { ...merged.state, conflicts }
  }),

  on(RouteActions.discardPending, (state, { seq }) => {
    const pending = state.pending.map((entry) => entry.seq === seq ? { ...entry, status: '已放弃' as const, reason: '人工放弃待补交操作' } : entry)
    return { ...state, pending, notice: notice(`操作号 #${seq} 已放弃`, 'info') }
  }),

  on(RouteActions.addComment, (state, { comment }) => {
    const audit = pushAudit(state, `${comment.role} · ${comment.author} 对 ${comment.segmentId} 发表会签意见`, `意见锚定 ${comment.routeId} v${comment.routeVersion}，路线再变更将提示重签`, comment.routeId, comment.routeVersion)
    return { ...state, comments: [comment, ...state.comments], audit }
  }),
  on(RouteActions.resolveComment, (state, { id, status }) => ({
    ...state,
    comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment),
  })),
)
