import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-auth',
  imports: [CommonModule],
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.less'],
})
export class AuthComponent {
  private readonly auth = inject(AuthService);
  get userEmail(): string | null {
    return this.auth.user()?.email ?? null;
  }
  login() { this.auth.signInWithGoogle(); }
  loginFaceit() { this.auth.signInWithFaceit(); }
  logout() { this.auth.logout(); }
}


