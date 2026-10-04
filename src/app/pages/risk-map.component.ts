import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatDividerModule } from '@angular/material/divider'
import maplibregl, { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import type { ReorderDraft, RoutePackage, RiskSegment } from '../types'
import { activeSegments, checkContinuity, segmentLengthKm } from '../services/route-domain'
import { VersionBannerComponent } from './version-banner.component'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'

@Component({
  selector: 'app-risk-map',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatSelectModule, MatFormFieldModule, MatCheckboxModule, MatDividerModule, VersionBannerComponent],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">地理风险叠加</p><h1>路网与风险图层复核</h1><p>地图与运输单、会签页显示同一路线版本；绕行段、已绕行政段按版本着色，顺序一变即时重绘。</p></div><button mat-stroked-button (click)="fitRoute()">定位整条路径</button></div>
      <app-version-banner />
      <div class="toolbar">
        <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>运输单</mat-label><mat-select [ngModel]="selectedRouteId" (ngModelChange)="selectRoute($event)">@for (route of (state$ | async)?.routes || []; track route.id) { <mat-option [value]="route.id">{{route.id}} v{{route.version}} · {{route.trainCode}}</mat-option> }</mat-select></mat-form-field>
        <mat-checkbox [(ngModel)]="layers.tunnel" (change)="refreshLayers()">隧道</mat-checkbox><mat-checkbox [(ngModel)]="layers.bridge" (change)="refreshLayers()">桥梁</mat-checkbox><mat-checkbox [(ngModel)]="layers.water" (change)="refreshLayers()">水源地</mat-checkbox><mat-checkbox [(ngModel)]="layers.population" (change)="refreshLayers()">人口密集区</mat-checkbox>
        <span class="spacer"></span>
        @if (selectedRoute) {
          <span class="ver-tag">绘图依据：{{selectedRoute.id}} <b>v{{selectedRoute.version}}</b></span>
        }
      </div>
      @if (continuityBreaks.length === 0) {
        <p class="continuity ok">✓ 首尾车站连续核对通过：{{chainText}}</p>
      } @else {
        <p class="continuity bad">! 首尾车站不连续：{{continuityBreaks[0].detail}}（版本被拦截，不允许出图审批）</p>
      }
      <div class="grid-2">
        <div #mapEl class="map"></div>
        <aside class="card">
          <div class="panel-head"><div><h2>区段风险清单</h2><p>按运行顺序排列，调整顺序即重算</p></div><strong [class.risk-high]="selectedRoute !== undefined && selectedRoute.score >= 70">总风险 {{selectedRoute?.score}}</strong></div>
          @for (segment of active; track segment.id; let i = $index) {
            <div class="segment" [class.active]="segment.id === selectedSegmentId" (click)="selectSegment(segment)">
              <div class="seg-order"><button mat-icon-button [disabled]="i===0" (click)="move(i, -1, $event)" title="上移：交换后须仍首尾连续，否则拦截">▲</button><span>{{i + 1}}</span><button mat-icon-button [disabled]="i===active.length-1" (click)="move(i, 1, $event)" title="下移：交换后须仍首尾连续，否则拦截">▼</button></div>
              <span class="seg-body"><b>{{segment.name}} @if (segment.kind==='detour') {<em class="detour-tag">绕行段 v{{segment.routeVersion}}</em>}</b><small>{{segment.from}} → {{segment.to}} · {{segment.km}} km · {{segment.speed}}</small><em>{{segment.risks.join(' / ')}}</em></span>
              <strong [class.risk-high]="segment.level==='高'" [class.risk-mid]="segment.level==='中'" [class.risk-low]="segment.level==='低'">{{segment.level}}</strong>
            </div>
          }
          @for (segment of bypassed; track segment.id) {
            <div class="segment bypassed"><span class="seg-body"><b>{{segment.name}}</b><small>{{segment.from}} → {{segment.to}} · 已绕行留档（v{{segment.routeVersion}} 之前的旧路线）</small></span><strong class="risk-mid">已绕行</strong></div>
          }
          <mat-divider />
          <h3>路径测算（随顺序/绕行重算）</h3>
          <p>实测里程：{{routeLength}} km（折线实测，不用直线补齐）</p><p>预计运行：{{estimatedTime}}</p><p>限制区段：{{restrictedCount}} 处 · 绕行段：{{bypassed.length}} 处</p>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 10px}.panel-head{display:flex;justify-content:space-between}.ver-tag{font-size:13px;color:#475569;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:4px 10px}.ver-tag b{color:#1d4ed8}
    .continuity{margin:0 0 12px;padding:9px 14px;border-radius:6px;font-size:13px}.continuity.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.continuity.bad{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
    .segment{display:flex;align-items:center;justify-content:space-between;text-align:left;gap:10px;padding:10px;margin:6px 0;border:1px solid #e1e7ef;background:#fff;border-radius:6px;cursor:pointer}.segment.active{border-color:#2563eb;background:#f5f8ff}.segment.bypassed{opacity:.6;background:#f1f5f9;border-style:dashed}
    .seg-order{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;color:#94a3b8}.seg-order button{border:none;background:none;color:#2563eb;cursor:pointer;font-size:11px;padding:0 4px}.seg-order button:disabled{color:#cbd5e1;cursor:not-allowed}
    .seg-body{flex:1}.seg-body b,.seg-body small,.seg-body em{display:block}.seg-body small{color:#7a8798;margin:4px 0}.seg-body em{font-size:12px;color:#475569;font-style:normal}.detour-tag{display:inline-block!important;font-style:normal;background:#ffedd5;color:#9a3412;font-size:11px;border-radius:4px;padding:1px 7px;margin-left:6px}
  `],
})
export class RiskMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  private map?: MapLibreMap
  selectedRouteId = ''
  selectedSegmentId = ''
  layers = { tunnel: true, bridge: true, water: true, population: true }
  selectedRoute: RoutePackage | undefined

  get active(): RiskSegment[] { return this.selectedRoute ? activeSegments(this.selectedRoute) : [] }
  get bypassed(): RiskSegment[] { return this.selectedRoute ? this.selectedRoute.segments.filter((segment) => segment.status === '已绕行') : [] }
  get continuityBreaks() { return this.selectedRoute ? checkContinuity(this.active) : [] }
  get chainText() { return this.active.length ? `${this.active[0].from} → ${this.active.map((segment) => segment.to).join(' → ')}` : '' }
  get routeLength() { return this.active.reduce((sum, segment) => sum + segmentLengthKm(segment.coordinates), 0).toFixed(1) }
  get estimatedTime() { return `${Math.round(Number(this.routeLength) / 55 * 60 + this.restrictedCount * 8)} 分钟` }
  get restrictedCount() { return this.active.filter((segment) => segment.status === '需绕行').length ?? 0 }

  constructor() {
    this.state$.subscribe((state: RouteState) => {
      this.selectedRouteId = state.selectedRouteId
      this.selectedSegmentId = state.selectedSegmentId
      this.selectedRoute = state.routes.find((route) => route.id === state.selectedRouteId)
      if (this.map) this.drawRoute()
    })
  }

  ngAfterViewInit() {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
      center: [112.2, 34.5], zoom: 5,
    })
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right')
    this.map.on('load', () => { this.addRiskLayers(); this.drawRoute() })
  }

  ngOnDestroy() { this.map?.remove() }

  selectRoute(id: string) { this.store.dispatch(RouteActions.selectRoute({ id })) }
  selectSegment(segment: RiskSegment) {
    this.store.dispatch(RouteActions.selectSegment({ id: segment.id }))
    this.map?.flyTo({ center: segment.coordinates[0], zoom: 8 })
  }

  move(index: number, direction: -1 | 1, event: Event) {
    event.stopPropagation()
    const target = index + direction
    if (!this.selectedRoute || target < 0 || target >= this.active.length) return
    const ids = this.active.map((segment) => segment.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    // 是否合法交给统一核对：首尾不连续将被拦截并在版本横幅给出原因，不产生新版本
    const draft: ReorderDraft = { routeId: this.selectedRoute.id, orderedSegmentIds: ids }
    this.store.dispatch(RouteActions.reorderSegments({ draft, operator: '当前调度员' }))
  }

  fitRoute() {
    if (!this.map || !this.selectedRoute) return
    const bounds = new LngLatBounds()
    this.selectedRoute.segments.flatMap((segment) => segment.coordinates).forEach((point) => bounds.extend(point))
    this.map.fitBounds(bounds, { padding: 50 })
  }

  refreshLayers() { for (const [id, visible] of Object.entries(this.layers)) { if (this.map?.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') } }

  private addRiskLayers() {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [
      { type: 'Feature', properties: { kind: 'tunnel' }, geometry: { type: 'Point', coordinates: [114.3, 35.2] } },
      { type: 'Feature', properties: { kind: 'bridge' }, geometry: { type: 'Point', coordinates: [116.1, 34.2] } },
      { type: 'Feature', properties: { kind: 'water' }, geometry: { type: 'Point', coordinates: [110.4, 34.8] } },
      { type: 'Feature', properties: { kind: 'population' }, geometry: { type: 'Point', coordinates: [118.0, 35.8] } },
    ]
    const colors: Record<string, string> = { tunnel: '#4f46e5', bridge: '#d97706', water: '#0891b2', population: '#dc2626' }
    Object.entries(colors).forEach(([kind, color]) => {
      this.map?.addSource(kind, { type: 'geojson', data: { type: 'FeatureCollection', features: features.filter((feature) => feature.properties?.['kind'] === kind) } })
      this.map?.addLayer({ id: kind, type: 'circle', source: kind, paint: { 'circle-radius': 10, 'circle-color': color, 'circle-opacity': .75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    })
  }

  private removeLayer(id: string) {
    if (this.map?.getLayer(id)) this.map.removeLayer(id)
    if (this.map?.getSource(id)) this.map.removeSource(id)
  }

  private drawRoute() {
    if (!this.map?.isStyleLoaded() || !this.selectedRoute) return
    ;['route-active', 'route-detour', 'route-bypassed'].forEach((id) => this.removeLayer(id))
    const route = this.selectedRoute

    const active = activeSegments(route).filter((segment) => segment.kind === 'normal')
    const detours = activeSegments(route).filter((segment) => segment.kind === 'detour')
    const bypassed = route.segments.filter((segment) => segment.status === '已绕行')

    this.map.addSource('route-active', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: active.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'route-active', type: 'line', source: 'route-active', paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': .9 } })

    this.map.addSource('route-detour', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: detours.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'route-detour', type: 'line', source: 'route-detour', paint: { 'line-color': '#ea580c', 'line-width': 5, 'line-opacity': .95 } })

    this.map.addSource('route-bypassed', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: bypassed.map((segment) => segment.coordinates) } } })
    this.map.addLayer({ id: 'route-bypassed', type: 'line', source: 'route-bypassed', paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': .8 } })
  }
}
