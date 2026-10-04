import { Injectable, inject } from '@angular/core'
import type { DetourSegment, PendingChange, RoutePackage } from '../types'
import { RouteVersionService } from './route-version.service'

/**
 * 断网改动合并：
 * - 改动按操作号（opNo）排序合并，先到生效；
 * - 两人同时修改同一插入位置（同运输单 + 同目标区段 + 同基准版本）时，
 *   先到的操作号生效，后到的保留冲突，不静默覆盖。
 */
@Injectable({ providedIn: 'root' })
export class ChangeMergeService {
  private readonly versions = inject(RouteVersionService)
  private seq = 0

  /** 生成操作号：OP-yyyyMMdd-序号 */
  nextOpNo(now: Date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0')
    const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    this.seq += 1
    return `OP-${day}-${String(this.seq).padStart(3, '0')}`
  }

  /** 合并结果：merged 已生效，conflicts 留待人工处理 */
  merge(pending: PendingChange[]): { merged: PendingChange[]; conflicts: PendingChange[] } {
    const sorted = [...pending].filter((change) => change.status === 'pending').sort((a, b) => a.opNo.localeCompare(b.opNo))
    const applied = new Map<string, string>()
    const merged: PendingChange[] = []
    const conflicts: PendingChange[] = []
    for (const change of sorted) {
      const key = `${change.routeId}|${change.targetSegmentId}`
      const winner = applied.get(key)
      if (winner && winner !== change.opNo) {
        conflicts.push({
          ...change,
          status: 'conflict',
          conflictReason: `与操作 ${winner} 在同一插入位置冲突，先到已生效，后到留冲突。`,
        })
      } else {
        applied.set(key, change.opNo)
        merged.push({ ...change, status: 'merged' })
      }
    }
    return { merged, conflicts }
  }

  /** 按操作号顺序回放已合并改动，重算里程与风险，受影响路线版本递增 */
  replay(routes: RoutePackage[], merged: PendingChange[], detours: DetourSegment[]): RoutePackage[] {
    const affected = new Set(merged.map((change) => change.routeId))
    return routes.map((route) => {
      if (!affected.has(route.id)) return route
      let segments = route.segments.map((segment) => ({ ...segment }))
      const routeChanges = merged
        .filter((change) => change.routeId === route.id)
        .sort((a, b) => a.opNo.localeCompare(b.opNo))
      for (const change of routeChanges) {
        if (change.type === 'detour' && change.payload.detourId) {
          const detour = detours.find((item) => item.id === change.payload.detourId)
          if (detour) {
            segments = segments.map((segment) => segment.id === change.targetSegmentId ? this.versions.toSegment(detour) : segment)
          }
        } else if (change.type === 'reorder' && change.payload.direction) {
          const index = segments.findIndex((segment) => segment.id === change.targetSegmentId)
          const swapWith = change.payload.direction === 'up' ? index - 1 : index + 1
          if (index >= 0 && swapWith >= 0 && swapWith < segments.length) {
            [segments[index], segments[swapWith]] = [segments[swapWith], segments[index]]
          }
        }
      }
      const recalculated = this.versions.recalculate(segments)
      return { ...route, segments: recalculated.segments, score: recalculated.score, version: route.version + 1 }
    })
  }
}
