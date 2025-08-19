import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotesService, Note } from '../../services/notes.service';
import { AuthService } from '../../services/auth.service';
import {
  TuiInputModule,
  TuiIslandModule,
  TuiPaginationModule,
  TuiTagModule,
  TuiBadgeModule,
} from '@taiga-ui/kit';
import { TuiButtonModule, TuiLoaderModule } from '@taiga-ui/core';

@Component({
  standalone: true,
  selector: 'app-notes',
  imports: [
    CommonModule,
    FormsModule,
    TuiInputModule,
    TuiButtonModule,
    TuiLoaderModule,
    TuiIslandModule,
    TuiPaginationModule,
    TuiTagModule,
    TuiBadgeModule,
  ],
  templateUrl: './notes.component.html',
  styleUrls: ['./notes.component.less'],
})
export class NotesComponent {
  private readonly notesService = inject(NotesService);
  private readonly authService = inject(AuthService);

  loading = true;
  notes: Note[] = [];
  paged: Note[] = [];
  filter = '';
  page = 0;
  pageSize = 10;
  totalPages = 0;

  type: 'match' | 'teammate' = 'match';
  text = '';

  editingNote: Note | null = null;

  typeOptions = [
    { value: 'match', label: 'Матч' },
    { value: 'teammate', label: 'Тиммейт' },
  ];

  get isAuthenticated(): boolean {
    return !!this.authService.user();
  }

  get canAdd(): boolean {
    return Boolean(this.text.trim());
  }

  ngOnInit(): void {
    this.checkAuth();
    if (this.isAuthenticated) {
      this.loadNotes();
    }
  }

  checkAuth(): void {
    this.authService.user$.subscribe((user) => {
      if (user) {
        this.loadNotes();
      } else {
        this.notes = [];
        this.paged = [];
        this.loading = false;
      }
    });
  }

  async loadNotes(): Promise<void> {
    try {
      this.loading = true;
      this.notesService.listNotes().subscribe((notes) => {
        this.notes = notes;
        this.applyPagingAndFilter();
        this.loading = false;
      });
    } catch (error) {
      console.error('Error loading notes:', error);
      this.loading = false;
    }
  }

  add(): void {
    if (this.editingNote) {
      this.updateNote();
    } else {
      this.createNote();
    }
  }

  async createNote(): Promise<void> {
    if (!this.canAdd) return;

    try {
      await this.notesService.addNote('', this.type, this.text.trim());
      this.clearForm();
      this.loadNotes();
    } catch (error) {
      console.error('Error creating note:', error);
    }
  }

  async updateNote(): Promise<void> {
    if (!this.editingNote || !this.canAdd) return;

    try {
      await this.notesService.updateNote(
        this.editingNote.id!,
        this.text.trim()
      );
      this.clearForm();
      this.loadNotes();
    } catch (error) {
      console.error('Error updating note:', error);
    }
  }

  editNote(note: Note): void {
    this.editingNote = note;
    this.type = note.type;
    this.text = note.text;
  }

  async deleteNote(note: Note): Promise<void> {
    if (!note.id) {
      console.error('Cannot delete note without ID');
      return;
    }
    if (confirm('Удалить эту заметку?')) {
      try {
        await this.notesService.deleteNote(note.id);
        this.loadNotes();
      } catch (error) {
        console.error('Error deleting note:', error);
      }
    }
  }

  clearForm(): void {
    this.editingNote = null;
    this.type = 'match';
    this.text = '';
  }

  onFilter(value: string): void {
    this.filter = value;
    this.page = 0;
    this.applyPagingAndFilter();
  }

  clearFilter(): void {
    this.filter = '';
    this.page = 0;
    this.applyPagingAndFilter();
  }

  onSort(key: 'createdAt' | 'type'): void {
    // Сортировка отключена
  }

  private applyPagingAndFilter(): void {
    let arr = [...this.notes];

    if (this.filter) {
      const filterLower = this.filter.toLowerCase();
      arr = arr.filter((n) => n.text.toLowerCase().includes(filterLower));
    }

    this.totalPages = Math.ceil(arr.length / this.pageSize) || 1;
    const start = this.page * this.pageSize;
    this.paged = arr.slice(start, start + this.pageSize);
  }

  signIn(): void {
    this.authService.signInWithGoogle();
  }
}
