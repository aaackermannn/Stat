import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface FaceitPlayerSummary {
  id: string;
  nickname: string;
  kdRatio: number;
  winRatePercent: number;
  matchesPlayed: number;
  headshotPercent: number;
  avatarUrl?: string | null;
  country?: string | null;
  level?: number | null;
  kpr?: number;
  kills?: number;
  deaths?: number;
  wins?: number;
  losses?: number;
  elo?: number | null;
  highestElo?: number | null;
  lowestElo?: number | null;
  avgElo?: number | null;
  faRating?: number;
  hltv?: number;
}

export interface PlayerMatchItem {
  matchId: string;
  game: string;
  playedAt: number;
  region: string;
  team?: string;
  map?: string;
}

export interface PlayerMatchesResponse {
  items: PlayerMatchItem[];
  total: number;
}

export interface PlayerMatchDetailedItem extends PlayerMatchItem {
  win?: boolean;
  kills?: number;
  deaths?: number;
  headshots?: number;
  kd?: number;
  scoreFor?: number;
  scoreAgainst?: number;
}

export interface PlayerMatchesDetailedResponse {
  items: PlayerMatchDetailedItem[];
  total: number;
}

export interface PlayerMapStatItem {
  map: string;
  winRatePercent: number;
  kdRatio: number;
  matchesPlayed: number;
}

export interface PlayerMapsResponse {
  items: PlayerMapStatItem[];
}

export interface PlayerTeammateItem {
  id: string;
  nickname: string;
  matchesTogether: number;
}

export interface PlayerTeammatesResponse {
  items: PlayerTeammateItem[];
}

export interface MatchScoreboardPlayer {
  id: string;
  nickname: string;
  kills: number;
  deaths: number;
  hs: number;
  kd: number;
  avatarUrl?: string;
  level?: number;
}

export interface MatchDetailsResponse {
  matchId: string;
  game: string;
  map?: string;
  startedAt: number;
  finishedAt: number;
  region?: string;
  winner?: 'faction1' | 'faction2' | null;
  scoreFor?: number;
  scoreAgainst?: number;
  scoreboard: Array<{
    key: 'faction1' | 'faction2';
    name?: string;
    score: number;
    players: MatchScoreboardPlayer[];
  }>;
}

@Injectable({ providedIn: 'root' })
export class FaceitService {
  private readonly http = inject(HttpClient);

  searchPlayers(
    query: string,
    game = 'cs2'
  ): Observable<FaceitPlayerSummary[]> {
    const params = new HttpParams().set('q', query).set('game', game);
    return this.http.get<FaceitPlayerSummary[]>(`/api/faceit/search`, {
      params,
    });
  }

  getPlayerById(id: string, game = 'cs2'): Observable<FaceitPlayerSummary> {
    const params = new HttpParams().set('game', game);
    return this.http.get<FaceitPlayerSummary>(`/api/faceit/players/${id}`, {
      params,
    });
  }

  getPlayerMatches(
    id: string,
    options?: { game?: string; limit?: number; offset?: number }
  ): Observable<PlayerMatchesResponse> {
    const params = new HttpParams()
      .set('game', options?.game ?? 'cs2')
      .set('limit', String(options?.limit ?? 20))
      .set('offset', String(options?.offset ?? 0));
    return this.http.get<PlayerMatchesResponse>(
      `/api/faceit/players/${id}/matches`,
      { params }
    );
  }

  getPlayerMatchesDetailed(
    id: string,
    options?: { game?: string; limit?: number; offset?: number }
  ): Observable<PlayerMatchesDetailedResponse> {
    const params = new HttpParams()
      .set('game', options?.game ?? 'cs2')
      .set('limit', String(options?.limit ?? 20))
      .set('offset', String(options?.offset ?? 0));
    return this.http.get<PlayerMatchesDetailedResponse>(
      `/api/faceit/players/${id}/matches/details`,
      { params }
    );
  }

  getPlayerMaps(id: string, game = 'cs2'): Observable<PlayerMapsResponse> {
    const params = new HttpParams().set('game', game);
    return this.http.get<PlayerMapsResponse>(`/api/faceit/players/${id}/maps`, {
      params,
    });
  }

  getPlayerTeammates(
    id: string,
    game = 'cs2'
  ): Observable<PlayerTeammatesResponse> {
    const params = new HttpParams().set('game', game);
    return this.http.get<PlayerTeammatesResponse>(
      `/api/faceit/players/${id}/teammates`,
      { params }
    );
  }

  getMatchDetails(matchId: string): Observable<MatchDetailsResponse> {
    return this.http.get<MatchDetailsResponse>(
      `/api/faceit/matches/${matchId}`
    );
  }
}
