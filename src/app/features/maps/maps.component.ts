import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  FaceitService,
  PlayerMapStatItem,
} from '../../services/faceit.service';
import { TuiLoaderModule } from '@taiga-ui/core';
import {
  TuiIslandModule,
  TuiPaginationModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';

@Component({
  standalone: true,
  selector: 'app-maps',
  imports: [
    CommonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiPaginationModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './maps.component.html',
})
export class MapsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly faceit = inject(FaceitService);
  loading = true;
  items: PlayerMapStatItem[] = [];
  filter = '';
  sortKey: 'map' | 'winRatePercent' | 'kdRatio' | 'matchesPlayed' | null = null;
  sortDir: 'asc' | 'desc' = 'desc';
  page = 0;
  pageSize = 10;
  paged: PlayerMapStatItem[] = [];
  totalPages = 0;

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.faceit.getPlayerMaps(id, 'cs2').subscribe({
        next: (r) => {
          this.items = r.items;
          this.loading = false;
          this.apply();
        },
        error: () => (this.loading = false),
      });
    }
  }

  onFilter(value: string): void {
    this.filter = (value || '').toLowerCase();
    this.apply();
  }

  onSort(key: 'map' | 'winRatePercent' | 'kdRatio' | 'matchesPlayed'): void {
    this.sortDir =
      this.sortKey === key ? (this.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    this.sortKey = key;
    this.apply();
  }

  private apply(): void {
    let arr = [...this.items];
    if (this.filter) {
      arr = arr.filter((i) => i.map.toLowerCase().includes(this.filter));
    }
    if (this.sortKey) {
      const key = this.sortKey;
      const dir = this.sortDir;
      arr.sort((a, b) => {
        const av = (a as any)[key];
        const bv = (b as any)[key];
        const res = av > bv ? 1 : av < bv ? -1 : 0;
        return dir === 'asc' ? res : -res;
      });
    }
    this.totalPages = Math.ceil(arr.length / this.pageSize) || 1;
    const start = this.page * this.pageSize;
    this.paged = arr.slice(start, start + this.pageSize);
  }
}
