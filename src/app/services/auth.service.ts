import { inject, Injectable, signal } from '@angular/core';
import {
  Auth,
  authState,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  readonly user$ = authState(this.auth);
  readonly user = toSignal<User | null>(this.user$, { initialValue: null });

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(this.auth, provider);
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async signUpWithEmail(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email, password);
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  signInWithFaceit(): void {
    const currentUser = this.user();
    const state = currentUser?.uid
      ? `&state=${encodeURIComponent(currentUser.uid)}`
      : '';
    window.location.href = `/api/auth/faceit/start${state}`;
  }
}
