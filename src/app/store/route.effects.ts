import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { catchError, filter, map, of, switchMap } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  /** 网络恢复后自动触发：待补交队列按操作号顺序合并 */
  flushOnReconnect$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.setOnline),
    filter(({ online }) => online),
    map(() => RouteActions.flushPending()),
  ))
}
