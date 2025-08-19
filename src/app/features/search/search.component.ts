import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  FaceitService,
  FaceitPlayerSummary,
} from '../../services/faceit.service';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';

@Component({
  standalone: true,
  selector: 'app-search',
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.less'],
})
export class SearchComponent {
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

  getCountryFlag(countryCode: string): string {
    return `https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`;
  }

  getLevelImage(level: number): string {
    return `/src/levels/level_${level}.png`;
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/images/default-avatar.png'; // Fallback to a default avatar
  }
}
