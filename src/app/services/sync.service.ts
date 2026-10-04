import { inject, Injectable } from '@angular/core'
import { Store } from '@ngrx/store'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'

/**
 * 网络状态：监听浏览器在线/离线事件；断网时改动登记为待补交，
 * 恢复在线后由 effect 触发按操作号合并。
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly store = inject(Store<{ routes: RouteState }>)

  start() {
    this.store.dispatch(RouteActions.setOnline({ online: navigator.onLine }))
    window.addEventListener('online', () => this.store.dispatch(RouteActions.setOnline({ online: true })))
    window.addEventListener('offline', () => this.store.dispatch(RouteActions.setOnline({ online: false })))
  }
}
