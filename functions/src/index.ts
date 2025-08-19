import * as functions from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';
import fetch from 'node-fetch';

initializeApp();

const app = express();

const FACEIT_API = 'https://open.faceit.com/data/v4';
const DEFAULT_GAME = (functions.config().faceit?.game as string) || 'cs2';

function getApiKey(): string {
  const key = (process.env.FACEIT_API_KEY as string | undefined) || (functions.config().faceit?.apikey as string | undefined);
  if (!key) throw new Error('Missing functions config: faceit.apikey');
  return key;
}

async function faceitFetch<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${FACEIT_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
  
  try {
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Faceit API error ${resp.status}: ${text}`);
    }
    return (await resp.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout after 8 seconds');
    }
    throw error;
  }
}

function num(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace('%', ''));
  return isFinite(n) ? n : fallback;
}

// Healthcheck
app.get('/health', (_req, res) => res.json({ ok: true }));

// =========================
// FACEIT OAuth 2.0 endpoints
// =========================
function getEnv(name: string, required = true): string | undefined {
  // Prefer process.env
  let v = process.env[name];
  if (!v) {
    // Fallback to functions config
    const cfg: any = functions.config() || {};
    const faceitCfg = cfg.faceit || {};
    switch (name) {
      case 'FACEIT_OAUTH_CLIENT_ID':
        v = faceitCfg.oauth_client_id;
        break;
      case 'FACEIT_OAUTH_CLIENT_SECRET':
        v = faceitCfg.oauth_client_secret;
        break;
      case 'FACEIT_OAUTH_REDIRECT_URI':
        v = faceitCfg.oauth_redirect_uri;
        break;
      default:
        break;
    }
  }
  if (!v && required) console.warn(`[OAUTH] Missing env ${name}`);
  return v;
}

const FACEIT_OAUTH_AUTH_URL = 'https://api.faceit.com/oauth/authorize';
const FACEIT_OAUTH_TOKEN_URL = 'https://api.faceit.com/oauth/token';

app.get('/auth/faceit/start', (req, res) => {
  const clientId = getEnv('FACEIT_OAUTH_CLIENT_ID');
  const redirectUri = getEnv('FACEIT_OAUTH_REDIRECT_URI');
  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'FACEIT OAuth is not configured on the server' });
  }
  const scope = String(req.query.scope || 'openid email profile');
  const state = String(req.query.state || '');
  const url = `${FACEIT_OAUTH_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
  return res.redirect(url);
});

app.get('/auth/faceit/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code) return res.status(400).json({ error: 'code is required' });
    const clientId = getEnv('FACEIT_OAUTH_CLIENT_ID');
    const clientSecret = getEnv('FACEIT_OAUTH_CLIENT_SECRET');
    const redirectUri = getEnv('FACEIT_OAUTH_REDIRECT_URI');
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).json({ error: 'FACEIT OAuth is not configured on the server' });
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResp = await fetch(FACEIT_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenJson: any = await tokenResp.json();
    if (!tokenResp.ok || !tokenJson?.access_token) {
      return res.status(400).json({ error: 'Failed to exchange code', details: tokenJson });
    }

    // Try to fetch basic user info if available
    let user: any = null;
    try {
      const userResp = await fetch('https://api.faceit.com/auth/user', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (userResp.ok) user = await userResp.json();
    } catch {}

    // If state contains a Firebase user id, persist integration under that user
    try {
      if (state) {
        const uid = state; // we pass uid directly in state from frontend
        const db = getFirestore();
        await db
          .collection('users')
          .doc(uid)
          .collection('integrations')
          .doc('faceit')
          .set({
            provider: 'faceit',
            obtainedAt: Date.now(),
            token: tokenJson,
            user,
          }, { merge: true });
      }
    } catch (e) {
      console.warn('[OAUTH] Failed to persist token to Firestore:', (e as any)?.message || e);
    }

    return res.json({ ok: true, token: tokenJson, user, state });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'OAuth callback failed' });
  }
});

// Search players with basic stats enrichment
app.get('/faceit/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const game = String(req.query.game || DEFAULT_GAME);
    if (!q) return res.status(400).json({ error: 'q required' });

    type SearchResp = { items: Array<{ player_id: string; nickname: string }>; };
    const data = await faceitFetch<SearchResp>('/search/players', {
      nickname: q,
      game,
      limit: 5,
      offset: 0,
    });

    // Enrich with player profile info and lifetime stats
    const enriched = await Promise.all(
      data.items.map(async (p) => {
        try {
          const [player, stats] = await Promise.all([
            faceitFetch<any>(`/players/${p.player_id}`),
            faceitFetch<any>(`/players/${p.player_id}/stats/${game}`)
          ]);
          
          const lifetime = stats?.lifetime || {};
          
          return {
            id: p.player_id,
            nickname: p.nickname,
            avatarUrl: player?.avatar || player?.avatarUrl || null,
            country: player?.country || null,
            level: player?.games?.[game]?.level || player?.level || null,
            kdRatio: num(lifetime['Average K/D Ratio']),
            winRatePercent: num(lifetime['Win Rate %']),
            matchesPlayed: num(lifetime['Matches']),
            headshotPercent: num(lifetime['Headshots %']),
          };
        } catch (error) {
          console.error(`Error enriching player ${p.player_id}:`, error);
          return {
            id: p.player_id,
            nickname: p.nickname,
            avatarUrl: null,
            country: null,
            level: null,
            kdRatio: 0,
            winRatePercent: 0,
            matchesPlayed: 0,
            headshotPercent: 0,
          };
        }
      })
    );

    return res.json(enriched);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Player summary (details + lifetime stats)
app.get('/faceit/players/:id', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const game = String(req.query.game || DEFAULT_GAME);

    const [player, stats] = await Promise.all([
      faceitFetch<any>(`/players/${id}`),
      faceitFetch<any>(`/players/${id}/stats/${game}`),
    ]);
    const lifetime = stats?.lifetime || {};
    
    // Extract basic statistics
    const kd = lifetime['Average K/D Ratio'] ?? lifetime['Average K/D'] ?? lifetime['K/D Ratio'];
    const kpr = lifetime['Average K/R Ratio'] ?? lifetime['Average K/R'] ?? lifetime['K/R Ratio'];
    const matches = num(lifetime['Matches']);
    const kills = lifetime['Kills'];
    const deaths = lifetime['Deaths'];
    const rounds = lifetime['Rounds'];
    const winrate = num(lifetime['Win Rate %']);
    const computedKpr = kpr !== undefined ? kpr : (kills !== undefined && rounds ? Number(kills) / Number(rounds) : undefined);
    
    // Extract ELO information
    const elo = player?.games?.[game]?.faceit_elo ?? player?.faceit_elo;
    const highestElo = lifetime['Highest ELO'] ?? lifetime['Highest Elo'] ?? lifetime['Highest Elo'] ?? null;
    const lowestElo = lifetime['Lowest ELO'] ?? lifetime['Lowest Elo'] ?? lifetime['Lowest Elo'] ?? null;
    const avgElo = lifetime['Average ELO'] ?? lifetime['Average Elo'] ?? lifetime['Average Elo'] ?? null;
    
    // Extract wins and losses
    const wins = lifetime['Wins'];
    const losses = lifetime['Losses'];
    
    // Extract ratings
    const faRating = lifetime['FA Rating'] ?? lifetime['Average FA Rating'];
    const hltv = lifetime['HLTV Rating'] ?? lifetime['Average HLTV Rating'];
    
    // Extract headshots
    const headshots = lifetime['Headshots %'];

    // Debug logging for statistics
    console.log('Player stats debug:', {
      player_id: player.player_id,
      lifetime_keys: Object.keys(lifetime),
      kd: kd,
      kpr: kpr,
      kills: kills,
      deaths: deaths,
      wins: wins,
      losses: losses,
      elo: elo,
      highestElo: highestElo,
      lowestElo: lowestElo,
      avgElo: avgElo,
      faRating: faRating,
      hltv: hltv,
      headshots: headshots
    });

    const summary = {
      id: player.player_id,
      nickname: player.nickname,
      kdRatio: num(kd),
      winRatePercent: winrate,
      matchesPlayed: matches,
      headshotPercent: num(headshots),
      kpr: num(computedKpr),
      kills: num(kills),
      deaths: num(deaths),
      wins: num(wins),
      losses: num(losses),
      elo: num(elo),
      highestElo: num(highestElo),
      lowestElo: num(lowestElo),
      avgElo: num(avgElo),
      faRating: num(faRating),
      hltv: num(hltv),
      avatarUrl: player?.avatar ?? null,
      country: player?.country ?? null,
      level: player?.games?.[game]?.skill_level ?? null,
    };
    return res.json(summary);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Player match history (lightweight list)
app.get('/faceit/players/:id/matches', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const game = String(req.query.game || DEFAULT_GAME);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    const hist = await faceitFetch<any>(`/players/${id}/history`, {
      game,
      limit,
      offset,
    });

    const items = (hist?.items || []).map((m: any) => {
      const raw = m.played_at;
      const t = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
      const playedAt = isFinite(t) ? (t < 1e12 ? t * 1000 : t) : Date.now();
      return {
        matchId: m.match_id,
        game: m.game_id,
        playedAt,
      region: m.region,
      team: m.team,
      map: m.map,
      };
    });
    return res.json({ items, total: hist?.total || items.length });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Player match history with per-match personal stats and result
app.get('/faceit/players/:id/matches/details', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const game = String(req.query.game || DEFAULT_GAME);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    console.log(`[MATCHES] Starting to fetch matches for player ${id}, game: ${game}, limit: ${limit}, offset: ${offset}`);

    const hist = await faceitFetch<any>(`/players/${id}/history`, { game, limit, offset });
    console.log(`[MATCHES] History response received:`, {
      hasItems: !!hist?.items,
      itemsCount: hist?.items?.length || 0,
      total: hist?.total
    });

    const items: Array<{ match_id: string; played_at: number } & Record<string, any>> = hist?.items || [];
    
    if (items.length === 0) {
      console.log(`[MATCHES] No matches found for player ${id}`);
      return res.json({ items: [], total: 0 });
    }

    const concurrency = 5;
    const chunks: Array<Array<{ match_id: string; played_at: number }>> = [];
    for (let i = 0; i < items.length; i += concurrency) chunks.push(items.slice(i, i + concurrency));

    console.log(`[MATCHES] Split into ${chunks.length} chunks with concurrency ${concurrency}`);

    const detailed: Array<{
      matchId: string;
      game: string;
      playedAt: number;
      region: string;
      map?: string;
      win?: boolean;
      team?: string;
      kills?: number;
      deaths?: number;
      headshots?: number;
      kd?: number;
      scoreFor?: number;
      scoreAgainst?: number;
      mode?: string;
    }> = [];

    for (const [chunkIndex, group] of chunks.entries()) {
      console.log(`[MATCHES] Processing chunk ${chunkIndex + 1}/${chunks.length} with ${group.length} matches`);
      
      const results = await Promise.all(
        group.map(async (m) => {
          try {
            // Получаем основные данные матча И статистику параллельно
            const [matchData, matchStats] = await Promise.all([
              faceitFetch<any>(`/matches/${m.match_id}`),
              faceitFetch<any>(`/matches/${m.match_id}/stats`).catch(() => null)
            ]);
            
            console.log(`[MATCHES] Match ${m.match_id} loaded successfully`);
            console.log(`[MATCHES] Match stats available: ${!!matchStats}`);
            
            if (matchStats) {
              console.log(`[MATCHES] Built-in stats structure:`, {
                hasRounds: !!matchStats.rounds,
                roundsCount: matchStats.rounds?.length || 0,
                statsKeys: Object.keys(matchStats || {}),
                roundsStructure: matchStats.rounds?.length > 0 ? {
                  firstRound: matchStats.rounds[0],
                  roundKeys: Object.keys(matchStats.rounds[0] || {})
                } : null
              });
            }
            
            // Объединяем данные
            return {
              ...matchData,
              stats: matchStats
            };
          } catch (error) {
            console.error(`[MATCHES] Failed to load match ${m.match_id}:`, error);
            return null;
          }
        })
      );

      for (const md of results) {
        if (!md) continue;
        
        const allPlayers: Array<{ player_id: string; nickname: string; teamKey: 'faction1' | 'faction2'; teamName?: string; player_stats?: Record<string, unknown> }> = [];
        const teamByKey: Record<string, any> = { faction1: md?.teams?.faction1, faction2: md?.teams?.faction2 };
        
        (['faction1','faction2'] as const).forEach((key) => {
          const t = teamByKey[key];
          const roster = t?.roster || [];
          for (const pl of roster) {
            allPlayers.push({ player_id: pl?.player_id, nickname: pl?.nickname, teamKey: key, teamName: t?.name, player_stats: pl?.player_stats });
          }
        });

        const me = allPlayers.find((p) => p.player_id === id);
        if (!me) {
          console.log(`[MATCHES] Player ${id} not found in match ${md?.match_id}`);
          continue;
        }

        // derive winner and score
        let winnerKey: 'faction1' | 'faction2' | undefined = undefined;
        let scoreFor = 0;
        let scoreAgainst = 0;
        
        const resultsObj = md?.results;
        if (resultsObj) {
          // Some payloads contain winner as 'faction1' or 'faction2'
          if (resultsObj.winner === 'faction1' || resultsObj.winner === 'faction2') {
            winnerKey = resultsObj.winner;
          }
        }
        
        // Get scores from multiple sources - PRIORITIZE REAL ROUND SCORES
        let team1Score = 0, team2Score = 0;
        
        // METHOD 1: Try to get REAL ROUND SCORES from /stats endpoint (HIGHEST PRIORITY!)
        let statsData: any = null;
        try {
          console.log(`[MATCHES] Fetching stats data for match ${md?.match_id}`);
          statsData = await faceitFetch<any>(`/matches/${md?.match_id}/stats`);
          console.log(`[MATCHES] Stats data fetched successfully`);
          console.log(`[MATCHES] Stats structure:`, {
            hasRounds: !!statsData?.rounds,
            roundsCount: statsData?.rounds?.length || 0,
            roundsStructure: statsData?.rounds?.length > 0 ? {
              firstRound: statsData.rounds[0],
              hasTeams: !!statsData.rounds[0]?.teams,
              teamsCount: statsData.rounds[0]?.teams?.length || 0,
              sampleRoundKeys: Object.keys(statsData.rounds[0] || {})
            } : null
          });
        } catch (e: any) {
          console.log(`[MATCHES] Failed to fetch stats data:`, e?.message || 'Unknown error');
        }
        
        if (statsData?.rounds?.length > 0) {
          console.log(`[MATCHES] Trying to calculate round scores from stats endpoint`);
          console.log(`[MATCHES] Total rounds found: ${statsData.rounds.length}`);

          // METHOD 1A: Try to read scores directly from stats.teams[].team_stats (works even when rounds length === 1)
          try {
            const firstRound: any = statsData.rounds[0];
            const teamsArr: Array<any> = Array.isArray(firstRound?.teams) ? firstRound.teams : [];
            const scoreByFaction: Record<'faction1' | 'faction2', number> = { faction1: 0, faction2: 0 };
            for (const team of teamsArr) {
              const factionId = team?.team_id as 'faction1' | 'faction2' | undefined;
              if (factionId !== 'faction1' && factionId !== 'faction2') continue;
              const ts = team?.team_stats || {};
              // Common keys observed in FACEIT stats payloads
              const rawScore = ts.Score ?? ts['Final Score'] ?? ts['Final score'] ?? ts['Rounds'] ?? ts['Rounds Won'] ?? ts['RoundsWon'];
              let parsed = 0;
              if (typeof rawScore === 'number') parsed = rawScore;
              else if (typeof rawScore === 'string') {
                const m = rawScore.match(/\d+/);
                if (m) parsed = Number(m[0]);
              }
              if (parsed > 0) scoreByFaction[factionId] = parsed;
            }
            if (scoreByFaction.faction1 > 0 || scoreByFaction.faction2 > 0) {
              team1Score = scoreByFaction.faction1;
              team2Score = scoreByFaction.faction2;
              console.log(`[MATCHES] ✅ Scores from stats.team_stats: faction1=${team1Score}, faction2=${team2Score}`);
            }
          } catch (e) {
            console.log(`[MATCHES] Error while reading team_stats scores from stats`, (e as any)?.message || e);
          }

          // METHOD 1B: Parse combined score from stats.rounds[0].round_stats.Score like "16 / 14",
          // and align ordering using the winner if available
          if (team1Score === 0 && team2Score === 0) {
            try {
              const firstRound: any = statsData.rounds[0];
              const rs = firstRound?.round_stats || {};
              const rawCombined = rs.Score ?? rs.score ?? rs.Result ?? rs['Final Score'] ?? rs['Final score'];
              if (typeof rawCombined === 'string') {
                const m = rawCombined.match(/(\d+)\s*[-\/:]\s*(\d+)/);
                if (m) {
                  let a = Number(m[1]);
                  let b = Number(m[2]);
                  // Try to align numbers with md.results.winner (if it contradicts, swap)
                  if (winnerKey === 'faction1' && a < b) {
                    [a, b] = [b, a];
                  } else if (winnerKey === 'faction2' && b < a) {
                    [a, b] = [b, a];
                  }
                  team1Score = a;
                  team2Score = b;
                  console.log(`[MATCHES] ✅ Parsed round_stats.Score: ${team1Score}-${team2Score}`);
                }
              }
            } catch (e) {
              console.log(`[MATCHES] Error while parsing round_stats.Score`, (e as any)?.message || e);
            }
          }

          // METHOD 1C: If we truly have per-round data (length > 1), fall back to counting winners
          if (team1Score === 0 && team2Score === 0 && statsData.rounds.length > 1) {
            // Calculate round wins for each faction
            let faction1Rounds = 0, faction2Rounds = 0;
            for (const round of statsData.rounds) {
              if (round?.winner === 'faction1') faction1Rounds++;
              else if (round?.winner === 'faction2') faction2Rounds++;
            }
            console.log(`[MATCHES] Calculated rounds: faction1=${faction1Rounds}, faction2=${faction2Rounds}`);
            if (faction1Rounds > 0 || faction2Rounds > 0) {
              team1Score = faction1Rounds;
              team2Score = faction2Rounds;
              console.log(`[MATCHES] ✅ Calculated REAL ROUND SCORES from per-round winners: ${team1Score}-${team2Score}`);
            }
          }

          if (team1Score === 0 && team2Score === 0) {
            console.log(`[MATCHES] ⚠️ Stats endpoint did not expose explicit round scores for this match`);
          }
        }
        
        // METHOD 2: Try detailed_results as fallback (usually contains match results, not rounds)
        if ((team1Score === 0 && team2Score === 0) && Array.isArray(md?.detailed_results) && md.detailed_results.length > 0) {
          console.log(`[MATCHES] Trying detailed_results as fallback (WARNING: usually contains match results)`);
          
          for (const result of md.detailed_results) {
            if (result?.factions && typeof result.factions === 'object') {
              const factionKeys = Object.keys(result.factions);
              const faction1Data = result.factions[factionKeys[0]];
              const faction2Data = result.factions[factionKeys[1]];
              
              const faction1Score = Number(faction1Data?.score ?? 0);
              const faction2Score = Number(faction2Data?.score ?? 0);
              
              console.log(`[MATCHES] detailed_results scores: ${faction1Score}-${faction2Score}`);
              
              // Only use if scores look like rounds (> 1), otherwise it's match result
              if (faction1Score > 1 || faction2Score > 1) {
                team1Score = faction1Score;
                team2Score = faction2Score;
                console.log(`[MATCHES] ✅ Using detailed_results as ROUND SCORES: ${team1Score}-${team2Score}`);
                break;
              } else {
                console.log(`[MATCHES] ⚠️ detailed_results contains match results (${faction1Score}-${faction2Score}), not rounds`);
              }
            }
          }
        }
        
        // METHOD 3: Check results.score but only use if values > 1 (might be round scores)
        if ((team1Score === 0 && team2Score === 0) && md?.results?.score && typeof md.results.score === 'object') {
          const scoreObj = md.results.score;
          const scoreValues = Object.values(scoreObj).map(Number);
          
          console.log(`[MATCHES] Checking results.score values:`, scoreValues);
          
          // Only use results.score if values suggest round scores (> 1)
          if (scoreValues.some(v => v > 1)) {
            const scoreKeys = Object.keys(scoreObj);
            team1Score = Number(scoreObj[scoreKeys[0]] ?? 0);
            team2Score = Number(scoreObj[scoreKeys[1]] ?? 0);
            console.log(`[MATCHES] Using results.score as ROUND SCORES: ${team1Score}-${team2Score}`);
          } else {
            console.log(`[MATCHES] results.score contains match results (1-0), not round scores - skipping`);
          }
        }
        
        // METHOD 4: Fallback to team stats
        if (team1Score === 0 && team2Score === 0) {
          console.log(`[MATCHES] Trying team stats as fallback`);
          if (md?.teams?.faction1?.stats) {
            team1Score = Number(md.teams.faction1.stats.Score ?? md.teams.faction1.stats.score ?? 0);
          }
          if (md?.teams?.faction2?.stats) {
            team2Score = Number(md.teams.faction2.stats.Score ?? md.teams.faction2.stats.score ?? 0);
          }
          if (team1Score > 0 || team2Score > 0) {
            console.log(`[MATCHES] Using team stats: ${team1Score}-${team2Score}`);
          }
        }
        
        // METHOD 5: Fallback to results object structure
        if (team1Score === 0 && team2Score === 0 && md?.results) {
          console.log(`[MATCHES] Trying results faction structure`);
          if (md.results.faction1 && typeof md.results.faction1 === 'object') {
            team1Score = Number(md.results.faction1.score ?? md.results.faction1.Score ?? 0);
          }
          if (md.results.faction2 && typeof md.results.faction2 === 'object') {
            team2Score = Number(md.results.faction2.score ?? md.results.faction2.Score ?? 0);
          }
        }
        
        // METHOD 6: Last resort - use match result (1-0) if no round scores found
        if (team1Score === 0 && team2Score === 0 && md?.results?.score) {
          console.log(`[MATCHES] ⚠️ No round scores found, using match result as last resort`);
          console.log(`[MATCHES] 📋 INFO: Round-by-round data is not available for older matches in FACEIT API`);
          console.log(`[MATCHES] 📋 INFO: Only match result (win/loss) is available: 1-0 means won, 0-1 means lost`);
          const scoreObj = md.results.score;
          const scoreKeys = Object.keys(scoreObj);
          team1Score = Number(scoreObj[scoreKeys[0]] ?? 0);
          team2Score = Number(scoreObj[scoreKeys[1]] ?? 0);
          console.log(`[MATCHES] ⚠️ Using match result: ${team1Score}-${team2Score} (MATCH RESULT, NOT ROUND SCORE)`);
        }
        
        console.log(`[MATCHES] Scores extracted: Team1=${team1Score}, Team2=${team2Score}`);
        console.log(`[MATCHES] Player team: ${me.teamKey}, Winner: ${winnerKey}`);
        console.log(`[MATCHES] Match data structure check:`, {
          hasResults: !!md?.results,
          hasResultsScore: !!md?.results?.score,
          resultsScoreKeys: md?.results?.score ? Object.keys(md.results.score) : [],
          resultsScoreValues: md?.results?.score ? Object.values(md.results.score) : [],
          hasTeamsStats: !!md?.teams?.faction1?.stats || !!md?.teams?.faction2?.stats,
          team1Stats: md?.teams?.faction1?.stats ? Object.keys(md.teams.faction1.stats) : [],
          team2Stats: md?.teams?.faction2?.stats ? Object.keys(md.teams.faction2.stats) : []
        });
        
        if (me.teamKey === 'faction1') {
          scoreFor = team1Score;
          scoreAgainst = team2Score;
          if (!winnerKey && team1Score !== team2Score) {
            winnerKey = team1Score > team2Score ? 'faction1' : 'faction2';
          }
        } else {
          scoreFor = team2Score;
          scoreAgainst = team1Score;
          if (!winnerKey && team1Score !== team2Score) {
            winnerKey = team2Score > team1Score ? 'faction2' : 'faction1';
          }
        }
        
        console.log(`[MATCHES] Final score assignment: scoreFor=${scoreFor}, scoreAgainst=${scoreAgainst}`);
        console.log(`[MATCHES] Winner determined: ${winnerKey}, Win status: ${winnerKey === me.teamKey}`);

        // Extract player statistics - try multiple possible locations
        let kills = 0, deaths = 0, headshots = 0;
        
        console.log(`[MATCHES] Extracting stats for player ${id} in match ${md?.match_id}`);
        console.log(`[MATCHES] Match data structure:`, {
          hasTeams: !!md?.teams,
          hasStats: !!md?.stats,
          hasRounds: !!md?.stats?.rounds,
          playerFound: !!me,
          playerTeam: me?.teamKey,
          statsRoundsCount: md?.stats?.rounds?.length || 0
        });
        
        // PRIMARY METHOD: Use /stats endpoint data (according to Faceit API docs)
        if (md?.stats?.rounds?.length > 0) {
          console.log(`[MATCHES] Using stats endpoint data`);
          
          // Ищем игрока в статистике раундов
          for (const round of md.stats.rounds) {
            const teams = round?.teams || [];
            for (const team of teams) {
              const players = team?.players || [];
              const playerStats = players.find((p: any) => p.player_id === id);
              
              if (playerStats?.player_stats) {
                kills = num((playerStats.player_stats as any)?.Kills || (playerStats.player_stats as any)?.kills);
                deaths = num((playerStats.player_stats as any)?.Deaths || (playerStats.player_stats as any)?.deaths);
                headshots = num((playerStats.player_stats as any)?.Headshots || (playerStats.player_stats as any)?.headshots);
                console.log(`[MATCHES] Found in stats endpoint: K=${kills}, D=${deaths}, HS=${headshots}`);
                break;
              }
            }
            if (kills > 0 || deaths > 0) break;
          }
        }
        
        // FALLBACK METHOD 1: Try player_stats from roster (legacy)
        if (kills === 0 && deaths === 0 && me?.player_stats) {
          kills = num((me.player_stats as any)?.Kills || (me.player_stats as any)?.kills);
          deaths = num((me.player_stats as any)?.Deaths || (me.player_stats as any)?.deaths);
          headshots = num((me.player_stats as any)?.Headshots || (me.player_stats as any)?.headshots);
          console.log(`[MATCHES] Fallback 1 (roster stats): K=${kills}, D=${deaths}, HS=${headshots}`);
        }
        
        // FALLBACK METHOD 2: Try to find in match details players array
        if (kills === 0 && deaths === 0) {
          const matchPlayers = md?.players || [];
          const matchPlayer = matchPlayers.find((p: any) => p.player_id === id);
          if (matchPlayer) {
            kills = num(matchPlayer.kills || matchPlayer.Kills);
            deaths = num(matchPlayer.deaths || matchPlayer.Deaths);
            headshots = num(matchPlayer.headshots || matchPlayer.Headshots);
            console.log(`[MATCHES] Fallback 2 (players array): K=${kills}, D=${deaths}, HS=${headshots}`);
          }
        }
        
        console.log(`[MATCHES] Final stats for player ${id}: K=${kills}, D=${deaths}, HS=${headshots}`);
        
        const kd = deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
        const win = winnerKey ? winnerKey === me.teamKey : undefined;

        const matchDetail = {
          matchId: md?.match_id,
          game: md?.game || md?.game_id,
          playedAt: (() => {
            const raw = md?.started_at ?? md?.date ?? md?.finished_at ?? 0;
            if (typeof raw === 'string') {
              const d = Date.parse(raw);
              return isFinite(d) ? d : Date.now();
            }
            const n = Number(raw);
            if (!isFinite(n)) return Date.now();
            return n < 1e12 ? n * 1000 : n;
          })(),
          region: md?.region || 'unknown',
          map: md?.voting?.map?.pick || md?.map || md?.maps?.[0]?.name,
          win,
          team: me?.teamName,
          kills,
          deaths,
          headshots,
          kd,
          scoreFor,
          scoreAgainst,
        };

        detailed.push(matchDetail);
        console.log(`[MATCHES] Added match detail:`, {
          matchId: matchDetail.matchId,
          map: matchDetail.map,
          region: matchDetail.region,
          kills: matchDetail.kills,
          deaths: matchDetail.deaths,
          kd: matchDetail.kd,
          win: matchDetail.win
        });
      }
    }

    // sort by playedAt desc to match recent first
    detailed.sort((a, b) => b.playedAt - a.playedAt);
    
    console.log(`[MATCHES] Final result: ${detailed.length} matches processed for player ${id}`);
    
    return res.json({ items: detailed, total: detailed.length });
  } catch (e: any) {
    console.error(`[MATCHES] Error processing matches for player ${req.params.id}:`, e);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Player teammates aggregated from last N matches
app.get('/faceit/players/:id/teammates', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const game = String(req.query.game || DEFAULT_GAME);
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    // 1) fetch recent matches
    const hist = await faceitFetch<any>(`/players/${id}/history`, { game, limit, offset });
    const items: Array<{ match_id: string }> = hist?.items || [];

    // 2) fetch match details with small concurrency
    const concurrency = 5;
    const chunks: Array<Array<{ match_id: string }>> = [];
    for (let i = 0; i < items.length; i += concurrency) chunks.push(items.slice(i, i + concurrency));

    const teammateToStats: Record<string, { nickname: string; matches: number }> = {};

    for (const group of chunks) {
      const results = await Promise.all(
        group.map(async (m) => {
          try {
            return await faceitFetch<any>(`/matches/${m.match_id}`);
          } catch {
            return null;
          }
        })
      );
      for (const md of results) {
        if (!md) continue;
        // find player's team and collect teammates
        const teams = md?.teams?.faction1 && md?.teams?.faction2 ? [md.teams.faction1, md.teams.faction2] : [];
        const allPlayers: Array<{ player_id: string; nickname: string; team?: string }> = [];
        for (const t of teams) {
          const roaster = t?.roster || [];
          for (const pl of roaster) {
            allPlayers.push({ player_id: pl?.player_id, nickname: pl?.nickname, team: t?.name });
          }
        }
        const me = allPlayers.find((p) => p.player_id === id);
        if (!me) continue;
        const myTeam = me.team;
        for (const p of allPlayers) {
          if (p.player_id === id) continue;
          if (p.team !== myTeam) continue; // only teammates, not opponents
          const key = p.player_id;
          if (!teammateToStats[key]) teammateToStats[key] = { nickname: p.nickname, matches: 0 };
          teammateToStats[key].matches += 1;
        }
      }
    }

    const list = Object.entries(teammateToStats)
      .map(([tid, s]) => ({ id: tid, nickname: s.nickname, matchesTogether: s.matches }))
      .sort((a, b) => b.matchesTogether - a.matchesTogether);

    return res.json({ items: list });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Player map stats based on stats segments
app.get('/faceit/players/:id/maps', async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const game = String(req.query.game || DEFAULT_GAME);
    const stats = await faceitFetch<any>(`/players/${id}/stats/${game}`);
    const segments = Array.isArray(stats?.segments) ? stats.segments : [];
    const maps = segments
      .filter((s: any) => s?.type === 'map')
      .map((s: any) => ({
        map: s?.label || s?.mode || 'Unknown',
        winRatePercent: num(s?.stats?.['Win Rate %']),
        kdRatio: num(s?.stats?.['Average K/D Ratio'] ?? s?.stats?.['Average K/D'] ?? s?.stats?.['K/D Ratio']),
        matchesPlayed: num(s?.stats?.Matches),
      }));
    return res.json({ items: maps });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Debug endpoint to inspect match data structure
app.get('/faceit/debug/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const [md, ms] = await Promise.all([
      faceitFetch<any>(`/matches/${matchId}`),
      faceitFetch<any>(`/matches/${matchId}/stats`).catch(() => null)
    ]);
    
    // Return raw match data for debugging
    res.json({
      matchId: md?.match_id,
      basicMatch: {
        hasTeams: !!md?.teams,
        hasPlayers: !!md?.players,
        hasRounds: !!md?.rounds,
        teamsStructure: {
          faction1: {
            hasRoster: !!md?.teams?.faction1?.roster,
            rosterCount: md?.teams?.faction1?.roster?.length || 0,
            samplePlayer: md?.teams?.faction1?.roster?.[0] || null
          },
          faction2: {
            hasRoster: !!md?.teams?.faction2?.roster,
            rosterCount: md?.teams?.faction2?.roster?.length || 0,
            samplePlayer: md?.teams?.faction2?.roster?.[0] || null
          }
        }
      },
      statsEndpoint: {
        available: !!ms,
        hasRounds: !!ms?.rounds,
        roundsCount: ms?.rounds?.length || 0,
        sampleStatsRound: ms?.rounds?.[0] ? {
          hasTeams: !!ms.rounds[0].teams,
          teamsCount: ms.rounds[0].teams?.length || 0,
          sampleTeam: ms.rounds[0].teams?.[0] ? {
            hasPlayers: !!ms.rounds[0].teams[0].players,
            playersCount: ms.rounds[0].teams[0].players?.length || 0,
            samplePlayer: ms.rounds[0].teams[0].players?.[0] || null
          } : null
        } : null
      },
      rawMatch: md, // Full raw match data
      rawStats: ms  // Full raw stats data
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Detailed match info with scoreboard
app.get('/faceit/matches/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params as { matchId: string };
    const [md, ms] = await Promise.all([
      faceitFetch<any>(`/matches/${matchId}`),
      faceitFetch<any>(`/matches/${matchId}/stats`).catch(() => null),
    ]);
    const toMs = (v: unknown) => {
      if (typeof v === 'string') {
        const d = Date.parse(v);
        return isFinite(d) ? d : Date.now();
      }
      const n = Number(v);
      return isFinite(n) ? (n < 1e12 ? n * 1000 : n) : Date.now();
    };
    const statPlayersById: Record<string, { kills: number; deaths: number; hs: number }> = {};
    // Stats payload shape: { rounds: [{ teams: [{ players: [{ player_id, player_stats: { Kills, Deaths, Headshots } }] }]}] }
    const rounds = Array.isArray(ms?.rounds) ? ms.rounds : [];
    for (const r of rounds) {
      const tms = Array.isArray(r?.teams) ? r.teams : [];
      for (const team of tms) {
        const players: Array<any> = Array.isArray(team?.players) ? team.players : [];
        for (const p of players) {
          const pid = p?.player_id;
          if (!pid) continue;
          const k = num(p?.player_stats?.Kills);
          const d = num(p?.player_stats?.Deaths);
          const h = num(p?.player_stats?.Headshots);
          statPlayersById[pid] = { kills: k, deaths: d, hs: h };
        }
      }
    }

    // Enhanced score extraction for match details
    const extractedScores = { faction1: 0, faction2: 0 };
    
    // METHOD 1: Try to get ROUND SCORES from detailed_results (HIGHEST PRIORITY)
    if (Array.isArray(md?.detailed_results) && md.detailed_results.length > 0) {
      console.log(`[MATCH DETAILS] Processing detailed_results:`, md.detailed_results);
      
      for (const result of md.detailed_results) {
        if (result?.factions && typeof result.factions === 'object') {
          const factionKeys = Object.keys(result.factions);
          console.log(`[MATCH DETAILS] Found factions in detailed_results:`, factionKeys);
          console.log(`[MATCH DETAILS] Faction data:`, result.factions);
          
          if (factionKeys.length >= 2) {
            const faction1Data = result.factions[factionKeys[0]];
            const faction2Data = result.factions[factionKeys[1]];
            
            console.log(`[MATCH DETAILS] Faction1 (${factionKeys[0]}) data:`, faction1Data);
            console.log(`[MATCH DETAILS] Faction2 (${factionKeys[1]}) data:`, faction2Data);
            
            const faction1Score = Number(faction1Data?.score ?? 0);
            const faction2Score = Number(faction2Data?.score ?? 0);
            
            console.log(`[MATCH DETAILS] Raw scores from detailed_results: ${faction1Score}-${faction2Score}`);
            
            // Check if these look like round scores (> 0) OR if we have any non-zero scores
            if (faction1Score > 0 || faction2Score > 0) {
              extractedScores.faction1 = faction1Score;
              extractedScores.faction2 = faction2Score;
              console.log(`[MATCH DETAILS] ✅ Found ROUND SCORES in detailed_results: ${extractedScores.faction1}-${extractedScores.faction2}`);
              break;
            } else {
              console.log(`[MATCH DETAILS] ❌ No valid scores in detailed_results (both are 0)`);
            }
          }
        }
      }
    }
    
    // METHOD 2: Try to get scores from /stats endpoint data (if available)
    if ((extractedScores.faction1 === 0 && extractedScores.faction2 === 0) && Array.isArray(ms?.rounds) && ms.rounds.length > 0) {
      console.log(`[MATCH DETAILS] Trying to calculate round scores from stats data`);
      
      // Calculate round wins for each faction
      let faction1Rounds = 0, faction2Rounds = 0;
      
      for (const round of ms.rounds) {
        if (round?.winner === 'faction1') faction1Rounds++;
        else if (round?.winner === 'faction2') faction2Rounds++;
      }
      
      // Only use if we have meaningful round data
      if (faction1Rounds > 1 || faction2Rounds > 1) {
        extractedScores.faction1 = faction1Rounds;
        extractedScores.faction2 = faction2Rounds;
        console.log(`[MATCH DETAILS] Calculated ROUND SCORES from stats: ${extractedScores.faction1}-${extractedScores.faction2}`);
      }
    }
    
    // METHOD 3: Check results.score but only use if values > 1 (might be round scores)
    if ((extractedScores.faction1 === 0 && extractedScores.faction2 === 0) && md?.results?.score && typeof md.results.score === 'object') {
      const scoreObj = md.results.score;
      const scoreValues = Object.values(scoreObj).map(Number);
      
      console.log(`[MATCH DETAILS] Checking results.score values:`, scoreValues);
      
      // Only use results.score if values suggest round scores (> 1)
      if (scoreValues.some(v => v > 1)) {
        const scoreKeys = Object.keys(scoreObj);
        extractedScores.faction1 = Number(scoreObj[scoreKeys[0]] ?? 0);
        extractedScores.faction2 = Number(scoreObj[scoreKeys[1]] ?? 0);
        console.log(`[MATCH DETAILS] Using results.score as ROUND SCORES: ${extractedScores.faction1}-${extractedScores.faction2}`);
      } else {
        console.log(`[MATCH DETAILS] results.score contains match results (1-0), not round scores - skipping`);
      }
    }

    const teams = ['faction1', 'faction2'] as const;
    const scoreboard = teams.map((key) => {
      const t = md?.teams?.[key] || {};
      const roster = Array.isArray(t?.roster) ? t.roster : [];
      
      // Use extracted scores if available, otherwise fallback to team stats
      let score = 0;
      if (extractedScores.faction1 > 0 || extractedScores.faction2 > 0) {
        score = key === 'faction1' ? extractedScores.faction1 : extractedScores.faction2;
      } else {
        score = Number(t?.stats?.Score ?? t?.stats?.score ?? 0);
      }
      
      return {
        key,
        name: t?.name,
        score,
        players: roster.map((pl: any) => {
          const pid = pl?.player_id;
          const fromStats = pid ? statPlayersById[pid] : undefined;
          const kills = fromStats ? fromStats.kills : num(pl?.player_stats?.Kills);
          const deaths = fromStats ? fromStats.deaths : num(pl?.player_stats?.Deaths);
          const hs = fromStats ? fromStats.hs : num(pl?.player_stats?.Headshots);
          const kd = deaths > 0 ? Number((kills / deaths).toFixed(2)) : kills;
          return {
            id: pid,
            nickname: pl?.nickname,
            kills,
            deaths,
            hs,
            kd,
            avatarUrl: pl?.avatar,
            level: pl?.skill_level,
          };
        }),
      };
    });
    const winner = md?.results?.winner ?? (scoreboard[0].score === scoreboard[1].score ? null : (scoreboard[0].score > scoreboard[1].score ? 'faction1' : 'faction2'));
    
    // Calculate scores for the response
    const scoreFor = scoreboard[0].score;
    const scoreAgainst = scoreboard[1].score;
    
    // Debug logging for match details
    console.log('Match details debug:', {
      matchId: md?.match_id,
      scoreboard_length: scoreboard.length,
      team1_players: scoreboard[0]?.players?.length,
      team2_players: scoreboard[1]?.players?.length,
      winner: winner,
      scoreFor: scoreFor,
      scoreAgainst: scoreAgainst
    });
    
    res.json({
      matchId: md?.match_id,
      game: md?.game || md?.game_id,
      map: md?.voting?.map?.pick || md?.map || md?.maps?.[0]?.name,
      startedAt: toMs(md?.started_at),
      finishedAt: toMs(md?.finished_at),
      region: md?.region,
      scoreboard,
      winner,
      scoreFor,
      scoreAgainst,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Simple debug endpoint for quick match analysis
app.get('/faceit/debug/match-quick/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const md = await faceitFetch<any>(`/matches/${matchId}`);
    
    // Extract detailed_results scores for debugging
    const detailedScoreAnalysis = [];
    if (Array.isArray(md?.detailed_results)) {
      for (const result of md.detailed_results) {
        if (result?.factions) {
          const factionKeys = Object.keys(result.factions);
          const scoreData: any = {};
          
          factionKeys.forEach(key => {
            scoreData[key] = {
              rawData: result.factions[key],
              score: result.factions[key]?.score,
              scoreAsNumber: Number(result.factions[key]?.score ?? 0)
            };
          });
          
          detailedScoreAnalysis.push({
            winner: result.winner,
            factionKeys,
            scores: scoreData
          });
        }
      }
    }
    
    const quickAnalysis = {
      matchId,
      status: md?.status,
      winner: md?.results?.winner,
      resultsScore: md?.results?.score,
      detailedResults: md?.detailed_results,
      detailedScoreAnalysis,
      teamsScore: {
        faction1: md?.teams?.faction1?.stats,
        faction2: md?.teams?.faction2?.stats
      },
      possibleRoundScores: {
        fromDetailedResults: md?.detailed_results?.map((r: any) => r?.factions) || [],
        fromResultsScore: md?.results?.score,
        analysis: {
          resultsScoreValues: md?.results?.score ? Object.values(md.results.score) : [],
          hasDetailedResults: !!md?.detailed_results?.length,
          detailedResultsCount: md?.detailed_results?.length || 0
        }
      },
      rawResults: md?.results,
      rawTeams: md?.teams
    };
    
    res.json(quickAnalysis);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Debug endpoint for match score analysis
app.get('/faceit/debug/match-score/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const md = await faceitFetch<any>(`/matches/${matchId}`);
    
    // Analyze all possible score sources
    const analysis = {
      matchId,
      resultsScore: {
        exists: !!md?.results?.score,
        type: typeof md?.results?.score,
        keys: md?.results?.score ? Object.keys(md.results.score) : [],
        values: md?.results?.score ? Object.values(md.results.score) : [],
        raw: md?.results?.score
      },
      teamsScore: {
        faction1: md?.teams?.faction1?.stats?.Score ?? md?.teams?.faction1?.stats?.score ?? null,
        faction2: md?.teams?.faction2?.stats?.Score ?? md?.teams?.faction2?.stats?.score ?? null
      },
      teamsStructure: md?.teams ? Object.keys(md.teams) : [],
      resultsWinner: md?.results?.winner,
      recommendation: null as string | null
    };
    
    // Provide recommendation
    if (analysis.resultsScore.exists && analysis.resultsScore.values.some(v => Number(v) > 0)) {
      analysis.recommendation = `Use results.score with keys: ${analysis.resultsScore.keys.join(', ')} and values: ${analysis.resultsScore.values.join(', ')}`;
    } else if (analysis.teamsScore.faction1 || analysis.teamsScore.faction2) {
      analysis.recommendation = `Use teams stats: faction1=${analysis.teamsScore.faction1}, faction2=${analysis.teamsScore.faction2}`;
    } else {
      analysis.recommendation = 'No valid scores found';
    }
    
    res.json(analysis);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Unknown error' });
  }
});

// Mount app under /api
export const api = functions.region('europe-west1').https.onRequest(app);


