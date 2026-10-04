import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { MatChipsModule } from '@angular/material/chips'
import { VersionBannerComponent } from './version-banner.component'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { activeSegments, detourKey } from '../services/route-domain'
import type { DetourDraft, PendingItem, RoutePackage } from '../types'

const RISK_OPTIONS = ['水源地', '长隧道', '隧道', '隧道群', '跨河桥', '桥梁群', '高架桥', '人口密集', '人员密集', '枢纽密集']

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressBarModule, MatDividerModule, MatChipsModule, VersionBannerComponent],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">运输许可与路径编组</p><h1>危险货物运输路径审批</h1><p>运输单、运行区段、替代路线与会签意见锚定同一版本：绕行插入强制核对首尾车站与坐标。</p></div><button mat-flat-button color="primary" (click)="refresh()">重新校验</button></div>
      <app-version-banner />
      <div class="grid-4">
        <article class="card metric"><span>运输单</span><strong>{{ (state$ | async)?.routes?.length || 0 }}</strong><small>均携带当前路线版本</small></article>
        <article class="card metric"><span>高风险区段</span><strong class="risk-high">{{ highRiskCount }}</strong><small>需安全与应急会签</small></article>
        <article class="card metric"><span>待补交操作</span><strong class="risk-mid">{{ pendingCount }}</strong><small>恢复后按操作号合并</small></article>
        <article class="card metric"><span>未决冲突</span><strong [class.risk-high]="conflictCount > 0">{{ conflictCount }}</strong><small>同插入位置先到生效</small></article>
      </div>
      @if ((state$ | async)?.loading) { <mat-progress-bar mode="indeterminate" /> }
      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar"><h2 style="margin:0">运输单与版本</h2><span class="spacer"></span><button mat-stroked-button>导出审批包（含版本快照）</button></div>
          <table mat-table [dataSource]="(state$ | async)?.routes || []">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">{{row.updatedAt}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}<small class="block">{{activeCount(row)}} 个运行区段 · {{detourCount(row)}} 绕行</small></td></ng-container>
            <ng-container matColumnDef="permission"><th mat-header-cell *matHeaderCellDef>许可</th><td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span></td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分 / 版本</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100<mat-chip highlighted class="ver-chip">v{{row.version}}</mat-chip></td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">打开</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === selectedId"></tr>
          </table>
        </section>
        <aside class="card">
          <h2>插入绕行段（替代路线）</h2>
          @if (selectedRoute; as route) {
            <p class="hint">当前依据：{{route.id}} <b>v{{route.version}}</b>。插入通过后运输单、地图与会签页同时切到新版本。</p>
            <div class="form-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>操作人</mat-label><input matInput [(ngModel)]="operator" placeholder="调度员姓名"></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>绕行锚点区段</mat-label>
                <mat-select [(ngModel)]="anchorSegmentId">
                  @for (segment of active(route); track segment.id) {
                    <mat-option [value]="segment.id" [disabled]="segment.kind === 'detour'">{{segment.id}} · {{segment.from}}→{{segment.to}}（{{segment.name}}）</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="form-row">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>绕行方式</mat-label>
                <mat-select [(ngModel)]="mode" (ngModelChange)="prefillByAnchor()">
                  <mat-option value="bypass">整体绕行锚点（首尾与锚点一致）</mat-option>
                  <mat-option value="continue">接续绕行（首接锚点尾，尾接下一区段首）</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>绕行段名称</mat-label><input matInput [(ngModel)]="name" placeholder="如：西峡北翼水源地绕行线"></mat-form-field>
            </div>
            <div class="form-row three">
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>首站（须连续）</mat-label><input matInput [(ngModel)]="fromStation"></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>尾站（须连续）</mat-label><input matInput [(ngModel)]="toStation"></mat-form-field>
              <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>限速</mat-label>
                <mat-select [(ngModel)]="speed"><mat-option>限速 45</mat-option><mat-option>限速 60</mat-option><mat-option>限速 80</mat-option></mat-select>
              </mat-form-field>
            </div>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full"><mat-label>绕行风险因素</mat-label>
              <mat-select [(ngModel)]="risks" multiple><mat-option *ngFor="let risk of riskOptions" [value]="risk">{{risk}}</mat-option></mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full"><mat-label>绕行段折线坐标（经度,纬度，每行一点，至少含首尾及中间点）</mat-label>
              <textarea matInput rows="4" [(ngModel)]="coordinatesText" placeholder="105.72,34.58&#10;106.10,35.10&#10;107.20,34.36"></textarea>
            </mat-form-field>
            <div class="actions">
              <button mat-stroked-button (click)="fillEndpoints()">填入锚点首尾坐标</button>
              <span class="spacer"></span>
              <button mat-flat-button color="primary" (click)="submit()">核对并插入绕行段</button>
            </div>
            <p class="rule-note">强制规则：首尾车站必须与相邻区段连续；缺坐标或仅给首尾两点将被拦截，系统不以直线补齐。</p>
          }
        </aside>
      </div>

      <div class="grid-2" style="margin-top:16px">
        <section class="card">
          <h2>待补交 / 合并队列</h2>
          <p class="hint">断网改动先排成待补交；恢复网络后严格按操作号合并，同位置先到生效。</p>
          @if (pending.length === 0) { <p class="empty">暂无离线操作</p> }
          @for (item of pending; track item.seq) {
            <div class="queue-item" [class.done]="item.status==='已并入'" [class.held]="item.status==='冲突保留'" [class.givenup]="item.status==='已放弃'">
              <div class="queue-head"><b>#{{item.seq}} · {{item.mutation.type === 'detour' ? '插入绕行段' : '区段重排'}}</b>
                <span class="status" [class.s-ok]="item.status==='已并入'" [class.s-warn]="item.status==='待补交'" [class.s-err]="item.status==='冲突保留'" [class.s-mute]="item.status==='已放弃'">{{item.status}}</span>
              </div>
              <small>{{item.createdAt}} · {{item.mutation.operator}} · {{item.mutation.routeId}}</small>
              @if (item.mutation.type === 'detour') { <small class="block">锚点 {{item.mutation.draft.anchorSegmentId}} ·「{{item.mutation.draft.name || '未命名绕行段'}}」{{item.mutation.draft.from}}→{{item.mutation.draft.to}}</small> }
              @if (item.reason) { <p class="reason">{{item.reason}}</p> }
              @if (item.status === '待补交') { <div class="actions"><button mat-stroked-button color="warn" (click)="discard(item)">放弃</button>@if (online) {<button mat-flat-button color="primary" (click)="flush()">立即合并</button>}</div> }
            </div>
          }
        </section>
        <section class="card">
          <h2>同位置冲突裁决</h2>
          <p class="hint">两人同时修改同一插入位置：先到操作生效，后到操作保留冲突，由责任人强制并入或放弃。</p>
          @if (conflicts.length === 0) { <p class="empty">暂无冲突</p> }
          @for (conflict of conflicts; track conflict.loserSeq) {
            <div class="queue-item" [class.done]="conflict.resolved" [class.held]="!conflict.resolved">
              <div class="queue-head"><b>#{{conflict.loserSeq}} 对 #{{conflict.winnerSeq}}</b>
                <span class="status" [class.s-ok]="conflict.resolved" [class.s-err]="!conflict.resolved">{{conflict.resolved ? ('已处理 · ' + (conflict.resolution || '')) : '冲突保留'}}</span>
              </div>
              <small>{{conflict.routeId}} · {{conflict.createdAt}}</small>
              <p class="reason">{{conflict.reason}}</p>
              @if (!conflict.resolved) {
                <div class="actions">
                  <button mat-stroked-button color="warn" (click)="resolveConflict(conflict.loserSeq, '放弃')">后到放弃</button>
                  <button mat-flat-button color="primary" (click)="resolveConflict(conflict.loserSeq, '强制并入')">按当前路线强制并入后到</button>
                </div>
              }
            </div>
          }
          <mat-divider style="margin:12px 0" />
          <h3>强制校验项</h3>
          <p class="check">✓ 所有区段首尾车站连续后才允许升版</p>
          <p class="check">✓ 绕行段缺坐标一律拦截，不做直线补齐</p>
          <p class="check">✓ 顺序一变，里程、风险、地图、会签锚点全部重算</p>
        </section>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}.ver-chip{margin-left:8px;font-size:11px}
    .hint{color:#667085;font-size:13px;margin-bottom:12px}.form-row{display:flex;gap:12px}.form-row.three mat-form-field{flex:1}.form-row mat-form-field{flex:1}.full{width:100%}.actions{display:flex;gap:10px;align-items:center}
    .rule-note{font-size:12px;color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 10px;margin:10px 0 0}
    .queue-item{border:1px solid #e1e7ef;border-left-width:3px;border-radius:6px;padding:10px 12px;margin:8px 0;background:#f8fafc}
    .queue-item.done{border-left-color:#15803d;opacity:.72}.queue-item.held{border-left-color:#dc2626;background:#fef2f2}.queue-item.givenup{border-left-color:#94a3b8;opacity:.6}
    .queue-head{display:flex;justify-content:space-between;align-items:center}.queue-head small{color:#7a8798}.queue-item>small{color:#7a8798}
    .status{font-size:12px;padding:2px 8px;border-radius:10px;background:#e2e8f0}.s-ok{background:#dcfce7;color:#166534}.s-warn{background:#fef3c7;color:#92400e}.s-err{background:#fee2e2;color:#991b1b}.s-mute{background:#e2e8f0;color:#475569}
    .reason{margin:6px 0 0;color:#991b1b;font-size:13px}.empty{color:#94a3b8}.check{margin:4px 0;color:#475569;font-size:13px}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'action']
  readonly riskOptions = RISK_OPTIONS
  selectedId = ''
  selectedRoute: RoutePackage | undefined
  highRiskCount = 0
  pending: PendingItem[] = []
  conflicts: RouteState['conflicts'] = []
  pendingCount = 0
  conflictCount = 0
  online = true

  operator = ''
  anchorSegmentId = ''
  mode: 'bypass' | 'continue' = 'bypass'
  name = ''
  fromStation = ''
  toStation = ''
  speed = '限速 45'
  risks: string[] = ['水源地']
  coordinatesText = ''

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.selectedId = state.selectedRouteId
      this.selectedRoute = state.routes.find((route) => route.id === state.selectedRouteId)
      this.highRiskCount = state.routes.flatMap((route) => activeSegments(route)).filter((segment) => segment.level === '高').length
      this.pending = [...state.pending].sort((a, b) => a.seq - b.seq)
      this.conflicts = state.conflicts
      this.pendingCount = state.pending.filter((item) => item.status === '待补交').length
      this.conflictCount = state.conflicts.filter((conflict) => !conflict.resolved).length
      this.online = state.online
      const anchors = this.selectedRoute ? activeSegments(this.selectedRoute) : []
      if (this.selectedRoute && (!this.anchorSegmentId || !anchors.some((segment) => segment.id === this.anchorSegmentId))) {
        this.anchorSegmentId = anchors[0]?.id ?? ''
        this.prefillByAnchor()
      }
    })
  }

  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }

  active(route: RoutePackage) { return activeSegments(route) }
  activeCount(route: RoutePackage) { return activeSegments(route).length }
  detourCount(route: RoutePackage) { return route.segments.filter((segment) => segment.kind === 'detour').length }

  private anchor() {
    return this.selectedRoute ? activeSegments(this.selectedRoute).find((segment) => segment.id === this.anchorSegmentId) : undefined
  }

  prefillByAnchor() {
    const anchor = this.anchor()
    if (!anchor || !this.selectedRoute) return
    const order = activeSegments(this.selectedRoute)
    const next = order[order.indexOf(anchor) + 1]
    this.fromStation = this.mode === 'bypass' ? anchor.from : anchor.to
    this.toStation = this.mode === 'bypass' ? anchor.to : (next?.from ?? anchor.to)
  }

  fillEndpoints() {
    const anchor = this.anchor()
    if (!anchor) return
    const first = anchor.coordinates[0]
    const last = anchor.coordinates[anchor.coordinates.length - 1]
    this.coordinatesText = `${first[0]},${first[1]}\n（请补充中间折线点，禁止直线补齐）\n${last[0]},${last[1]}`
  }

  submit() {
    if (!this.selectedRoute) return
    const draft: DetourDraft = {
      routeId: this.selectedRoute.id,
      anchorSegmentId: this.anchorSegmentId,
      mode: this.mode,
      name: this.name,
      from: this.fromStation,
      to: this.toStation,
      speed: this.speed,
      risks: this.risks,
      coordinatesText: this.coordinatesText,
    }
    this.store.dispatch(RouteActions.insertDetour({ draft, operator: this.operator.trim() || '当前调度员' }))
  }

  discard(item: PendingItem) { this.store.dispatch(RouteActions.discardPending({ seq: item.seq })) }
  flush() { this.store.dispatch(RouteActions.flushPending()) }
  resolveConflict(seq: number, resolution: '强制并入' | '放弃') { this.store.dispatch(RouteActions.resolveConflict({ seq, resolution })) }
  protected readonly detourKey = detourKey
}
