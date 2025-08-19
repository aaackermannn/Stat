import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  docData,
  updateDoc,
  setDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

export interface Goal {
  id: string;
  title: string;
  metric: 'winrate' | 'matches' | 'kd' | 'hs';
  target: number | null;
  progress: number;
}

export interface GoalsState {
  uid: string;
  goals: Goal[];
}

@Injectable({ providedIn: 'root' })
export class GoalsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private get ref() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');
    return doc(this.firestore, `user-goals/${uid}`);
  }

  watch(): Observable<GoalsState | undefined> {
    return docData(this.ref) as Observable<GoalsState | undefined>;
  }

  async upsert(state: Partial<GoalsState>): Promise<void> {
    return setDoc(
      this.ref,
      { uid: this.auth.currentUser?.uid, goals: [], ...state } as GoalsState,
      { merge: true }
    );
  }

  async updateGoals(goals: Goal[]): Promise<void> {
    return updateDoc(this.ref, { goals });
  }
}
