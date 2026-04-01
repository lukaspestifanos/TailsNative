#!/usr/bin/env node
// Daily roster sync — run via cron: 0 6 * * * node /path/to/sync-rosters.js
// Syncs NBA + MLB rosters from ESPN into our Supabase players table.

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://aribokpssbfghhcfhuut.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyaWJva3Bzc2JmZ2hoY2ZodXV0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTIxMjIzNCwiZXhwIjoyMDg0Nzg4MjM0fQ.-GkODwziYM8GoBLU3nI112sGT6zwQ4NZn0YwZ0B90ig"
);

const NBA_TEAMS = ["atl","bos","bkn","cha","chi","cle","dal","den","det","gs","hou","ind","lac","lal","mem","mia","mil","min","no","ny","okc","orl","phi","phx","por","sac","sa","tor","uta","wsh"];
const MLB_TEAMS = ["ari","atl","bal","bos","chc","chw","cin","cle","col","det","hou","kc","laa","lad","mia","mil","min","nym","nyy","oak","phi","pit","sd","sf","sea","stl","tb","tex","tor","wsh"];

async function fetchNBA(abbr) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${abbr}/roster`);
  if (!res.ok) return [];
  const data = await res.json();
  const teamName = data.team?.displayName || "";
  const teamAbbr = data.team?.abbreviation || abbr.toUpperCase();
  return (data.athletes || [])
    .filter(a => a.displayName)
    .map(a => ({
      id: String(a.id), name: a.displayName, team: teamName, team_abbr: teamAbbr,
      league: "NBA", position: a.position?.abbreviation || "", jersey: a.jersey || "",
      headshot: a.headshot?.href || "", is_active: true, updated_at: new Date().toISOString(),
    }));
}

async function fetchMLB(abbr) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${abbr}/roster`);
  if (!res.ok) return [];
  const data = await res.json();
  const teamName = data.team?.displayName || "";
  const teamAbbr = data.team?.abbreviation || abbr.toUpperCase();
  const players = [];
  for (const group of (data.athletes || [])) {
    for (const a of (group.items || [])) {
      players.push({
        id: String(a.id), name: a.displayName || a.fullName || "", team: teamName, team_abbr: teamAbbr,
        league: "MLB", position: a.position?.abbreviation || "", jersey: a.jersey || "",
        headshot: a.headshot?.href || "", is_active: true, updated_at: new Date().toISOString(),
      });
    }
  }
  return players;
}

async function main() {
  console.log("[roster-sync] Starting...");
  let total = 0;

  for (const abbr of NBA_TEAMS) {
    const players = await fetchNBA(abbr);
    if (players.length) {
      await supabase.from("players").upsert(players, { onConflict: "id" });
      total += players.length;
    }
    await new Promise(r => setTimeout(r, 80));
  }

  for (const abbr of MLB_TEAMS) {
    const players = await fetchMLB(abbr);
    if (players.length) {
      await supabase.from("players").upsert(players, { onConflict: "id" });
      total += players.length;
    }
    await new Promise(r => setTimeout(r, 80));
  }

  console.log(`[roster-sync] Done: ${total} players synced`);
}

main().catch(console.error);
