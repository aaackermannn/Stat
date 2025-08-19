import { inject, Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  query,
  where,
  collectionData,
  Timestamp,
  doc,
  deleteDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Observable } from 'rxjs';

export interface Note {
  id?: string;
  uid: string;
  type: 'match' | 'teammate';
  targetId: string;
  text: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotesService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  addNote(targetId: string, type: Note['type'], text: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');
    const col = collection(this.firestore, 'notes');
    return addDoc(col, {
      uid,
      type,
      targetId,
      text,
      createdAt: new Date().toISOString(),
    } satisfies Note).then(() => void 0);
  }

  updateNote(id: string, text: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');
    const docRef = doc(this.firestore, 'notes', id);
    return updateDoc(docRef, { text });
  }

  deleteNote(id: string): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');
    const docRef = doc(this.firestore, 'notes', id);
    return deleteDoc(docRef);
  }

  listNotes(targetId?: string, type?: Note['type']): Observable<Note[]> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('No authenticated user');
    const col = collection(this.firestore, 'notes');
    const q = query(
      col,
      where('uid', '==', uid),
      ...(targetId ? [where('targetId', '==', targetId)] : []),
      ...(type ? [where('type', '==', type)] : [])
    );
    return collectionData(q, { idField: 'id' }) as unknown as Observable<
      Note[]
    >;
  }
}
