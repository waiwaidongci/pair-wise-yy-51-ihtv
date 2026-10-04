export type RiskLevel = '高' | '中' | '低'

export type SegmentStatus = '待复核' | '已确认' | '需绕行' | '已绕行'

export type PermissionStatus = '有效' | '缺失' | '待补充'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: SegmentStatus
  coordinates: [number, number][]
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: PermissionStatus
  score: number
  updatedAt: string
  /** 路线版本：区段插入、替换或顺序调整后递增，地图与会签均以此版本为准 */
  version: number
  segments: RiskSegment[]
}

/** 绕行段库：坐标缺失或首尾车站不连续的绕行段不得插入 */
export interface DetourSegment {
  id: string
  routeId: string
  name: string
  from: string
  to: string
  km: string
  coordinates: [number, number][]
}

/** 替代路线：锚定生成时的路线版本，版本递增后需重新比较 */
export interface AlternativeRoute {
  id: string
  routeId: string
  version: number
  name: string
  segments: RiskSegment[]
  km: number
  score: number
  createdAt: string
  author: string
}

/** 会签意见：锚定路线版本，版本变化后原记录保留但标记为待重新会签 */
export interface ReviewComment {
  id: string
  routeId: string
  version: number
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回'
}

export type ChangeType = 'detour' | 'reorder'

export type ChangeStatus = 'pending' | 'merged' | 'conflict' | 'discarded'

/** 断网期间的待补交改动：按操作号合并，同位置先到生效、后到留冲突 */
export interface PendingChange {
  opNo: string
  routeId: string
  type: ChangeType
  targetSegmentId: string
  payload: { detourId?: string; direction?: 'up' | 'down' }
  baseVersion: number
  status: ChangeStatus
  author: string
  createdAt: string
  conflictReason?: string
}

export interface ConflictEntry {
  opNo: string
  routeId: string
  targetSegmentId: string
  reason: string
  author: string
}

export interface ValidationResult {
  ok: boolean
  message: string
}
