import { createReducer, on } from '@ngrx/store'
import type { AlternativeRoute, DetourSegment, PendingChange, ReviewComment, RoutePackage, ValidationResult } from '../types'
import { RouteVersionService } from '../services/route-version.service'
import * as RouteActions from './route.actions'

const versions = new RouteVersionService()

export interface RouteState {
  routes: RoutePackage[]
  detours: DetourSegment[]
  alternatives: AlternativeRoute[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  pendingChanges: PendingChange[]
  online: boolean
  loading: boolean
  error: string
  version: number
  lastValidation: ValidationResult | null
  notice: string
}

export const initialState: RouteState = {
  routes: [],
  detours: [],
  alternatives: [],
  selectedRouteId: '',
  selectedSegmentId: '',
  comments: [
    { id: 'RV-31', routeId: 'HG-260929-018', version: 1, segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', routeId: 'HG-260929-018', version: 1, segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
  pendingChanges: [],
  online: true,
  loading: false,
  error: '',
  version: 6,
  lastValidation: null,
  notice: '',
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes, detours }) => ({
    ...state,
    loading: false,
    routes,
    detours,
    selectedRouteId: state.selectedRouteId || routes[0]?.id || '',
    selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '',
  })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => {
      if (!route.segments.some((segment) => segment.id === id)) return route
      const segments = route.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment)
      const recalculated = versions.recalculate(segments)
      return { ...route, segments: recalculated.segments, score: recalculated.score, version: route.version + 1 }
    }),
  })),
  on(RouteActions.addComment, (state, { comment }) => {
    const route = state.routes.find((item) => item.id === state.selectedRouteId)
    const enriched: ReviewComment = { ...comment, routeId: route?.id ?? state.selectedRouteId, version: route?.version ?? 1 }
    return { ...state, comments: [enriched, ...state.comments], notice: `已在 v${enriched.version} 上追加会签意见 ${enriched.id}。` }
  }),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),
  on(RouteActions.createAlternative, (state) => {
    const route = state.routes.find((item) => item.id === state.selectedRouteId)
    if (!route) return state
    const alternative: AlternativeRoute = {
      id: `ALT-${route.id}-v${route.version}`,
      routeId: route.id,
      version: route.version,
      name: `${route.trainCode} 替代路径（v${route.version}）`,
      segments: route.segments.map((segment) => ({ ...segment })),
      km: Math.round(route.segments.reduce((sum, segment) => sum + Number(segment.km || 0), 0) * 10) / 10,
      score: route.score,
      createdAt: new Date().toISOString(),
      author: '当前审阅人',
    }
    return {
      ...state,
      version: state.version + 1,
      alternatives: [alternative, ...state.alternatives],
      routes: state.routes.map((item) => item.id === route.id ? { ...item, version: item.version + 1 } : item),
      notice: `替代路径 ${alternative.id} 已锚定 v${route.version}，路线草案升级为 v${route.version + 1}，旧会签需重新确认。`,
    }
  }),
  on(RouteActions.insertDetourApplied, (state, { routeId, targetSegmentId, detour }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    const segments = route.segments.map((segment) => segment.id === targetSegmentId ? versions.toSegment(detour) : segment)
    const recalculated = versions.recalculate(segments)
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((item) => item.id === routeId ? { ...item, segments: recalculated.segments, score: recalculated.score, version: item.version + 1 } : item),
      lastValidation: { ok: true, message: `绕行段 ${detour.id} 已插入，首尾车站连续、坐标完整；里程与风险已重算为 ${recalculated.km} km / ${recalculated.score} 分，地图与会签按 v${route.version + 1} 刷新。` },
      notice: '',
    }
  }),
  on(RouteActions.insertDetourBlocked, (state, { reason }) => ({ ...state, lastValidation: { ok: false, message: reason }, notice: '' })),
  on(RouteActions.reorderSegmentApplied, (state, { routeId, segmentId, direction }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    const index = route.segments.findIndex((segment) => segment.id === segmentId)
    const swapWith = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || swapWith < 0 || swapWith >= route.segments.length) return state
    const segments = route.segments.map((segment) => ({ ...segment }))
    ;[segments[index], segments[swapWith]] = [segments[swapWith], segments[index]]
    const recalculated = versions.recalculate(segments)
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((item) => item.id === routeId ? { ...item, segments: recalculated.segments, score: recalculated.score, version: item.version + 1 } : item),
      lastValidation: { ok: true, message: `区段顺序已调整，里程、风险、地图与会签已按 v${route.version + 1} 重算。` },
    }
  }),
  on(RouteActions.recalculateRoute, (state, { routeId }) => {
    const route = state.routes.find((item) => item.id === routeId)
    if (!route) return state
    const recalculated = versions.recalculate(route.segments)
    return {
      ...state,
      version: state.version + 1,
      routes: state.routes.map((item) => item.id === routeId ? { ...item, segments: recalculated.segments, score: recalculated.score, version: item.version + 1 } : item),
      notice: `已按当前区段顺序重算里程 ${recalculated.km} km、风险 ${recalculated.score} 分，地图与会签升级为 v${route.version + 1}。`,
    }
  }),
  on(RouteActions.networkChanged, (state, { online }) => ({
    ...state,
    online,
    notice: online ? '网络已恢复，待补交改动按操作号合并。' : '已进入断网模式：改动先排成待补交队列，恢复后按操作号合并。',
  })),
  on(RouteActions.enqueueChange, (state, { change }) => ({ ...state, pendingChanges: [...state.pendingChanges, change], notice: `操作 ${change.opNo} 已排入待补交队列（基准 v${change.baseVersion}）。` })),
  on(RouteActions.mergeApplied, (state, { routes, pendingChanges }) => {
    const mergedCount = pendingChanges.filter((change) => change.status === 'merged').length
    const conflictCount = pendingChanges.filter((change) => change.status === 'conflict').length
    return {
      ...state,
      version: state.version + 1,
      routes,
      pendingChanges,
      notice: `已按操作号合并 ${mergedCount} 项待补交改动，${conflictCount} 项冲突留待处理；地图与会签已升级到同一路线版本。`,
    }
  }),
  on(RouteActions.resolveConflict, (state, { opNo }) => ({
    ...state,
    pendingChanges: state.pendingChanges.map((change) => change.opNo === opNo ? { ...change, status: 'discarded' as const, conflictReason: undefined } : change),
    notice: `冲突操作 ${opNo} 已放弃，先到操作继续生效。`,
  })),
  on(RouteActions.clearValidation, (state) => ({ ...state, lastValidation: null })),
)
