// Roster sync — fetches all team rosters from ESPN and upserts into our players table.
// Run this periodically (daily cron or on-demand) to keep rosters fresh.
// After initial sync, player search is fully in-house — no ESPN dependency per query.

import { supabase } from "./supabase";

const NBA_TEAMS = [
  "atl","bos","bkn","cha","chi","cle","dal","den","det","gs",
  "hou","ind","lac","lal","mem","mia","mil","min","no","ny",
  "okc","orl","phi","phx","por","sac","sa","tor","uta","wsh"
];

const MLB_TEAMS = [
  "ari","atl","bal","bos","chc","chw","cin","cle","col","det",
  "hou","kc","laa","lad","mia","mil","min","nym","nyy","oak",
  "phi","pit","sd","sf","sea","stl","tb","tex","tor","wsh"
];

type Player = {
  id: string;
  name: string;
  team: string;
  team_abbr: string;
  league: string;
  position: string;
  jersey: string;
  headshot: string;
  is_active: boolean;
};

async function fetchTeamRoster(sport: string, league: string, teamAbbr: string): Promise<Player[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league.toLowerCase()}/teams/${teamAbbr}/roster`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    const teamName = data.team?.displayName || "";
    const abbr = data.team?.abbreviation || teamAbbr.toUpperCase();
    const players: Player[] = [];

    for (const group of data.athletes || []) {
      for (const athlete of group.items || []) {
        players.push({
          id: athlete.id || "",
          name: athlete.displayName || athlete.fullName || "",
          team: teamName,
          team_abbr: abbr,
          league: league.toUpperCase(),
          position: athlete.position?.abbreviation || "",
          jersey: athlete.jersey || "",
          headshot: athlete.headshot?.href || "",
          is_active: true,
        });
      }
    }

    return players;
  } catch {
    return [];
  }
}

export async function syncAllRosters(): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  // NBA
  for (const abbr of NBA_TEAMS) {
    const players = await fetchTeamRoster("basketball", "nba", abbr);
    if (players.length > 0) {
      const { error } = await supabase
        .from("players")
        .upsert(players.map((p) => ({ ...p, updated_at: new Date().toISOString() })), { onConflict: "id" });
      if (error) { errors++; console.error(`NBA ${abbr}:`, error.message); }
      else synced += players.length;
    }
    // Small delay to not hammer ESPN
    await new Promise((r) => setTimeout(r, 100));
  }

  // MLB
  for (const abbr of MLB_TEAMS) {
    const players = await fetchTeamRoster("baseball", "mlb", abbr);
    if (players.length > 0) {
      const { error } = await supabase
        .from("players")
        .upsert(players.map((p) => ({ ...p, updated_at: new Date().toISOString() })), { onConflict: "id" });
      if (error) { errors++; console.error(`MLB ${abbr}:`, error.message); }
      else synced += players.length;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return { synced, errors };
}
