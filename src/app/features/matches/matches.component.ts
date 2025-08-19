import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FaceitService, PlayerMatchesDetailedResponse, PlayerMatchDetailedItem, MatchDetailsResponse } from '../../services/faceit.service';

interface MapStats {
  map: string;
  matchesPlayed: number;
  winRate: number;
  avgKD: number;
  avgKills: number;
  avgDeaths: number;
}
import { TuiLoaderModule } from '@taiga-ui/core';
import { TuiIslandModule, TuiPaginationModule, TuiTagModule, TuiBadgeModule } from '@taiga-ui/kit';
import { Subject, takeUntil } from 'rxjs';
import { ZingchartAngularModule } from 'zingchart-angular';

@Component({
  standalone: true,
  selector: 'app-matches',
  imports: [CommonModule, RouterLink, TuiLoaderModule, TuiIslandModule, TuiPaginationModule, TuiTagModule, TuiBadgeModule, ZingchartAngularModule],
  template: `
    <section>
      <h2>История матчей и аналитика</h2>
      <tui-loader [showLoader]="loading" [overlay]="true">
                 <div class="charts" *ngIf="!loading && data">
           <tui-island size="m">
             <h3>Динамика K/D</h3>
             <zingchart-angular [config]="kdChartConfig" [height]="300"></zingchart-angular>
           </tui-island>
           <tui-island size="m">
             <h3>Динамика винрейта</h3>
             <zingchart-angular [config]="wrChartConfig" [height]="300"></zingchart-angular>
           </tui-island>
         </div>
        
        <!-- Статистика по картам -->
        <tui-island size="l" style="margin-bottom: 24px;">
          <h3 style="margin-top: 0; margin-bottom: 20px;">Статистика по картам</h3>
          <div class="maps-stats-grid">
            <div *ngFor="let mapStat of mapsStats" class="map-stat-card">
              <div class="map-stat-header">
                <img *ngIf="getMapImage(mapStat.map)" [src]="getMapImage(mapStat.map)" [alt]="mapStat.map" class="map-stat-thumbnail" />
                <div class="map-stat-title">{{ getMapName(mapStat.map) || mapStat.map }}</div>
              </div>
              <div class="map-stat-content">
                <div class="map-stat-row">
                  <span class="map-stat-label">Матчи:</span>
                  <span class="map-stat-value">{{ mapStat.matchesPlayed }}</span>
                </div>
                <div class="map-stat-row">
                  <span class="map-stat-label">Винрейт:</span>
                  <span class="map-stat-value" [class.win-rate-high]="mapStat.winRate >= 50" [class.win-rate-low]="mapStat.winRate < 50">
                    {{ mapStat.winRate | number:'1.1-1' }}%
                  </span>
                </div>
                <div class="map-stat-row">
                  <span class="map-stat-label">K/D:</span>
                  <span class="map-stat-value">{{ mapStat.avgKD | number:'1.2-2' }}</span>
                </div>
                <div class="map-stat-row">
                  <span class="map-stat-label">Средние убийства:</span>
                  <span class="map-stat-value">{{ mapStat.avgKills | number:'1.1-1' }}</span>
                </div>
                <div class="map-stat-row">
                  <span class="map-stat-label">Средние смерти:</span>
                  <span class="map-stat-value">{{ mapStat.avgDeaths | number:'1.1-1' }}</span>
                </div>
              </div>
            </div>
          </div>
        </tui-island>
        <div *ngIf="!loading && data">
          <div class="limit-switch">
            <span class="limit-label">Показывать:</span>
            <button type="button" class="limit-btn" [class.active]="selectedLimit===20" (click)="changeLimit(20)">20</button>
            <button type="button" class="limit-btn" [class.active]="selectedLimit===50" (click)="changeLimit(50)">50</button>
            <button type="button" class="limit-btn" [class.active]="selectedLimit===100" (click)="changeLimit(100)">100</button>
          </div>
          <div class="row" style="margin:8px 0">
            <input [value]="filterValue" (input)="onFilter(($any($event.target)).value)" placeholder="Фильтр по карте" />
          </div>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Карта</th>
                <th>Регион</th>
                <th>Результат</th>
                <th class="score-header">Счет</th>
                <th>K</th>
                <th>D</th>
                <th>K/D</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let m of pagedItems" (click)="openMatch(m.matchId)" style="cursor: pointer">
                <td>{{ m.playedAt | date:'short' }}</td>
                <td>
                  <div class="map-cell">
                    <img *ngIf="getMapImage(getMapName(m.map))" [src]="getMapImage(getMapName(m.map))" [alt]="getMapName(m.map)" class="map-thumbnail" />
                    <span>{{ getMapName(m.map) || '-' }}</span>
                  </div>
                </td>
                <td>{{ m.region }}</td>
                <td>
                  <span *ngIf="m.win === true" class="result-win">ПОБЕДА</span>
                  <span *ngIf="m.win === false" class="result-loss">ПОРАЖЕНИЕ</span>
                  <span *ngIf="m.win === undefined">-</span>
                </td>
                <td>
                  <div class="score-display">
                    {{ m.scoreFor || 0 }} : {{ m.scoreAgainst || 0 }}
                  </div>
                </td>
                <td>{{ m.kills ?? '-' }}</td>
                <td>{{ m.deaths ?? '-' }}</td>
                <td>{{ m.kd ?? '-' }}</td>
              </tr>
            </tbody>
          </table>
          <tui-pagination [length]="totalPages" [(index)]="page" (indexChange)="onPageChange($event)"></tui-pagination>
          


          <ng-container *ngIf="details as d">
            <tui-island size="l" style="margin-top:12px">
              <div class="row" style="justify-content:space-between; align-items:center">
                <div>
                  <strong>Матч {{ d.matchId }}</strong>
                  <div class="muted">{{ d.map || 'Unknown' }} · {{ d.region || '-' }}</div>
                  <div class="muted">{{ d.startedAt | date:'short' }} — {{ d.finishedAt | date:'short' }}</div>
                  <div class="match-score">
                    <span class="score-team">{{ d.scoreboard[0].name || 'Team 1' }}</span>
                    <span class="score-separator">vs</span>
                    <span class="score-team">{{ d.scoreboard[1].name || 'Team 2' }}</span>
                    <div class="score-result">
                      <span class="score">{{ d.scoreFor || 0 }}</span>
                      <span class="score-separator">:</span>
                      <span class="score">{{ d.scoreAgainst || 0 }}</span>
                    </div>
                  </div>
                </div>
                <button tuiButton size="s" appearance="flat" type="button" (click)="closeDetails()">Закрыть</button>
              </div>
              <div class="grid" style="margin-top:12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">
                <div *ngFor="let t of d.scoreboard" class="card">
                  <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:6px">
                    <div style="font-weight:700">{{ t.name || t.key | uppercase }}</div>
                    <tui-badge size="s">{{ t.score }}</tui-badge>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Игрок</th>
                        <th>K</th>
                        <th>D</th>
                        <th>K/D</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let p of t.players">
                        <td>
                          <div class="player-info">
                            <img *ngIf="p.avatarUrl" [src]="p.avatarUrl" alt="avatar" class="player-avatar-small" />
                            <div *ngIf="!p.avatarUrl" class="player-avatar-placeholder">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                              </svg>
                            </div>
                            <div class="player-details">
                              <a [routerLink]="['/player', p.id]" (click)="$event.stopPropagation()" class="player-nickname">{{ p.nickname }}</a>
                              <img *ngIf="p.level" [src]="getLevelImage(p.level)" [alt]="'Level ' + p.level" class="level-icon-small" />
                            </div>
                          </div>
                        </td>
                        <td>{{ p.kills }}</td>
                        <td>{{ p.deaths }}</td>
                        <td>{{ p.kd }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </tui-island>
          </ng-container>
        </div>
      </tui-loader>
    </section>
  `,
  styles: [
    `
    .map-cell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .map-thumbnail {
      width: 56px;
      height: 32px;
      object-fit: cover;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    .limit-switch { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
    .limit-label { color: var(--muted); }
    .limit-btn { background: var(--bg-elev); border:1px solid var(--border); color: var(--text); padding:4px 10px; border-radius:6px; cursor:pointer; }
    .limit-btn.active { background: var(--primary); color:#fff; border-color: var(--primary); }

    .result-win { color: #10b981; font-weight: 600; }
    .result-loss { color: #ef4444; font-weight: 600; }

    .score-header, .score-display { text-align:center; }

    .match-score {
      margin-top: 8px;
      text-align: center;
    }

    .score-team {
      font-weight: 600;
      color: var(--text);
    }

    .score-separator {
      margin: 0 8px;
      color: var(--muted);
    }

    .score-result {
      margin-top: 4px;
      font-size: 18px;
      font-weight: 700;
    }

    .score {
      color: var(--primary);
    }

    .player-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .player-avatar-small {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      object-fit: cover;
    }

    .player-avatar-placeholder {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--bg-elev);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
    }

    .player-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .player-nickname {
      color: var(--primary);
      text-decoration: none;
      font-weight: 500;
    }

    .player-nickname:hover {
      text-decoration: underline;
    }

    .level-icon-small {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }

    .score-display {
      font-weight: 600;
      color: var(--text);
      text-align: center;
    }

    /* Стили для деталей матча */
    .row {
      display: flex;
      align-items: center;
    }

    .grid {
      display: grid;
    }

    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }

    .muted {
      color: var(--muted);
      font-size: 14px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 8px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      background: var(--bg);
      font-weight: 600;
      color: var(--text);
    }

    /* Статистика по картам */
    .maps-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }

    .map-stat-card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .map-stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
    }

    .map-stat-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .map-stat-thumbnail {
      width: 48px;
      height: 28px;
      object-fit: cover;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    .map-stat-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
    }

    .map-stat-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .map-stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
    }

    .map-stat-row:last-child {
      border-bottom: none;
    }

    .map-stat-label {
      font-size: 14px;
      color: var(--muted);
      font-weight: 500;
    }

    .map-stat-value {
      font-size: 14px;
      color: var(--text);
      font-weight: 600;
    }

    .win-rate-high {
      color: var(--success) !important;
    }

    .win-rate-low {
      color: var(--error) !important;
    }


  `,
  ],
})
export class MatchesComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly faceit = inject(FaceitService);
  private readonly destroy$ = new Subject<void>();
  
  loading = true;
  playerId: string | null = null;
  data: PlayerMatchesDetailedResponse | null = null;
  allMatches: PlayerMatchDetailedItem[] = [];
  mapsStats: MapStats[] = [];
  columns = ['Дата','Карта','Регион','Результат','K','D','K/D'];
  page = 0;
  pageSize = 10;
  pagedItems: PlayerMatchDetailedItem[] = [];
  totalPages = 0;
  filterValue = '';
  sortKey: 'playedAt' | 'map' | 'region' | 'kills' | 'deaths' | 'kd' | null = null;
  sortDir: 'asc' | 'desc' = 'desc';
  details: MatchDetailsResponse | null = null;
  selectedLimit = 20;

  // Конфигурации для ZingChart
  kdChartConfig: any = {};
  wrChartConfig: any = {};

  ngOnInit(): void {
    console.log('MatchesComponent ngOnInit called');
    
    // Сначала проверяем queryParams для player
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((qp) => {
      const playerId = qp.get('player');
      const match = qp.get('match');
      
      if (playerId && !this.playerId) {
        this.playerId = playerId;
        this.loadMatches(playerId);
      }
      
      if (match) this.loadDetails(match);
      else this.details = null;
    });
    
    // Затем проверяем route params (для обратной совместимости)
    const id = this.route.snapshot.paramMap.get('id');
    if (id && !this.playerId) {
      this.playerId = id;
      this.loadMatches(id);
    }
    
    if (!this.playerId) {
      console.log('No player ID found in route or query params');
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMatches(playerId: string): void {
    this.loading = true;
    this.allMatches = [];

    console.log(`Loading matches for player ${playerId}`);
    
    this.faceit.getPlayerMatchesDetailed(playerId, { 
      limit: this.selectedLimit, 
      offset: 0 
    }).subscribe({
      next: (resp) => {
        console.log('Matches loaded:', {
          matchesCount: resp.items.length,
          total: resp.total
        });

        this.allMatches = resp.items;
        
        // Обновляем данные для отображения
        this.data = {
          items: this.allMatches,
          total: resp.total || this.allMatches.length
        };

        // Пересчитываем графики на основе всех матчей
        this.buildSeries();
        this.applyPagingAndFilter();

        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading matches:', error);
        this.loading = false;
      }
    });
  }



  private buildSeries(): void {
    if (!this.allMatches.length) return;

    // Build series in chronological order
    const items = [...this.allMatches].sort((a, b) => a.playedAt - b.playedAt);
    
    // Анализируем качество данных
    const matchesWithStats = items.filter(m => (m.kills ?? 0) > 0 || (m.deaths ?? 0) > 0);
    const matchesWithResults = items.filter(m => m.win !== undefined);
    const avgKD = items.reduce((sum, m) => sum + (Number(m.kd) || 0), 0) / items.length;
    const totalWins = items.filter(m => m.win === true).length;
    const winRate = items.length > 0 ? (totalWins / items.length) * 100 : 0;

    console.log('Статистика матчей:', {
      totalMatches: items.length,
      matchesWithStats: matchesWithStats.length,
      matchesWithResults: matchesWithResults.length,
      statsQuality: `${Math.round((matchesWithStats.length / items.length) * 100)}%`,
      avgKD: avgKD.toFixed(2),
      winRate: winRate.toFixed(1) + '%',
      dateRange: items.length > 0 ? {
        oldest: new Date(items[0].playedAt).toLocaleDateString(),
        newest: new Date(items[items.length - 1].playedAt).toLocaleDateString()
      } : null
    });

    // Создаем конфигурации для ZingChart
    this.createChartConfigs(items);

    // Рассчитываем статистику по картам
    this.calculateMapsStats();
  }

  private createChartConfigs(items: PlayerMatchDetailedItem[]): void {
    // График K/D Ratio
    const kdValues = items.map((m, idx) => [idx + 1, Number(m.kd ?? 0)]);
    this.kdChartConfig = {
      type: 'line',
      backgroundColor: 'transparent',
      plot: {
        backgroundColor: 'transparent'
      },
      scaleX: {
        label: {
          text: 'Матч',
          fontColor: '#666'
        },
        tick: {
          fontColor: '#666'
        },
        gridColor: '#333'
      },
      scaleY: {
        label: {
          text: 'K/D Ratio',
          fontColor: '#666'
        },
        tick: {
          fontColor: '#666'
        },
        gridColor: '#333'
      },
      series: [{
        values: kdValues,
        lineColor: '#FF6B6B',
        backgroundColor: '#FF6B6B',
        fillArea: true,
        fillAlpha: 0.3
      }]
    };

    // График Win Rate
    let wins = 0;
    const wrValues: number[][] = [];
    items.forEach((m, i) => {
      if (m.win === true) wins += 1;
      wrValues.push([i + 1, Number(((wins / (i + 1)) * 100).toFixed(2))]);
    });

    this.wrChartConfig = {
      type: 'line',
      backgroundColor: 'transparent',
      plot: {
        backgroundColor: 'transparent'
      },
      scaleX: {
        label: {
          text: 'Матч',
          fontColor: '#666'
        },
        tick: {
          fontColor: '#666'
        },
        gridColor: '#333'
      },
      scaleY: {
        label: {
          text: 'Win Rate (%)',
          fontColor: '#666'
        },
        tick: {
          fontColor: '#666'
        },
        gridColor: '#333',
        minValue: 0,
        maxValue: 100
      },
      series: [{
        values: wrValues,
        lineColor: '#4ECDC4',
        backgroundColor: '#4ECDC4',
        fillArea: true,
        fillAlpha: 0.3
      }]
    };

    console.log('Конфигурации ZingChart созданы:', {
      kdPoints: kdValues.length,
      wrPoints: wrValues.length
    });
  }

  private calculateMapsStats(): void {
    if (!this.allMatches.length) return;

    const mapStatsMap = new Map<string, {
      matches: PlayerMatchDetailedItem[];
      wins: number;
      totalKills: number;
      totalDeaths: number;
    }>();

    // Группируем матчи по картам
    this.allMatches.forEach(match => {
      const mapName = this.getMapName(match.map) || 'Unknown';
      if (!mapStatsMap.has(mapName)) {
        mapStatsMap.set(mapName, {
          matches: [],
          wins: 0,
          totalKills: 0,
          totalDeaths: 0
        });
      }

      const stats = mapStatsMap.get(mapName)!;
      stats.matches.push(match);
      
      if (match.win === true) stats.wins++;
      if (match.kills) stats.totalKills += match.kills;
      if (match.deaths) stats.totalDeaths += match.deaths;
    });

    // Преобразуем в массив статистики
    this.mapsStats = Array.from(mapStatsMap.entries()).map(([map, stats]) => ({
      map,
      matchesPlayed: stats.matches.length,
      winRate: stats.matches.length > 0 ? (stats.wins / stats.matches.length) * 100 : 0,
      avgKD: stats.matches.length > 0 ? stats.totalKills / Math.max(stats.totalDeaths, 1) : 0,
      avgKills: stats.matches.length > 0 ? stats.totalKills / stats.matches.length : 0,
      avgDeaths: stats.matches.length > 0 ? stats.totalDeaths / stats.matches.length : 0
    }));

    // Сортируем по количеству матчей (убывание)
    this.mapsStats.sort((a, b) => b.matchesPlayed - a.matchesPlayed);

    console.log('🗺️ Статистика по картам рассчитана:', this.mapsStats);
  }

  onFilter(value: string): void {
    this.filterValue = (value || '').toLowerCase();
    this.page = 0;
    this.applyPagingAndFilter();
  }

  onSort(key: 'playedAt' | 'map' | 'region' | 'kills' | 'deaths' | 'kd'): void {
    this.sortDir = this.sortKey === key ? (this.sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    this.sortKey = key;
    this.page = 0; // Сбрасываем страницу при сортировке
    this.applyPagingAndFilter();
  }

  onPageChange(page: number): void {
    console.log('Page changed to:', page);
    this.page = page;
    this.applyPagingAndFilter();
  }

  private applyPagingAndFilter(): void {
    if (!this.data) return;
    
    let arr = [...this.data.items];
    
    // Применяем фильтр
    if (this.filterValue) {
      arr = arr.filter((m) => {
        const mapName = this.getMapName(m.map);
        return (mapName?.toLowerCase().includes(this.filterValue.toLowerCase()) ||
                m.region?.toLowerCase().includes(this.filterValue.toLowerCase()));
      });
    }
    
    // Применяем сортировку
    if (this.sortKey) {
      const key = this.sortKey;
      const dir = this.sortDir;
      arr.sort((a, b) => {
        let av: any, bv: any;
        
        switch (key) {
          case 'playedAt':
            av = a.playedAt;
            bv = b.playedAt;
            break;
          case 'map':
            av = this.getMapName(a.map) || '';
            bv = this.getMapName(b.map) || '';
            break;
          case 'region':
            av = a.region || '';
            bv = b.region || '';
            break;
          case 'kills':
            av = a.kills || 0;
            bv = b.kills || 0;
            break;
          case 'deaths':
            av = a.deaths || 0;
            bv = b.deaths || 0;
            break;
          case 'kd':
            av = a.kd || 0;
            bv = b.kd || 0;
            break;
          default:
            return 0;
        }
        
        const res = av > bv ? 1 : av < bv ? -1 : 0;
        return dir === 'asc' ? res : -res;
      });
    }
    
    // Применяем пагинацию
    this.totalPages = Math.ceil(arr.length / this.pageSize) || 1;
    const start = this.page * this.pageSize;
    this.pagedItems = arr.slice(start, start + this.pageSize);
    
    console.log('Paging applied:', {
      totalItems: arr.length,
      totalPages: this.totalPages,
      currentPage: this.page,
      pagedItems: this.pagedItems.length
    });
  }

  openMatch(matchId: string): void {
    // Загружаем детали матча вместо перенаправления
    this.loadDetails(matchId);
  }

  closeDetails(): void {
    this.details = null;
  }

  changeLimit(limit: number): void {
    if (this.selectedLimit === limit) return;
    this.selectedLimit = limit;
    
    // Используем сохраненный playerId или получаем из queryParams
    if (this.playerId) {
      this.loadMatches(this.playerId);
    } else {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) this.loadMatches(id);
    }
  }

  getMapImage(mapName: string | undefined): string | null {
    if (!mapName) return null;
    return `/src/maps/${mapName.toLowerCase()}.png`;
  }

  getMapName(mapValue: string | string[] | undefined): string | undefined {
    if (!mapValue) return undefined;
    if (Array.isArray(mapValue)) {
      return mapValue[0] || undefined;
    }
    return mapValue;
  }

  getLevelImage(level: number): string {
    return `/src/levels/level_${level}.png`;
  }

  private loadDetails(matchId: string): void {
    this.faceit.getMatchDetails(matchId).subscribe({
      next: (d) => (this.details = d),
      error: () => (this.details = null),
    });
  }
}


