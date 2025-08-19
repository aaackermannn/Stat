import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  FaceitService,
  FaceitPlayerSummary,
} from '../../services/faceit.service';
import { UserProfileService } from '../../services/user-profile.service';
import { AuthService } from '../../services/auth.service';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';
import { TuiIslandModule, TuiTagModule, TuiBadgeModule } from '@taiga-ui/kit';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-player',
  imports: [
    CommonModule,
    RouterLink,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './player.component.html',
  styleUrls: ['./player.component.less'],
})
export class PlayerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly faceit = inject(FaceitService);
  private readonly profiles = inject(UserProfileService);
  private readonly auth = inject(AuthService);
  player: FaceitPlayerSummary | null = null;
  loading = true;
  error = false;
  isFavorite = false;
  isAuthenticated = false;

  constructor() {
    this.checkAuth();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.faceit.getPlayerById(id).subscribe({
        next: (p) => {
          this.player = {
            ...p,
            kdRatio: Number(p.kdRatio) || 0,
            winRatePercent: Number(p.winRatePercent) || 0,
            matchesPlayed: Number(p.matchesPlayed) || 0,
            headshotPercent: Number(p.headshotPercent) || 0,
            kpr: Number(p.kpr) || 0,
            kills: Number(p.kills) || 0,
            deaths: Number(p.deaths) || 0,
            wins: Number(p.wins) || 0,
            losses: Number(p.losses) || 0,
            elo: Number(p.elo) || 0,
            level: Number(p.level) || 0,
          };
          this.loading = false;
          this.checkFavoriteStatus(p.id);
        },
        error: () => {
          this.loading = false;
          this.error = true;
        },
      });
    }
  }

  private checkAuth(): void {
    this.auth.user$.subscribe((user) => {
      this.isAuthenticated = !!user;
    });
  }

  private checkFavoriteStatus(playerId: string): void {
    if (!this.isAuthenticated) {
      console.log(
        'Пользователь не авторизован, статус избранного не проверяется'
      );
      return;
    }

    try {
      console.log('Проверяем статус избранного для игрока:', playerId);
      this.profiles.watchProfile().subscribe((prof) => {
        console.log('Профиль загружен для проверки избранного:', prof);
        const wasFavorite = this.isFavorite;
        this.isFavorite = !!prof?.favoritePlayerIds?.includes(playerId);

        if (wasFavorite !== this.isFavorite) {
          console.log(
            'Статус избранного изменился:',
            wasFavorite,
            '→',
            this.isFavorite
          );
        } else {
          console.log('Статус избранного не изменился:', this.isFavorite);
        }
      });
    } catch (error) {
      console.error('Ошибка при проверке статуса избранного:', error);
      this.isFavorite = false;
    }
  }

  signIn(): void {
    this.auth.signInWithGoogle();
  }

  getCountryFlag(countryCode: string): string {
    if (!countryCode) return '';

    return `https://flagcdn.com/w80/${countryCode.toLowerCase()}.png`;
  }

  getLevelIcon(level: number): string {
    return `/src/levels/level_${level}.png`;
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
  }

  async toggleFavorite(): Promise<void> {
    if (!this.player) return;

    try {
      console.log('Текущий статус избранного:', this.isFavorite);

      if (this.isFavorite) {
        await this.profiles.removeFavorite(this.player.id);
        this.isFavorite = false;
        console.log('Игрок убран из избранного');
      } else {
        console.log('Добавляем в избранное...');
        await this.profiles.addFavorite(this.player.id);
        this.isFavorite = true;
        console.log('Игрок добавлен в избранное');
      }

      this.checkFavoriteStatus(this.player.id);
    } catch (e) {
      console.error('Ошибка при переключении избранного:', e);
    }
  }
}
