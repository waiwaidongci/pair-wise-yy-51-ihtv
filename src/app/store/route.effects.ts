import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, filter, map, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { RouteVersionService } from '../services/route-version.service'
import { ChangeMergeService } from '../services/change-merge.service'
import type { PendingChange } from '../types'
import { RouteState } from './route.reducer'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly versions = inject(RouteVersionService)
  private readonly merge = inject(ChangeMergeService)
  private readonly store = inject(Store<{ routes: RouteState }>)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRouteData().pipe(
      map((data) => RouteActions.loadRoutesSuccess({ routes: data.items, detours: data.detours })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /** 插入绕行段：在线先校验（首尾车站连续 + 坐标完整），不通过则拦截；断网排入待补交 */
  insertDetour$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.insertDetour),
    withLatestFrom(this.store.select((state: { routes: RouteState }) => state.routes)),
    map(([action, state]) => {
      const route = state.routes.find((item) => item.id === action.routeId)
      const target = route?.segments.find((segment) => segment.id === action.targetSegmentId)
      const detour = state.detours.find((item) => item.id === action.detourId)
      if (!route || !target || !detour) {
        return RouteActions.insertDetourBlocked({ reason: '未找到运输单、目标区段或绕行段，操作未生效。' })
      }
      if (!state.online) {
        return RouteActions.enqueueChange({ change: this.pendingChange(route.id, 'detour', target.id, { detourId: detour.id }, route.version, '当前审阅人') })
      }
      const result = this.versions.validateDetour(route, target, detour)
      if (!result.ok) return RouteActions.insertDetourBlocked({ reason: result.message })
      return RouteActions.insertDetourApplied({ routeId: route.id, targetSegmentId: target.id, detour })
    }),
  ))

  /** 区段顺序调整：在线直接应用并重算；断网排入待补交 */
  reorderSegment$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.reorderSegment),
    withLatestFrom(this.store.select((state: { routes: RouteState }) => state.routes)),
    filter(([action, state]) => !!state.routes.find((route) => route.id === action.routeId)),
    map(([action, state]) => {
      const route = state.routes.find((item) => item.id === action.routeId)!
      if (!state.online) {
        return RouteActions.enqueueChange({ change: this.pendingChange(route.id, 'reorder', action.segmentId, { direction: action.direction }, route.version, '当前审阅人') })
      }
      return RouteActions.reorderSegmentApplied({ routeId: route.id, segmentId: action.segmentId, direction: action.direction })
    }),
  ))

  /** 恢复网络后按操作号合并待补交改动 */
  mergeOnOnline$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.networkChanged),
    filter(({ online }) => online),
    map(() => RouteActions.mergePendingChanges()),
  ))

  mergePending$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.mergePendingChanges),
    withLatestFrom(this.store.select((state: { routes: RouteState }) => state.routes)),
    filter(([, state]) => state.online && state.pendingChanges.some((change) => change.status === 'pending')),
    map(([, state]) => {
      const result = this.merge.merge(state.pendingChanges)
      const routes = this.merge.replay(state.routes, result.merged, state.detours)
      const pendingChanges = state.pendingChanges.map((change) => {
        if (change.status !== 'pending') return change
        if (result.merged.some((item) => item.opNo === change.opNo)) return { ...change, status: 'merged' as const }
        const conflict = result.conflicts.find((item) => item.opNo === change.opNo)
        return conflict ? { ...change, status: 'conflict' as const, conflictReason: conflict.conflictReason } : change
      })
      return RouteActions.mergeApplied({ routes, pendingChanges })
    }),
  ))

  /** 演示：另一位调度员在同一插入位置并发提交改动，操作号靠后，合并时留冲突 */
  simulateConcurrent$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.simulateConcurrentChange),
    withLatestFrom(this.store.select((state: { routes: RouteState }) => state.routes)),
    map(([, state]) => {
      const route = state.routes.find((item) => item.id === state.selectedRouteId)
      const target = route?.segments.find((segment) => segment.status === '需绕行') ?? route?.segments[0]
      const detour = state.detours.find((item) => item.routeId === route?.id && item.coordinates.length >= 2)
      if (!route || !target || !detour) return RouteActions.clearValidation()
      return RouteActions.enqueueChange({ change: this.pendingChange(route.id, 'detour', target.id, { detourId: detour.id }, route.version, '并发调度员') })
    }),
  ))

  private pendingChange(routeId: string, type: PendingChange['type'], targetSegmentId: string, payload: PendingChange['payload'], baseVersion: number, author: string): PendingChange {
    return {
      opNo: this.merge.nextOpNo(),
      routeId,
      type,
      targetSegmentId,
      payload,
      baseVersion,
      status: 'pending',
      author,
      createdAt: new Date().toISOString(),
    }
  }
}
