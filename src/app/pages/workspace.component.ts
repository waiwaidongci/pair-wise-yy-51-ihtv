import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { MatChipsModule } from '@angular/material/chips'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { RoutePackage } from '../types'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatDividerModule, MatChipsModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">运输许可与路径编组</p>
          <h1>危险货物运输路径审批</h1>
          <p>核对货物类别、编组、许可与区段约束，运输单、区段、替代路线与会签按同一路线版本联动。</p>
        </div>
        <div class="head-actions">
          <mat-chip highlighted>当前版本 v{{ selectedRoute?.version ?? 1 }}</mat-chip>
          <button mat-stroked-button (click)="createAlternative()">生成替代方案</button>
          <button mat-flat-button color="primary" (click)="refresh()">重新校验</button>
        </div>
      </div>
      <div class="grid-4">
        <article class="card metric"><span>待审批路径</span><strong>{{ (state$ | async)?.routes?.length || 0 }}</strong><small>今日新增 2 条</small></article>
        <article class="card metric"><span>高风险区段</span><strong class="risk-high">{{ highRiskCount }}</strong><small>需安全与应急会签</small></article>
        <article class="card metric"><span>许可缺失</span><strong class="risk-mid">1</strong><small>不得进入审批通过态</small></article>
        <article class="card metric"><span>当前草案</span><strong>v{{ selectedRoute?.version ?? 1 }}</strong><small>区段改动后地图与会签同步重算</small></article>
      </div>
      @if ((state$ | async)?.loading) { <mat-progress-bar mode="indeterminate" /> }
      @if (state$ | async; as state) {
        @if (state.notice) { <div class="notice">{{ state.notice }}</div> }
        @if (state.lastValidation) {
          <div class="notice" [class.notice-ok]="state.lastValidation.ok" [class.notice-err]="!state.lastValidation.ok">
            <b>{{ state.lastValidation.ok ? '已应用' : '已拦截' }}</b>{{ state.lastValidation.message }}
            <button mat-button (click)="dismissValidation()">知道了</button>
          </div>
        }
        @if (!state.online) { <div class="notice notice-err"><b>断网模式</b>：插入绕行段与顺序调整将先排成待补交队列，操作号连续，恢复网络后按操作号合并。</div> }
      }
      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar"><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>货物类别</mat-label><mat-select><mat-option>全部类别</mat-option><mat-option>第 3 类 易燃液体</mat-option><mat-option>第 8 类 腐蚀品</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批状态</mat-label><mat-select><mat-option>全部状态</mat-option><mat-option>待安全复核</mat-option><mat-option>待应急复核</mat-option></mat-select></mat-form-field><span class="spacer"></span><button mat-stroked-button>导出审批包</button></div>
          <table mat-table [dataSource]="(state$ | async)?.routes || []">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">{{row.updatedAt}} · v{{row.version}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}</td></ng-container>
            <ng-container matColumnDef="permission"><th mat-header-cell *matHeaderCellDef>许可</th><td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span></td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100</td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">审核</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === selectedId"></tr>
          </table>
        </section>
        <aside class="card">
          <h2>规则引擎结论</h2>
          @for (route of (state$ | async)?.routes || []; track route.id) {
            <div class="rule" [class.active]="route.id === selectedId"><div><b>{{route.trainCode}}</b><span>{{route.segments.length}} 个运行区段 · v{{route.version}}</span></div><strong [class.risk-high]="route.score >= 70" [class.risk-mid]="route.score < 70">{{route.score >= 70 ? '高风险' : '需复核' }}</strong></div>
          }
          <mat-divider />
          <h3>强制校验项</h3>
          <p>✓ 罐车编组隔离与押运资质</p><p class="risk-high">! S-203 水源地保护段缺少属地放行函</p><p>✓ 替代路径具备接卸条件</p>
          <button mat-flat-button color="primary" style="width:100%" (click)="createAlternative()">要求补充替代方案</button>
        </aside>
      </div>

      <div class="grid-2">
        <section class="card">
          <h2>绕行插入与区段顺序</h2>
          <p class="hint">插入绕行段核对首尾车站连续与坐标完整；缺坐标或车站不连续直接拦截，不用直线补齐。顺序调整后里程、风险、地图与会签按新版本重算。</p>
          <div class="toolbar">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>目标区段（需绕行）</mat-label><mat-select [(ngModel)]="targetSegmentId"><mat-option *ngFor="let segment of bypassSegments" [value]="segment.id">{{segment.id}} · {{segment.from}}→{{segment.to}}</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>绕行段</mat-label><mat-select [(ngModel)]="detourId"><mat-option *ngFor="let detour of detoursForRoute" [value]="detour.id">{{detour.id}} · {{detour.from}}→{{detour.to}} @if (detour.coordinates.length < 2) {（缺坐标）}</mat-option></mat-select></mat-form-field>
            <button mat-flat-button color="primary" (click)="insertDetour()" [disabled]="!targetSegmentId || !detourId">插入绕行段</button>
          </div>
          <mat-divider />
          <h3>运行区段顺序</h3>
          @for (segment of selectedRoute?.segments || []; track segment.id; let i = $index) {
            <div class="segment-row">
              <span><b>{{segment.name}}</b><small>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.level}} · {{segment.status}}</small></span>
              <span class="segment-actions">
                <button mat-icon-button [disabled]="i === 0" (click)="reorder(segment.id, 'up')" title="上移">↑</button>
                <button mat-icon-button [disabled]="i === (selectedRoute?.segments?.length || 0) - 1" (click)="reorder(segment.id, 'down')" title="下移">↓</button>
              </span>
            </div>
          }
        </section>
        <section class="card">
          <h2>断网补交与并发冲突</h2>
          <p class="hint">断网改动先排成待补交队列，恢复后按操作号合并；同一插入位置先到生效，后到留冲突。</p>
          <div class="toolbar">
            <button mat-stroked-button (click)="toggleNetwork()">{{ (state$ | async)?.online ? '模拟断网' : '恢复网络' }}</button>
            <button mat-stroked-button (click)="simulateConcurrent()">模拟他人并发修改</button>
            <button mat-flat-button color="primary" (click)="mergeNow()" [disabled]="!(state$ | async)?.pendingChanges?.length">立即补交合并</button>
          </div>
          <h3>待补交队列</h3>
          @if ((state$ | async)?.pendingChanges?.length === 0) { <p class="hint">队列为空。</p> }
          @for (change of (state$ | async)?.pendingChanges || []; track change.opNo) {
            <div class="change-row" [class.change-conflict]="change.status === 'conflict'" [class.change-merged]="change.status === 'merged'" [class.change-discarded]="change.status === 'discarded'">
              <span><b>{{change.opNo}}</b><small>{{change.routeId}} · {{change.type === 'detour' ? '插入绕行段' : '顺序调整'}} · {{change.targetSegmentId}} · {{change.author}} · 基准 v{{change.baseVersion}}</small>
                @if (change.conflictReason) { <em>{{change.conflictReason}}</em> }
              </span>
              <span class="change-status">
                @switch (change.status) {
                  @case ('pending') { <mat-chip>待补交</mat-chip> }
                  @case ('merged') { <mat-chip highlighted>已生效</mat-chip> }
                  @case ('conflict') { <mat-chip color="warn">冲突</mat-chip> }
                  @case ('discarded') { <mat-chip>已放弃</mat-chip> }
                }
                @if (change.status === 'conflict') { <button mat-button color="warn" (click)="discardConflict(change.opNo)">放弃后到操作</button> }
              </span>
            </div>
          }
          <mat-divider />
          <h3>替代路线（锚定版本）</h3>
          @if ((state$ | async)?.alternatives?.length === 0) { <p class="hint">尚未生成替代路线。</p> }
          @for (alternative of (state$ | async)?.alternatives || []; track alternative.id) {
            <div class="change-row"><span><b>{{alternative.id}}</b><small>{{alternative.name}} · {{alternative.km}} km · 风险 {{alternative.score}} · {{alternative.author}}</small></span><mat-chip>v{{alternative.version}}</mat-chip></div>
          }
        </section>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}.rule{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #edf0f5}.rule span{display:block;color:#7a8798;font-size:12px;margin-top:4px}.rule.active{padding-left:10px;border-left:3px solid #2563eb}.rule strong{font-size:12px}.toolbar{margin-bottom:10px;flex-wrap:wrap}.toolbar mat-form-field{width:200px}.head-actions{display:flex;align-items:center;gap:10px}.hint{color:#7a8798;font-size:13px;margin:0 0 12px}.notice{display:flex;align-items:center;gap:10px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;padding:10px 14px;border-radius:6px;margin-bottom:12px}.notice-ok{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}.notice-err{background:#fef2f2;border-color:#fca5a5;color:#991b1b}.notice b{margin-right:6px}.notice button{margin-left:auto}.segment-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}.segment-row b,.segment-row small{display:block}.segment-row small{color:#7a8798;font-size:12px;margin-top:3px}.segment-actions{display:flex;gap:2px}.change-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #edf0f5}.change-row b,.change-row small{display:block}.change-row small{color:#7a8798;font-size:12px;margin-top:3px}.change-row em{display:block;color:#b45309;font-size:12px;font-style:normal;margin-top:3px}.change-status{display:flex;align-items:center;gap:8px;flex-shrink:0}.change-conflict{background:#fef2f2}.change-merged{background:#ecfdf5}.change-discarded{opacity:.55}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select((state: { routes: RouteState }) => state.routes)
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'action']
  selectedId = ''
  highRiskCount = 0
  targetSegmentId = ''
  detourId = ''

  get selectedRoute(): RoutePackage | undefined {
    let route: RoutePackage | undefined
    this.state$.subscribe((state) => { route = state.routes.find((item) => item.id === state.selectedRouteId) }).unsubscribe()
    return route
  }

  get detoursForRoute() {
    let detours: RouteState['detours'] = []
    this.state$.subscribe((state) => { detours = state.detours.filter((detour) => detour.routeId === state.selectedRouteId) }).unsubscribe()
    return detours
  }

  get bypassSegments() {
    return this.selectedRoute?.segments.filter((segment) => segment.status === '需绕行') ?? []
  }

  constructor() {
    this.state$.subscribe((state) => {
      this.selectedId = state.selectedRouteId
      this.highRiskCount = state.routes.flatMap((route: RoutePackage) => route.segments).filter((segment) => segment.level === '高').length
      if (!this.targetSegmentId) this.targetSegmentId = this.bypassSegments[0]?.id ?? ''
    })
  }
  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }
  createAlternative() { this.store.dispatch(RouteActions.createAlternative()) }
  dismissValidation() { this.store.dispatch(RouteActions.clearValidation()) }

  insertDetour() {
    if (this.selectedRoute && this.targetSegmentId && this.detourId) {
      this.store.dispatch(RouteActions.insertDetour({ routeId: this.selectedRoute.id, targetSegmentId: this.targetSegmentId, detourId: this.detourId }))
    }
  }
  reorder(segmentId: string, direction: 'up' | 'down') {
    if (this.selectedRoute) this.store.dispatch(RouteActions.reorderSegment({ routeId: this.selectedRoute.id, segmentId, direction }))
  }
  toggleNetwork() {
    let online = true
    this.state$.subscribe((state) => { online = state.online }).unsubscribe()
    this.store.dispatch(RouteActions.networkChanged({ online: !online }))
  }
  mergeNow() { this.store.dispatch(RouteActions.mergePendingChanges()) }
  simulateConcurrent() { this.store.dispatch(RouteActions.simulateConcurrentChange()) }
  discardConflict(opNo: string) { this.store.dispatch(RouteActions.resolveConflict({ opNo })) }
}
