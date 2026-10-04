import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'

/**
 * 工作台、地图、审批页共用的路线版本横幅：
 * 运输单 / 运行区段 / 替代路线 / 会签意见必须显示同一路线版本。
 */
@Component({
  selector: 'app-version-banner',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatChipsModule],
  template: `
    @if (state$ | async; as state) {
      @if (route; as route) {
        <section class="banner" [class.offline]="!state.online" [class.conflict]="conflictCount > 0">
          <div class="version-block">
            <span class="label">运输单（路线版本）</span>
            <b>{{ route.id }}</b>
            <span class="version">v{{ route.version }}</span>
            <small>{{ route.trainCode }} · {{ route.origin }} → {{ route.destination }} · {{ route.segments.length }} 区段</small>
          </div>
          <div class="version-block mid">
            <span class="label">同源依据</span>
            <small>运行区段 {{ activeCount }} 段 · 绕行段 {{ detourCount }} 段 · 地图里程 {{ totalKm }} km · 风险分 {{ route.score }}</small>
            <small class="sign">会签意见 {{ routeComments.length }} 条
              @if (staleComments.length) { <em class="stale">（{{ staleComments.length }} 条锚定旧版本，需重签）</em> }
            </small>
          </div>
          <div class="version-block actions">
            <mat-chip [highlighted]="state.online" [color]="state.online ? 'primary' : 'warn'">
              {{ state.online ? '在线' : '断网 · 改动待补交' }}
            </mat-chip>
            @if (pendingCount) { <mat-chip color="accent" highlighted>待补交 {{ pendingCount }}</mat-chip> }
            @if (conflictCount) { <mat-chip color="warn" highlighted>冲突 {{ conflictCount }}</mat-chip> }
            <button mat-stroked-button (click)="toggleNetwork()">{{ state.online ? '模拟断网' : '模拟恢复网络' }}</button>
            @if (state.online && pendingCount) { <button mat-flat-button color="primary" (click)="flush()">立即按操作号合并</button> }
          </div>
        </section>
        @if (state.notice) {
          <p class="notice" [class.error]="state.notice.kind === 'error'" [class.success]="state.notice.kind === 'success'">{{ state.notice.text }}</p>
        }
      }
    }
  `,
  styles: [`
    .banner{display:flex;gap:26px;align-items:center;flex-wrap:wrap;background:#0f172a;color:#f8fafc;border-radius:8px;padding:12px 18px;margin-bottom:14px;border-left:5px solid #2563eb}
    .banner.offline{border-left-color:#d97706}.banner.conflict{border-left-color:#dc2626}
    .version-block{display:flex;flex-direction:column;gap:3px}.version-block.mid{flex:1;min-width:300px}
    .version-block.actions{flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap}
    .label{font-size:11px;letter-spacing:1px;color:#94a3b8}
    .version{display:inline-block;background:#2563eb;color:#fff;border-radius:5px;padding:1px 9px;font-weight:700;margin-left:8px}
    .banner b{display:inline}.banner small{color:#cbd5e1}
    .banner .sign em{color:#fbbf24;font-style:normal}
    .banner .stale{color:#fca5a5}
    .banner button{color:#f8fafc;border-color:#475569}
    .banner button:hover{background:#1e293b}
    .notice{margin:-4px 0 14px;padding:9px 14px;border-radius:6px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}
    .notice.error{background:#fef2f2;border-color:#fecaca;color:#991b1b}
    .notice.success{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
  `],
})
export class VersionBannerComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')

  get route() {
    let result: RouteState['routes'][number] | undefined
    this.state$.subscribe((state: RouteState) => { result = state.routes.find((route) => route.id === state.selectedRouteId) }).unsubscribe()
    return result
  }

  get activeCount() { return this.route ? this.route.segments.filter((segment) => segment.status !== '已绕行').length : 0 }
  get detourCount() { return this.route ? this.route.segments.filter((segment) => segment.kind === 'detour').length : 0 }
  get totalKm() {
    if (!this.route) return '0.0'
    return this.route.segments
      .filter((segment) => segment.status !== '已绕行')
      .reduce((sum, segment) => sum + Number(segment.km), 0)
      .toFixed(1)
  }

  get routeComments() {
    let comments: RouteState['comments'] = []
    if (this.route) {
      const id = this.route.id
      this.state$.subscribe((state: RouteState) => { comments = state.comments.filter((comment) => comment.routeId === id) }).unsubscribe()
    }
    return comments
  }

  get staleComments() {
    return this.route ? this.routeComments.filter((comment) => comment.routeVersion !== this.route!.version) : []
  }

  get pendingCount() {
    let count = 0
    this.state$.subscribe((state: RouteState) => { count = state.pending.filter((item) => item.status === '待补交').length }).unsubscribe()
    return count
  }

  get conflictCount() {
    let count = 0
    this.state$.subscribe((state: RouteState) => { count = state.conflicts.filter((conflict) => !conflict.resolved).length }).unsubscribe()
    return count
  }

  toggleNetwork() {
    let online = true
    this.state$.subscribe((state: RouteState) => { online = state.online }).unsubscribe()
    this.store.dispatch(RouteActions.setOnline({ online: !online }))
  }

  flush() { this.store.dispatch(RouteActions.flushPending()) }
}
