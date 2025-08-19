import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import {
  UserProfileService,
  UserProfile,
} from '../../services/user-profile.service';
import { FaceitService } from '../../services/faceit.service';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  selector: 'app-account',
  imports: [
    CommonModule,
    FormsModule,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './account.component.html',
  styleUrls: ['./account.component.less'],
})
export class AccountComponent {
  private readonly profiles = inject(UserProfileService);
  private readonly authService = inject(AuthService);
  private readonly faceitService = inject(FaceitService);

  profile: UserProfile | undefined;
  error = false;
  loading = false;
  isAuthenticated = false;
  user: any = null;
  faceitId = '';
  playerStats: any = null;
  showLogin = false;
  showRegister = false;
  email = '';
  password = '';
  confirmPassword = '';

  constructor() {
    this.checkAuth();
  }

  private checkAuth(): void {
    this.loading = true;
    this.authService.user$.subscribe((user) => {
      console.log('Статус авторизации:', !!user, user);
      this.isAuthenticated = !!user;
      this.user = user;

      if (this.isAuthenticated) {
        this.loadProfile();
      } else {
        this.loading = false;
      }
    });
  }

  private async loadProfile(): Promise<void> {
    try {
      console.log('Загружаем профиль пользователя...');
      const uid = this.user?.uid;
      console.log('UID пользователя:', uid);

      await this.profiles.initIfMissing();
      console.log('Профиль инициализирован');

      this.profiles.watchProfile().subscribe({
        next: (p) => {
          console.log('Профиль загружен:', p);
          this.profile = p;
          this.faceitId = p?.faceitId ?? '';
          this.loading = false;

          if (p?.favoritePlayerIds?.length) {
            console.log('Избранные игроки:', p.favoritePlayerIds);
          } else {
            console.log('Избранных игроков нет');
          }

          if (p?.faceitId) {
            this.loadFaceitStats(p.faceitId);
          }
        },
        error: (error) => {
          console.error('Ошибка загрузки профиля:', error);
          this.error = true;
          this.loading = false;
        },
      });
    } catch (error) {
      console.error('Ошибка инициализации профиля:', error);
      this.error = true;
      this.loading = false;
    }
  }

  private async loadFaceitStats(faceitId: string): Promise<void> {
    try {
      const stats = await firstValueFrom(
        this.faceitService.getPlayerById(faceitId)
      );
      this.playerStats = stats;
    } catch (error) {
      console.error('Error loading Faceit stats:', error);
    }
  }

  async saveFaceitId(): Promise<void> {
    if (!this.faceitId.trim() || !this.profile) return;

    try {
      console.log('Сохраняем Faceit ID:', this.faceitId.trim());

      await this.profiles.updateProfile({
        faceitId: this.faceitId.trim(),
      });

      console.log('Faceit ID сохранен');

      await this.loadFaceitStats(this.faceitId.trim());
    } catch (error) {
      console.error('Ошибка при сохранении Faceit ID:', error);
    }
  }

  async removeFavorite(playerId: string): Promise<void> {
    if (!this.profile) return;

    try {
      console.log('Убираем из избранного:', playerId);
      await this.profiles.removeFavorite(playerId);
      console.log('Игрок убран из избранного');

      await this.profiles.refreshProfile();
    } catch (error) {
      console.error('Ошибка при удалении из избранного:', error);
    }
  }

  get canRegister(): boolean {
    return Boolean(
      this.email.trim() &&
        this.password.trim() &&
        this.confirmPassword.trim() &&
        this.password === this.confirmPassword
    );
  }

  signInWithGoogle(): void {
    this.authService.signInWithGoogle();
  }

  showLoginForm(): void {
    this.showLogin = true;
    this.showRegister = false;
  }

  showRegisterForm(): void {
    this.showLogin = false;
    this.showRegister = true;
  }

  backToMain(): void {
    this.showLogin = false;
    this.showRegister = false;
  }

  async signInWithEmail(): Promise<void> {
    if (!this.email || !this.password) {
      alert('Пожалуйста, заполните все поля для входа.');
      return;
    }

    try {
      await this.authService.signInWithEmail(this.email, this.password);
      this.email = '';
      this.password = '';
      this.confirmPassword = '';
      this.showLogin = false;
      this.showRegister = false;
    } catch (error) {
      console.error('Ошибка входа по email:', error);
      alert('Неверный email или пароль.');
    }
  }

  async signUpWithEmail(): Promise<void> {
    if (!this.email || !this.password || !this.confirmPassword) {
      alert('Пожалуйста, заполните все поля для регистрации.');
      return;
    }

    if (this.password !== this.confirmPassword) {
      alert('Пароли не совпадают.');
      return;
    }

    try {
      await this.authService.signUpWithEmail(this.email, this.password);
      this.email = '';
      this.password = '';
      this.confirmPassword = '';
      this.showLogin = false;
      this.showRegister = false;
    } catch (error) {
      console.error('Ошибка регистрации по email:', error);
      alert(
        'Пользователь с таким email уже существует или возникла другая ошибка.'
      );
    }
  }

  signOut(): void {
    this.authService.logout();
  }
}
