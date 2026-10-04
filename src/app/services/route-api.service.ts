import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { map } from 'rxjs'
import type { DetourSegment, RoutePackage } from '../types'

interface RouteDataResponse {
  items: RoutePackage[]
  detours: DetourSegment[]
}

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)

  getRoutePackages() {
    return this.http.get<RouteDataResponse>('route-data.json').pipe(map((response) => response.items))
  }

  getDetours() {
    return this.http.get<RouteDataResponse>('route-data.json').pipe(map((response) => response.detours ?? []))
  }

  getRouteData() {
    return this.http.get<RouteDataResponse>('route-data.json')
  }
}
