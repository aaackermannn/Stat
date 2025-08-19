import { inject, Injectable } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  docData,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from '@angular/fire/firestore';
import { Observable, BehaviorSubject, firstValueFrom } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';

export interface UserProfile {
  uid: string;
  displayName: string | null;
  faceitId?: string | null;
  favoritePlayerIds: string[];
  goals: Array<{
    id: string;
    title: string;
    target: number;
    progress: number;
    metric: string;
  }>;
  achievements: Array<{ id: string; title: string; achievedAt: string }>;
}

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private profileSubject = new BehaviorSubject<UserProfile | undefined>(
    undefined
  );

  get currentUserDocRef() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');
    return doc(this.firestore, `users/${uid}`);
  }

  async initIfMissing(profile: Partial<UserProfile> = {}): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');

    const ref = doc(this.firestore, `users/${uid}`);

    try {
      const existingProfile = await this.getProfileOnce(uid);

      if (existingProfile) {
        const updatedProfile = { ...existingProfile, ...profile };
        await setDoc(ref, updatedProfile, { merge: true });
        this.profileSubject.next(updatedProfile);
        console.log('Профиль обновлен:', updatedProfile);
      } else {
        const newProfile: UserProfile = {
          uid,
          displayName: this.auth.currentUser?.displayName ?? null,
          faceitId: null,
          favoritePlayerIds: [],
          goals: [],
          achievements: [],
          ...profile,
        };
        await setDoc(ref, newProfile);
        this.profileSubject.next(newProfile);
        console.log('Новый профиль создан:', newProfile);
      }
    } catch (error) {
      console.error('Ошибка при инициализации профиля:', error);
      throw error;
    }
  }

  private async getProfileOnce(uid: string): Promise<UserProfile | null> {
    try {
      const ref = doc(this.firestore, `users/${uid}`);
      const snapshot = await firstValueFrom(
        docData(ref).pipe(map((data) => data as UserProfile | undefined))
      );
      return snapshot || null;
    } catch (error) {
      console.error('Ошибка при получении профиля:', error);
      return null;
    }
  }

  watchProfile(): Observable<UserProfile | undefined> {
    if (this.profileSubject.value) {
      return this.profileSubject.asObservable();
    }

    return this.auth.currentUser
      ? docData(this.currentUserDocRef).pipe(
          map((data) => data as UserProfile | undefined),
          tap((profile) => {
            if (profile) {
              this.profileSubject.next(profile);
            }
          })
        )
      : this.profileSubject.asObservable();
  }

  async addFavorite(playerId: string): Promise<void> {
    try {
      const uid = this.auth.currentUser?.uid;
      if (!uid) throw new Error('No authenticated user');

      const ref = doc(this.firestore, `users/${uid}`);
      await updateDoc(ref, {
        favoritePlayerIds: arrayUnion(playerId),
      });

      const currentProfile = this.profileSubject.value;
      if (
        currentProfile &&
        !currentProfile.favoritePlayerIds.includes(playerId)
      ) {
        const updatedProfile = {
          ...currentProfile,
          favoritePlayerIds: [...currentProfile.favoritePlayerIds, playerId],
        };
        this.profileSubject.next(updatedProfile);
      }

      console.log('Игрок добавлен в избранное:', playerId);
    } catch (error) {
      console.error('Ошибка при добавлении в избранное:', error);
      throw error;
    }
  }

  async removeFavorite(playerId: string): Promise<void> {
    try {
      const uid = this.auth.currentUser?.uid;
      if (!uid) throw new Error('No authenticated user');

      const ref = doc(this.firestore, `users/${uid}`);
      await updateDoc(ref, {
        favoritePlayerIds: arrayRemove(playerId),
      });

      const currentProfile = this.profileSubject.value;
      if (currentProfile) {
        const updatedProfile = {
          ...currentProfile,
          favoritePlayerIds: currentProfile.favoritePlayerIds.filter(
            (id) => id !== playerId
          ),
        };
        this.profileSubject.next(updatedProfile);
      }

      console.log('Игрок убран из избранного:', playerId);
    } catch (error) {
      console.error('Ошибка при удалении из избранного:', error);
      throw error;
    }
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<void> {
    try {
      const uid = this.auth.currentUser?.uid;
      if (!uid) throw new Error('No authenticated user');

      const ref = doc(this.firestore, `users/${uid}`);
      await updateDoc(ref, updates);

      const currentProfile = this.profileSubject.value;
      if (currentProfile) {
        const updatedProfile = { ...currentProfile, ...updates };
        this.profileSubject.next(updatedProfile);
      }

      console.log('Профиль обновлен:', updates);
    } catch (error) {
      console.error('Ошибка при обновлении профиля:', error);
      throw error;
    }
  }

  async refreshProfile(): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    try {
      const profile = await this.getProfileOnce(uid);
      this.profileSubject.next(profile || undefined);
    } catch (error) {
      console.error('Ошибка при обновлении профиля:', error);
    }
  }
}
