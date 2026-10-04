import { createAction, props } from '@ngrx/store'
import type {
  DetourDraft,
  ReorderDraft,
  ReviewComment,
  RiskLevel,
  RoutePackage,
} from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())

export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())

export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())

/** 绕行插入：先核对首尾车站连续与坐标完整性，再升版本重算（断网时入待补交队列） */
export const insertDetour = createAction('[Route Workbench] Insert Detour', props<{ draft: DetourDraft; operator: string }>())

/** 区段顺序重排：变化即重算里程、风险、地图与会签锚点（断网时入待补交队列） */
export const reorderSegments = createAction('[Risk Map] Reorder Segments', props<{ draft: ReorderDraft; operator: string }>())

/** 同插入位置两人同时修改：先到生效，后到留冲突 */
export const resolveConflict = createAction('[Approval] Resolve Conflict', props<{ seq: number; resolution: '强制并入' | '放弃' }>())
export const discardPending = createAction('[Workbench] Discard Pending', props<{ seq: number }>())

/** 网络状态：断网改动进入待补交队列；恢复后按操作号顺序合并 */
export const setOnline = createAction('[Route Sync] Set Online', props<{ online: boolean }>())
export const flushPending = createAction('[Route Sync] Flush Pending')

export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
