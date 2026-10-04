import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTabsModule } from '@angular/material/tabs'
import { MatChipsModule } from '@angular/material/chips'
import { VersionBannerComponent } from './version-banner.component'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { activeSegments } from '../services/route-domain'
import type { RoutePackage } from '../types'

@Component({
  selector: 'app-approval',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTabsModule, MatChipsModule, VersionBannerComponent],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">安全 · 运营 · 应急会签</p><h1>逐区段审批与退回</h1><p>每条意见锚定运输单与路线版本；绕行或顺序变更后，旧版意见保留并要求在新版本重签。</p></div><button mat-flat-button color="primary" (click)="lockBaseline()">按当前版本锁定基线</button></div>
      <app-version-banner />
      <mat-tab-group>
        <mat-tab label="待处理意见"><section class="card comment-list">
          @for (comment of (state$ | async)?.comments || []; track comment.id) {
            <div class="comment" [class.stale-comment]="isStale(comment)">
              <div class="comment-head">
                <div><b>{{comment.role}} · {{comment.author}}</b><small>{{comment.routeId}} · {{comment.segmentId}} · {{comment.id}}</small></div>
                <div class="head-right">
                  <mat-chip highlighted [color]="isStale(comment) ? 'warn' : 'primary'">锚定 v{{comment.routeVersion}}@if (isStale(comment)) { · 版本失效 }</mat-chip>
                  <span>{{comment.status}}</span>
                </div>
              </div>
              <p>{{comment.content}}</p>
              @if (isStale(comment)) { <p class="stale-note">! 路线已升至 v{{currentVersion(comment.routeId)}}（绕行插入或顺序调整），审批依据旧版须在新版本重新会签；原记录只读保留。</p> }
              <div class="actions"><button mat-stroked-button color="warn" (click)="resolve(comment.id,'已退回')">退回补件</button><button mat-flat-button color="primary" [disabled]="isStale(comment)" (click)="resolve(comment.id,'已接受')">接受条件</button></div>
            </div>
          }
        </section></mat-tab>
        <mat-tab label="发表区段意见"><section class="card form-card">
          @if (selectedRoute; as route) {
            <p class="hint">本意见将锚定 <b>{{route.id}} v{{route.version}}</b>，与工作台、地图使用同一版本。</p>
            <div class="two">
              <mat-form-field><mat-label>专业角色</mat-label><mat-select [(ngModel)]="role"><mat-option>安全</mat-option><mat-option>运营</mat-option><mat-option>应急</mat-option></mat-select></mat-form-field>
              <mat-form-field><mat-label>运行区段（当前版本）</mat-label><mat-select [(ngModel)]="segmentId"><mat-option *ngFor="let segment of segments" [value]="segment.id">{{segment.id}} · {{segment.from}}→{{segment.to}} · {{segment.name}}</mat-option></mat-select></mat-form-field>
            </div>
            <mat-form-field class="wide"><mat-label>审批条件与依据</mat-label><textarea matInput rows="5" [(ngModel)]="content" placeholder="明确区段、约束、时限与验收证据；路线再变更后需按新版本重签"></textarea></mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!content.trim()" (click)="addComment()">提交意见（v{{route.version}}）</button>
          }
        </section></mat-tab>
        <mat-tab label="审计时间线"><section class="card timeline">
          @if (((state$ | async)?.audit || []).length === 0) { <p class="empty">尚无版本操作，插入绕行段或调整顺序后在此留痕。</p> }
          @for (entry of (state$ | async)?.audit || []; track entry.id) {
            <div><i></i><b>{{entry.time}} · {{entry.text}}</b><p>{{entry.detail}}</p><small>{{entry.routeId}} · 路线版本 v{{entry.routeVersion}}</small></div>
          }
        </section></mat-tab>
      </mat-tab-group>
    </main>
  `,
  styles: [`
    h2{margin:0}.comment-list{padding:0}.comment{padding:18px;border-bottom:1px solid #e7ebf1;border-left:3px solid #2563eb}.comment.stale-comment{border-left-color:#dc2626;background:#fffdfa}.comment-head{display:flex;justify-content:space-between;align-items:flex-start}.comment-head small{display:block;color:#7a8798;margin-top:4px}.head-right{display:flex;align-items:center;gap:10px}.comment p{color:#475569}.stale-note{color:#991b1b!important;font-size:13px}.actions{display:flex;gap:10px}.actions button{margin:8px 8px 0 0}.form-card{max-width:780px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field,.wide{width:100%}.hint{color:#667085;margin:0 0 14px}.timeline{padding:8px 18px}.timeline>div{position:relative;padding:14px 10px 14px 28px;border-left:2px solid #cbd5e1}.timeline i{position:absolute;width:9px;height:9px;border-radius:50%;background:#2563eb;left:-5.5px;top:20px}.timeline p{color:#475569;margin:5px 0 0}.timeline small{color:#94a3b8}.empty{color:#94a3b8}
    @media(max-width:620px){.two{grid-template-columns:1fr}}
  `],
})
export class ApprovalComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  role = '安全'
  segmentId = ''
  content = ''
  selectedRoute: RoutePackage | undefined
  segments: RoutePackage['segments'] = []

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.selectedRoute = state.routes.find((route) => route.id === state.selectedRouteId)
      this.segments = this.selectedRoute ? activeSegments(this.selectedRoute) : []
      if (this.selectedRoute && !this.segments.some((segment) => segment.id === this.segmentId)) {
        this.segmentId = this.segments[0]?.id ?? ''
      }
    })
  }

  currentVersion(routeId: string): number {
    let version = 0
    this.state$.subscribe((state: RouteState) => { version = state.routes.find((route) => route.id === routeId)?.version ?? 0 }).unsubscribe()
    return version
  }

  isStale(comment: RouteState['comments'][number]): boolean {
    return comment.routeVersion !== this.currentVersion(comment.routeId)
  }

  addComment() {
    if (!this.selectedRoute) return
    this.store.dispatch(RouteActions.addComment({
      comment: {
        id: `RV-${Date.now().toString().slice(-5)}`,
        routeId: this.selectedRoute.id,
        routeVersion: this.selectedRoute.version,
        segmentId: this.segmentId,
        role: this.role,
        author: '当前审阅人',
        content: this.content,
        status: '待确认',
        createdAt: '刚刚',
      },
    }))
    this.content = ''
  }

  resolve(id: string, status: '已接受' | '已退回') { this.store.dispatch(RouteActions.resolveComment({ id, status })) }
  lockBaseline() {
    const route = this.selectedRoute
    alert(route ? `基线已按 ${route.id} v${route.version} 锁定：运输单、运行区段、替代路线、地图与全部会签意见以该版本快照只读保存。` : '请先选择运输单。')
  }
}
