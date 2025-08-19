import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import {
  UserProfileService,
  UserProfile,
} from '../../services/user-profile.service';
import {
  FaceitService,
  FaceitPlayerSummary,
} from '../../services/faceit.service';
import { TuiIslandModule, TuiTagModule, TuiBadgeModule } from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ZingchartAngularModule } from 'zingchart-angular';

interface FavoritePlayerWithStats extends FaceitPlayerSummary {
  isInComparison: boolean;
  comparisonColor: string;
}

interface ComparisonData {
  playerId: string;
  nickname: string;
  color: string;
  stats: {
    kdRatio: number;
    winRate: number;
    matches: number;
  };
}

@Component({
  standalone: true,
  selector: 'app-favorites',
  imports: [
    CommonModule,
    RouterLink,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
    TuiButtonModule,
    TuiLoaderModule,
    ZingchartAngularModule,
  ],
  templateUrl: './favorites.component.html',
  styleUrls: ['./favorites.component.less'],
})
export class FavoritesComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly profiles = inject(UserProfileService);
  private readonly authService = inject(AuthService);
  private readonly faceitService = inject(FaceitService);

  isAuthenticated = false;
  loading = false;
  profile: UserProfile | undefined;
  favoritePlayers: FavoritePlayerWithStats[] = [];
  comparisonPlayers: ComparisonData[] = [];
  myProfile: FaceitPlayerSummary | null = null;
  selectedFilter = 20;

  private readonly comparisonColors = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#96CEB4',
    '#FFEAA7',
  ];

  kdComparisonChartConfig: any = {};
  winRateComparisonChartConfig: any = {};

  ngOnInit(): void {
    this.checkAuth();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkAuth(): void {
    this.loading = true;
    this.authService.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.isAuthenticated = !!user;
      if (this.isAuthenticated) {
        this.loadProfile();
      } else {
        this.loading = false;
      }
    });
  }

  private async loadProfile(): Promise<void> {
    try {
      await this.profiles.initIfMissing();
      this.profiles
        .watchProfile()
        .pipe(takeUntil(this.destroy$))
        .subscribe(async (profile) => {
          this.profile = profile;
          if (profile?.favoritePlayerIds?.length) {
            await this.loadFavoritePlayers(profile.favoritePlayerIds);
          }

          if (profile?.faceitId) {
            await this.loadMyProfile(profile.faceitId);
          }

          this.loading = false;
        });
    } catch (error) {
      console.error('Ошибка загрузки профиля:', error);
      this.loading = false;
    }
  }

  private async loadFavoritePlayers(playerIds: string[]): Promise<void> {
    try {
      const players: FavoritePlayerWithStats[] = [];

      for (const id of playerIds) {
        try {
          const player = await firstValueFrom(
            this.faceitService.getPlayerById(id)
          );
          if (player) {
            if (this.selectedFilter > 0) {
              try {
                const matches = await firstValueFrom(
                  this.faceitService.getPlayerMatchesDetailed(id, {
                    limit: this.selectedFilter,
                    offset: 0,
                  })
                );

                if (matches.items.length > 0) {
                  const recentStats = this.calculateRecentStats(matches.items);
                  player.kdRatio = recentStats.kdRatio;
                  player.winRatePercent = recentStats.winRate;
                  player.matchesPlayed = matches.items.length;
                }
              } catch (error) {
                console.error(
                  `Ошибка загрузки матчей для игрока ${id}:`,
                  error
                );
              }
            }

            players.push({
              ...player,
              isInComparison: false,
              comparisonColor: '',
            });
          }
        } catch (error) {
          console.error(`Ошибка загрузки игрока ${id}:`, error);
        }
      }

      this.favoritePlayers = players;

      if (this.comparisonPlayers.length > 0) {
        this.updateComparisonChart();
      }
    } catch (error) {
      console.error('Ошибка загрузки избранных игроков:', error);
    }
  }

  private calculateRecentStats(matches: any[]): {
    kdRatio: number;
    winRate: number;
  } {
    let totalKills = 0;
    let totalDeaths = 0;
    let wins = 0;

    matches.forEach((match) => {
      if (match.kills) totalKills += match.kills;
      if (match.deaths) totalDeaths += match.deaths;
      if (match.win === true) wins++;
    });

    const kdRatio = totalDeaths > 0 ? totalKills / totalDeaths : totalKills;
    const winRate = matches.length > 0 ? (wins / matches.length) * 100 : 0;

    return { kdRatio, winRate };
  }

  private async loadMyProfile(faceitId: string): Promise<void> {
    try {
      const profile = await firstValueFrom(
        this.faceitService.getPlayerById(faceitId)
      );
      this.myProfile = profile || null;
    } catch (error) {
      console.error('Ошибка загрузки моего профиля:', error);
    }
  }

  setFilter(matches: number): void {
    this.selectedFilter = matches;
    this.updateComparisonChart();

    if (this.profile?.favoritePlayerIds?.length) {
      this.loadFavoritePlayers(this.profile.favoritePlayerIds);
    }
  }

  toggleComparison(player: FavoritePlayerWithStats): void {
    if (player.isInComparison) {
      player.isInComparison = false;
      player.comparisonColor = '';
      this.comparisonPlayers = this.comparisonPlayers.filter(
        (p) => p.playerId !== player.id
      );
    } else {
      if (this.comparisonPlayers.length < 5) {
        player.isInComparison = true;
        const color = this.comparisonColors[this.comparisonPlayers.length];
        player.comparisonColor = color;

        this.comparisonPlayers.push({
          playerId: player.id,
          nickname: player.nickname,
          color: color,
          stats: {
            kdRatio: Number(player.kdRatio) || 0,
            winRate: Number(player.winRatePercent) || 0,
            matches: Number(player.matchesPlayed) || 0,
          },
        });
      }
    }

    this.updateComparisonChart();
  }

  private updateComparisonChart(): void {
    if (this.comparisonPlayers.length === 0) return;

    this.buildComparisonSeries();
  }

  private buildComparisonSeries(): void {
    if (this.comparisonPlayers.length === 0) return;

    this.createComparisonChartConfigs();

    console.log('Графики ZingChart обновлены');
  }

  private createComparisonChartConfigs(): void {
    this.kdComparisonChartConfig = {
      type: 'line',
      backgroundColor: 'transparent',
      plot: {
        backgroundColor: 'transparent',
      },
      scaleX: {
        label: {
          text: 'Позиция',
          fontColor: '#666',
        },
        tick: {
          fontColor: '#666',
        },
        gridColor: '#333',
      },
      scaleY: {
        label: {
          text: 'K/D Ratio',
          fontColor: '#666',
        },
        tick: {
          fontColor: '#666',
        },
        gridColor: '#333',
      },
      series: this.comparisonPlayers.map((player, index) => ({
        values: this.createLineSeries(player.stats.kdRatio, 10),
        lineColor: player.color,
        backgroundColor: player.color,
        fillArea: true,
        fillAlpha: 0.2,
        lineWidth: 3,
      })),
    };

    this.winRateComparisonChartConfig = {
      type: 'line',
      backgroundColor: 'transparent',
      plot: {
        backgroundColor: 'transparent',
      },
      scaleX: {
        label: {
          text: 'Позиция',
          fontColor: '#666',
        },
        tick: {
          fontColor: '#666',
        },
        gridColor: '#333',
      },
      scaleY: {
        label: {
          text: 'Win Rate (%)',
          fontColor: '#666',
        },
        tick: {
          fontColor: '#666',
        },
        gridColor: '#333',
        minValue: 0,
        maxValue: 100,
      },
      series: this.comparisonPlayers.map((player, index) => ({
        values: this.createLineSeries(player.stats.winRate, 10),
        lineColor: player.color,
        backgroundColor: player.color,
        fillArea: true,
        fillAlpha: 0.2,
        lineWidth: 3,
      })),
    };
  }

  private createLineSeries(baseValue: number, points: number): number[][] {
    const series: number[][] = [];
    for (let i = 0; i < points; i++) {
      const variation = (Math.random() - 0.5) * (baseValue * 0.1);
      const value = Math.max(0, baseValue + variation);
      series.push([i + 1, Number(value.toFixed(2))]);
    }
    return series;
  }

  signInWithGoogle(): void {
    this.authService.signInWithGoogle();
  }
}
