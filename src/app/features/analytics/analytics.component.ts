import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  FaceitService,
  FaceitPlayerSummary,
} from '../../services/faceit.service';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { TuiLineChartModule } from '@taiga-ui/addon-charts';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';

@Component({
  standalone: true,
  selector: 'app-analytics',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TuiLineChartModule,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.less'],
})
export class AnalyticsComponent {
  private readonly faceit = inject(FaceitService);
  private readonly router = inject(Router);

  query = '';
  loading = false;
  searched = false;
  results: FaceitPlayerSummary[] = [];
  error = false;
  private input$ = new Subject<string>();

  constructor() {
    this.input$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((q) => {
        this.query = q;
        if (q.length >= 3) this.onSearch();
      });
  }

  onInput(value: string): void {
    this.input$.next(value.trim());
  }

  onSearch(): void {
    const q = this.query.trim();
    if (!q) return;

    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        q
      )
    ) {
      this.router.navigate(['/player', q]);
      return;
    }

    this.loading = true;
    this.searched = true;
    this.error = false;

    this.faceit.searchPlayers(q).subscribe({
      next: (data) => {
        this.results = data;
        this.loading = false;
      },
      error: () => {
        this.results = [];
        this.loading = false;
        this.error = true;
      },
    });
  }

  kdSeries: ReadonlyArray<readonly [number, number]> = [
    [1, 1.0],
    [2, 1.1],
    [3, 0.9],
    [4, 1.3],
    [5, 1.2],
  ];

  winrateSeries: ReadonlyArray<readonly [number, number]> = [
    [1, 50],
    [2, 48],
    [3, 52],
    [4, 55],
    [5, 57],
  ];

  hsSeries: ReadonlyArray<readonly [number, number]> = [
    [1, 35],
    [2, 38],
    [3, 37],
    [4, 40],
    [5, 42],
  ];

  getCountryFlag(countryCode: string): string {
    return `https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`;
  }
}
