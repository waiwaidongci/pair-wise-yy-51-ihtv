import { length, lineString } from '@turf/turf'
import type { DetourDraft, ReorderDraft, RiskLevel, RiskSegment, RoutePackage } from '../types'

/** 端点坐标对齐容差（约 2 km），用于核对绕行段首尾是否与既有区段衔接 */
const JUNCTION_TOLERANCE = 0.02

export interface ValidationResult<T> {
  ok: boolean
  value?: T
  message?: string
}

/** 活跃区段：正常区段未被绕行，绕行段本身计入运行路线；已绕行政段只留审计依据 */
export function activeSegments(route: { segments: RiskSegment[] }): RiskSegment[] {
  return route.segments.filter((segment) => segment.status !== '已绕行')
}

export function segmentLengthKm(coordinates: [number, number][]): number {
  if (coordinates.length < 2) return 0
  return length(lineString(coordinates), { units: 'kilometers' })
}

/** 里程始终由实测折线坐标重算，绝不以首尾直线补齐 */
export function formatKm(km: number): string {
  return km.toFixed(1)
}

const RISK_WEIGHTS: Record<string, number> = {
  水源地: 12,
  长隧道: 9,
  隧道: 7,
  隧道群: 8,
  跨河桥: 8,
  桥梁群: 9,
  高架桥: 7,
  人口密集: 10,
  人员密集: 10,
  枢纽密集: 5,
}

export function deriveDetourLevel(risks: string[], speed: string): RiskLevel {
  const base = risks.reduce((sum, risk) => sum + (RISK_WEIGHTS[risk] ?? 5), 0)
  const speedLimit = Number(speed.replace(/[^0-9]/g, '')) || 60
  const score = base + (speedLimit <= 45 ? 4 : 0)
  if (score >= 18) return '高'
  if (score >= 10) return '中'
  return '低'
}

/** 顺序变更后的整单风险重算：结合最高区段风险与全程均值，排除已绕行政段 */
export function recomputeRoute(route: RoutePackage): { score: number; totalKm: number } {
  const active = activeSegments(route)
  const levelScore: Record<RiskLevel, number> = { 高: 100, 中: 60, 低: 25 }
  const scoreValues = active.map((segment) => levelScore[segment.level])
  const max = scoreValues.length ? Math.max(...scoreValues) : 0
  const avg = scoreValues.length ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : 0
  const score = Math.round(max * 0.7 + avg * 0.3)
  let totalKm = 0
  for (const segment of active) totalKm += segmentLengthKm(segment.coordinates)
  return { score, totalKm }
}

export interface ContinuityBreak {
  index: number
  fromStation: string
  toStation: string
  detail: string
}

/**
 * 核对首尾车站连续：相邻活跃区段必须满足 前段.to === 后段.from。
 * 只依据车站名核对，坐标缺口不做直线补齐。
 */
export function checkContinuity(segments: RiskSegment[]): ContinuityBreak[] {
  const breaks: ContinuityBreak[] = []
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].to !== segments[i + 1].from) {
      breaks.push({
        index: i + 1,
        fromStation: segments[i].to,
        toStation: segments[i + 1].from,
        detail: `第 ${i + 1} 段终到「${segments[i].to}」与第 ${i + 2} 段始发「${segments[i + 1].from}」不一致`,
      })
    }
  }
  return breaks
}

/** 解析坐标文本，缺坐标/非法坐标一律拦截，不用直线补齐 */
export function parseCoordinates(text: string): ValidationResult<[number, number][]> {
  const points: [number, number][] = []
  const lines = text.split(/\n|;/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 3) return { ok: false, message: '绕行段必须提供首尾及中间折线坐标（至少 3 点）；缺少坐标直接拦截，不允许用首尾直线补齐' }
  for (const line of lines) {
    const parts = line.split(/[,\s]+/).filter(Boolean).map(Number)
    if (parts.length !== 2 || parts.some(Number.isNaN)) {
      return { ok: false, message: `坐标「${line}」格式无效，应为 经度,纬度` }
    }
    const [lng, lat] = parts as [number, number]
    if (lng < 73 || lng > 136 || lat < 3 || lat > 54) {
      return { ok: false, message: `坐标「${line}」超出中国铁路网范围` }
    }
    points.push([lng, lat])
  }
  // 完全重合点不构成线路几何，同样拦截
  const unique = new Set(points.map(([lng, lat]) => `${lng},${lat}`))
  if (unique.size < 2) return { ok: false, message: '绕行段坐标全部重合，无法构成线路，不得用点代替线路' }
  return { ok: true, value: points }
}

function near(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) <= JUNCTION_TOLERANCE && Math.abs(a[1] - b[1]) <= JUNCTION_TOLERANCE
}

/** 锚点同位置键：两人同时改同一插入位置时，后到按此键识别冲突（先到生效） */
export function detourKey(routeId: string, anchorSegmentId: string): string {
  return `detour:${routeId}:${anchorSegmentId}`
}

export function reorderKey(routeId: string): string {
  return `reorder:${routeId}`
}

/**
 * 插入绕行段前的强制核对：
 * 1. 锚点必须存在于运行路线；
 * 2. 首尾车站名连续（bypass 与锚点首尾一致；continue 接锚点尾与下一活跃区段首）；
 * 3. 坐标完整且首尾与衔接点坐标对齐，缺坐标直接拦住，不以直线补齐。
 */
export function validateDetour(draft: DetourDraft, route: RoutePackage): ValidationResult<[number, number][]> {
  if (!draft.name.trim()) return { ok: false, message: '绕行段名称不能为空' }
  if (!draft.from.trim() || !draft.to.trim()) return { ok: false, message: '绕行段首尾车站不能为空' }

  const anchor = activeSegments(route).find((segment) => segment.id === draft.anchorSegmentId)
  if (!anchor) return { ok: false, message: `锚点区段 ${draft.anchorSegmentId} 不在当前运行路线（v${route.version}），无法插入` }

  if (draft.mode === 'bypass') {
    if (draft.from !== anchor.from) return { ok: false, message: `绕行段首站「${draft.from}」必须与锚点首站「${anchor.from}」连续` }
    if (draft.to !== anchor.to) return { ok: false, message: `绕行段尾站「${draft.to}」必须与锚点尾站「${anchor.to}」连续` }
  } else {
    const order = activeSegments(route)
    const next = order[order.indexOf(anchor) + 1]
    if (draft.from !== anchor.to) return { ok: false, message: `绕行段首站「${draft.from}」必须承接锚点尾站「${anchor.to}」` }
    if (next && draft.to !== next.from) return { ok: false, message: `绕行段尾站「${draft.to}」必须与下一运行区段首站「${next.from}」连续` }
  }

  const parsed = parseCoordinates(draft.coordinatesText)
  if (!parsed.ok || !parsed.value) return { ok: false, message: parsed.message }
  const coords = parsed.value

  if (draft.mode === 'bypass') {
    if (!near(coords[0], anchor.coordinates[0])) {
      return { ok: false, message: `绕行段起点坐标 ${coords[0].join(',')} 与锚点首站坐标 ${anchor.coordinates[0].join(',')} 不衔接，禁止以直线补齐` }
    }
    if (!near(coords[coords.length - 1], anchor.coordinates[anchor.coordinates.length - 1])) {
      return { ok: false, message: `绕行段终点坐标与锚点尾站坐标不衔接，禁止以直线补齐` }
    }
  } else {
    const order = activeSegments(route)
    const next = order[order.indexOf(anchor) + 1]
    if (!near(coords[0], anchor.coordinates[anchor.coordinates.length - 1])) {
      return { ok: false, message: `绕行段起点坐标必须承接锚点尾站 ${anchor.to}，禁止以直线补齐` }
    }
    if (next && !near(coords[coords.length - 1], next.coordinates[0])) {
      return { ok: false, message: `绕行段终点坐标必须与下一运行区段首站 ${next.from} 对齐，禁止以直线补齐` }
    }
  }

  return { ok: true, value: coords }
}

/** 顺序重排核对：活跃区段集合必须一致且首尾车站重新连续 */
export function validateReorder(draft: ReorderDraft, route: RoutePackage): ValidationResult<RiskSegment[]> {
  const active = activeSegments(route)
  const activeIds = active.map((segment) => segment.id)
  const sameSet = draft.orderedSegmentIds.length === activeIds.length
    && draft.orderedSegmentIds.every((id) => activeIds.includes(id))
  if (!sameSet) return { ok: false, message: '重排必须覆盖全部运行区段且不得新增/删除区段' }

  const byId = new Map(active.map((segment) => [segment.id, segment]))
  const reordered = draft.orderedSegmentIds.map((id) => byId.get(id)!)
  const breaks = checkContinuity(reordered)
  if (breaks.length > 0) {
    return { ok: false, message: `顺序变更后首尾车站不连续：${breaks[0].detail}，重排被拦截` }
  }
  return { ok: true, value: reordered }
}

/** 应用绕行插入：锚点标记“已绕行”保留审计，绕行段以新版本紧邻其后，里程/风险随之重算 */
export function applyDetour(
  route: RoutePackage,
  draft: DetourDraft,
  coordinates: [number, number][],
  detourId: string,
  now: string,
): { route: RoutePackage; detour: RiskSegment } {
  const anchorIndex = route.segments.findIndex((segment) => segment.id === draft.anchorSegmentId)
  const anchor = route.segments[anchorIndex]
  const detour: RiskSegment = {
    id: detourId,
    name: draft.name.trim(),
    from: draft.from.trim(),
    to: draft.to.trim(),
    km: formatKm(segmentLengthKm(coordinates)),
    speed: draft.speed || '限速 60',
    risks: draft.risks,
    level: deriveDetourLevel(draft.risks, draft.speed || '限速 60'),
    status: '已确认',
    coordinates,
    routeVersion: route.version + 1,
    kind: 'detour',
  }
  const segments = [...route.segments]
  if (draft.mode === 'bypass') {
    segments[anchorIndex] = { ...anchor, status: '已绕行' }
  }
  segments.splice(anchorIndex + 1, 0, detour)
  const next: RoutePackage = { ...route, version: route.version + 1, segments, updatedAt: now }
  const { score } = recomputeRoute(next)
  return { route: { ...next, score }, detour }
}

/** 顺序变更：按新顺序输出活跃区段，被绕行的旧区段作为审计快照紧跟其对应绕行段；版本递增并刷新风险依据 */
export function applyReorder(route: RoutePackage, reorderedActive: RiskSegment[], now: string): RoutePackage {
  const bypassed = route.segments.filter((segment) => segment.status === '已绕行')
  const segments: RiskSegment[] = []
  for (const active of reorderedActive) {
    const archived = bypassed.find((segment) => segment.from === active.from && segment.to === active.to)
    if (archived) segments.push(archived)
    segments.push(active)
  }
  const next: RoutePackage = { ...route, version: route.version + 1, segments, updatedAt: now }
  const { score } = recomputeRoute(next)
  return { ...next, score }
}

/** 加载时归一化：种子数据补 kind/version；里程由坐标实测刷新，保证与地图同源 */
export function normalizeRoute(route: RoutePackage): RoutePackage {
  const segments = route.segments.map((segment) => ({
    ...segment,
    kind: segment.kind ?? 'normal' as const,
    routeVersion: segment.routeVersion ?? route.version ?? 1,
    km: formatKm(segmentLengthKm(segment.coordinates)),
  }))
  const normalized = { ...route, version: route.version ?? 1, segments }
  return normalized
}

export function currentTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
