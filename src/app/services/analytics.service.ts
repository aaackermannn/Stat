import { Injectable } from '@angular/core';

export interface TimeseriesPoint {
  iso: string;
  value: number;
}

export interface PlayerAnalytics {
  kdSeries: TimeseriesPoint[];
  winrateSeries: TimeseriesPoint[];
  headshotSeries: TimeseriesPoint[];
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {}
