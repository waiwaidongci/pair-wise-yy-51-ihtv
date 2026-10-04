
import { createAction, props } from '@ngrx/store'
import type { DetourSegment, PendingChange, ReviewComment, RiskLevel, RoutePackage, ValidationResult } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[]; detours: DetourSegment[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: Omit<ReviewComment, 'routeId' | 'version'> }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

/** 插入绕行段：在线时校验连续性与坐标，断网时排入待补交队列 */
export const insertDetour = createAction('[Route Version] Insert Detour', props<{ routeId: string; targetSegmentId: string; detourId: string }>())
export const insertDetourApplied = createAction('[Route Version] Insert Detour Applied', props<{ routeId: string; targetSegmentId: string; detour: DetourSegment }>())
export const insertDetourBlocked = createAction('[Route Version] Insert Detour Blocked', props<{ reason: string }>())

/** 区段顺序调整：应用后重算里程、风险、地图与会签 */
export const reorderSegment = createAction('[Route Version] Reorder Segment', props<{ routeId: string; segmentId: string; direction: 'up' | 'down' }>())
export const reorderSegmentApplied = createAction('[Route Version] Reorder Segment Applied', props<{ routeId: string; segmentId: string; direction: 'up' | 'down' }>())
export const recalculateRoute = createAction('[Route Version] Recalculate Route', props<{ routeId: string }>())

/** 断网 / 恢复：恢复后按操作号合并待补交改动 */
export const networkChanged = createAction('[Offline] Network Changed', props<{ online: boolean }>())
export const enqueueChange = createAction('[Offline] Enqueue Change', props<{ change: PendingChange }>())
export const mergePendingChanges = createAction('[Offline] Merge Pending Changes')
export const simulateConcurrentChange = createAction('[Offline] Simulate Concurrent Change')
export const mergeApplied = createAction('[Offline] Merge Applied', props<{ routes: RoutePackage[]; pendingChanges: PendingChange[] }>())
export const resolveConflict = createAction('[Offline] Resolve Conflict', props<{ opNo: string }>())
export const clearValidation = createAction('[Route Version] Clear Validation')
