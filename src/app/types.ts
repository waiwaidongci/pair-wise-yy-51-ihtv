export type RiskLevel = '高' | '中' | '低'

export type SegmentKind = 'normal' | 'detour'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行' | '已绕行'
  coordinates: [number, number][]
  /** 区段所属运输单版本：绕行段随新版本生成，保证地图、审批依据指向同一版本 */
  routeVersion: number
  kind: SegmentKind
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
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  /** 当前路线版本：运输单、区段、绕行段、地图与会签意见共同锚定 */
  version: number
  segments: RiskSegment[]
}

export interface ReviewComment {
  id: string
  routeId: string
  /** 会签时锁定的路线版本；与运输单当前版本不一致时标注“版本失效，待重签” */
  routeVersion: number
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回'
  createdAt: string
}

/** 绕行段草稿：插入前必须通过首尾车站连续与坐标完整性核对 */
export interface DetourDraft {
  routeId: string
  /** 被绕行锚点（运行区段） */
  anchorSegmentId: string
  mode: 'bypass' | 'continue'
  name: string
  from: string
  to: string
  speed: string
  risks: string[]
  coordinatesText: string
}

export type OrderMode = 'swap-adjacent'

export interface ReorderDraft {
  routeId: string
  /** 参与重排的活跃区段 id，顺序即新顺序 */
  orderedSegmentIds: string[]
}

export type RouteMutationType = 'detour' | 'reorder'

/** 已编号的路线改动操作，离线时先排队，恢复后按操作号合并 */
export type RouteMutation =
  | { seq: number; type: 'detour'; routeId: string; operator: string; draft: DetourDraft }
  | { seq: number; type: 'reorder'; routeId: string; operator: string; draft: ReorderDraft }

export type PendingStatus = '待补交' | '已并入' | '已放弃' | '冲突保留'

export interface PendingItem {
  seq: number
  mutation: RouteMutation
  status: PendingStatus
  conflictWith: number | null
  reason: string
  createdAt: string
}

export interface ConflictRecord {
  key: string
  winnerSeq: number
  loserSeq: number
  routeId: string
  reason: string
  resolved: boolean
  resolution?: '强制并入' | '放弃'
  createdAt: string
}

export interface AuditEntry {
  id: number
  time: string
  text: string
  detail: string
  routeId: string
  routeVersion: number
}
