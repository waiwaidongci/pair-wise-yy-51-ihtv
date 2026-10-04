import { Injectable } from '@angular/core'
import { length, lineString } from '@turf/turf'
import type { DetourSegment, RiskSegment, RoutePackage, ValidationResult } from '../types'

/**
 * 路线版本领域逻辑：
 * - 插入绕行段前核对首尾车站连续、坐标完整，缺坐标直接拦截，不用直线补齐；
 * - 区段插入、替换或顺序变化后重算里程与风险分。
 */
@Injectable({ providedIn: 'root' })
export class RouteVersionService {
  /** 校验绕行段是否允许插入目标区段位置 */
  validateDetour(route: RoutePackage, target: RiskSegment, detour: DetourSegment): ValidationResult {
    if (!this.hasValidCoordinates(detour.coordinates)) {
      return { ok: false, message: `绕行段 ${detour.id}（${detour.name}）缺少坐标，已拦截，未用直线补齐。` }
    }
    if (!this.hasValidCoordinates(target.coordinates)) {
      return { ok: false, message: `被绕行区段 ${target.id}（${target.name}）缺少坐标，无法与相邻区段接续，已拦截。` }
    }
    // 首尾车站连续：绕行段起讫站必须与目标区段起讫站一致（同走廊替换）
    if (detour.from !== target.from || detour.to !== target.to) {
      return { ok: false, message: `首尾车站不连续：绕行段 ${detour.from}→${detour.to} 与目标区段 ${target.from}→${target.to} 不一致，已拦截。` }
    }
    const idx = route.segments.findIndex((segment) => segment.id === target.id)
    const prev = idx > 0 ? route.segments[idx - 1] : undefined
    const next = idx >= 0 && idx < route.segments.length - 1 ? route.segments[idx + 1] : undefined
    if (prev && prev.to !== target.from) {
      return { ok: false, message: `首尾车站不连续：${prev.name} 终点 ${prev.to} 与绕行段起点 ${detour.from} 不接续，已拦截。` }
    }
    if (next && next.from !== target.to) {
      return { ok: false, message: `首尾车站不连续：绕行段终点 ${detour.to} 与 ${next.name} 起点 ${next.from} 不接续，已拦截。` }
    }
    return { ok: true, message: `绕行段 ${detour.id} 已插入 ${target.from}→${target.to}，首尾车站连续、坐标完整，里程与风险已重算。` }
  }

  /** 由绕行段库区段生成运行区段 */
  toSegment(detour: DetourSegment): RiskSegment {
    return {
      id: detour.id,
      name: detour.name,
      from: detour.from,
      to: detour.to,
      km: detour.km,
      speed: '限速 60',
      risks: ['绕行替代'],
      level: '中',
      status: '已绕行',
      coordinates: detour.coordinates.map((point) => [...point] as [number, number]),
    }
  }

  /** 重算区段里程（Turf 实测，不补直线）与路线风险分 */
  recalculate(segments: RiskSegment[]): { segments: RiskSegment[]; km: number; score: number } {
    const recalculated = segments.map((segment) => ({ ...segment, km: this.segmentKm(segment) }))
    const km = Math.round(recalculated.reduce((sum, segment) => sum + Number(segment.km || 0), 0) * 10) / 10
    return { segments: recalculated, km, score: this.riskScore(recalculated) }
  }

  /** 路线重算：返回新版本的路线对象 */
  recomputeRoute(route: RoutePackage): RoutePackage {
    const { segments, score } = this.recalculate(route.segments)
    return { ...route, segments, score, version: route.version + 1 }
  }

  segmentKm(segment: RiskSegment): string {
    if (!this.hasValidCoordinates(segment.coordinates)) return segment.km
    return length(lineString(segment.coordinates), { units: 'kilometers' }).toFixed(1)
  }

  riskScore(segments: RiskSegment[]): number {
    let score = 40
    for (const segment of segments) {
      if (segment.level === '高') score += 12
      else if (segment.level === '中') score += 6
      if (segment.status === '需绕行') score += 4
    }
    return Math.max(0, Math.min(100, score))
  }

  private hasValidCoordinates(coordinates: [number, number][] | undefined | null): coordinates is [number, number][] {
    return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
  }
}
