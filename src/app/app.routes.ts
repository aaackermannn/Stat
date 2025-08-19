import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/search', pathMatch: 'full' },
  { path: 'search', loadComponent: () => import('./features/search/search.component').then(m => m.SearchComponent) },
  { path: 'player/:id', loadComponent: () => import('./features/player/player.component').then(m => m.PlayerComponent) },
  { path: 'account', loadComponent: () => import('./features/account/account.component').then(m => m.AccountComponent) },
  { path: 'goals', loadComponent: () => import('./features/goals/goals.component').then(m => m.GoalsComponent) },
  { path: 'notes', loadComponent: () => import('./features/notes/notes.component').then(m => m.NotesComponent) },
  { path: 'favorites', loadComponent: () => import('./features/favorites/favorites.component').then(m => m.FavoritesComponent) },
  { path: 'matches', loadComponent: () => import('./features/matches/matches.component').then(m => m.MatchesComponent) },
  { path: 'teammates', loadComponent: () => import('./features/teammates/teammates.component').then(m => m.TeammatesComponent) },
  { path: 'maps', loadComponent: () => import('./features/maps/maps.component').then(m => m.MapsComponent) },
  { path: 'analytics', loadComponent: () => import('./features/analytics/analytics.component').then(m => m.AnalyticsComponent) },
];


