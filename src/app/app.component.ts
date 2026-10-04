import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { Store } from '@ngrx/store'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from './store/route.reducer'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatChipsModule],
  template: `
    <mat-toolbar class="topbar">
      <div class="brand"><span>铁</span><div><b>危险货物运输审批台</b><small>RAIL HAZMAT CONTROL</small></div></div>
      <nav><a mat-button routerLink="/workspace" routerLinkActive="active">路径编组</a><a mat-button routerLink="/risk-map" routerLinkActive="active">风险地图</a><a mat-button routerLink="/approval" routerLinkActive="active">多角色审批</a></nav>
      <span class="spacer"></span>
      @if (state$ | async; as state) {
        <mat-chip highlighted>同版本 v{{ selectedVersion(state) }}</mat-chip>
        <mat-chip [class.chip-offline]="!state.online">{{ state.online ? '协同在线 8' : '断网模式 · 待补交 ' + state.pendingChanges.length }}</mat-chip>
      }
      <button mat-flat-button color="primary">提交审批</button>
    </mat-toolbar>
    <router-outlet />
  `,
  styles: [`
    .topbar{height:68px;background:#0f172a;color:#fff;padding:0 22px;position:sticky;top:0;z-index:700}
    .brand{display:flex;align-items:center;gap:11px;min-width:260px}.brand>span{width:36px;height:36px;border-radius:7px;background:#2563eb;display:grid;place-items:center;font-weight:800}.brand b,.brand small{display:block}.brand small{font-size:9px;color:#94a3b8;letter-spacing:1px;margin-top:2px}
    nav{display:flex;gap:4px}nav a{color:#cbd5e1}nav a.active{background:#1e293b;color:#fff}
    .spacer{flex:1}
    mat-chip{margin-left:8px}
    .chip-offline{background:#b45309 !important;color:#fff !important}
    @media(max-width:900px){.topbar{height:auto;min-height:64px;padding:10px;flex-wrap:wrap}.brand{min-width:210px}nav{order:3;width:100%}.brand small,.topbar mat-chip{display:none}}
  `],
})
export class AppComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select((state: { routes: RouteState }) => state.routes)

  selectedVersion(state: RouteState): number {
    return state.routes.find((route) => route.id === state.selectedRouteId)?.version ?? 1
  }
}
