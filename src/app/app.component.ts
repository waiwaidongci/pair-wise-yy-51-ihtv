import { Component, inject } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { Store } from '@ngrx/store'
import { CommonModule } from '@angular/common'
import { RouteState } from './store/route.reducer'
import { SyncService } from './services/sync.service'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatChipsModule, CommonModule],
  template: `
    <mat-toolbar class="topbar">
      <div class="brand"><span>铁</span><div><b>危险货物运输审批台</b><small>RAIL HAZMAT CONTROL</small></div></div>
      <nav><a mat-button routerLink="/workspace" routerLinkActive="active">路径编组</a><a mat-button routerLink="/risk-map" routerLinkActive="active">风险地图</a><a mat-button routerLink="/approval" routerLinkActive="active">多角色审批</a></nav>
      <span class="spacer"></span>
      <mat-chip [highlighted]="online" [color]="online ? 'primary' : 'warn'">{{online ? '在线' : '断网 · 待补交 ' + pendingCount}}</mat-chip>
      @if (conflictCount > 0) { <mat-chip color="warn" highlighted>同位置冲突 {{conflictCount}}</mat-chip> }
    </mat-toolbar>
    <router-outlet />
  `,
  styles: [`
    .topbar{height:68px;background:#0f172a;color:#fff;padding:0 22px;position:sticky;top:0;z-index:700}
    .brand{display:flex;align-items:center;gap:11px;min-width:260px}.brand>span{width:36px;height:36px;border-radius:7px;background:#2563eb;display:grid;place-items:center;font-weight:800}.brand b,.brand small{display:block}.brand small{font-size:9px;color:#94a3b8;letter-spacing:1px;margin-top:2px}
    nav{display:flex;gap:4px}nav a{color:#cbd5e1}nav a.active{background:#1e293b;color:#fff}
    @media(max-width:900px){.topbar{height:auto;min-height:64px;padding:10px;flex-wrap:wrap}.brand{min-width:210px}nav{order:3;width:100%}.brand small,.topbar mat-chip{display:none}}
  `],
})
export class AppComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  private readonly sync = inject(SyncService)
  online = true
  pendingCount = 0
  conflictCount = 0

  constructor() {
    this.sync.start()
    this.store.select('routes').subscribe((state: RouteState) => {
      this.online = state.online
      this.pendingCount = state.pending.filter((item) => item.status === '待补交').length
      this.conflictCount = state.conflicts.filter((conflict) => !conflict.resolved).length
    })
  }
}
