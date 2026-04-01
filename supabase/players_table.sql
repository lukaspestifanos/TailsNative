-- Players table — our own roster database
-- Synced from ESPN rosters, but owned by us. Search queries this, not ESPN.

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,              -- espn athlete id
  name TEXT NOT NULL,
  team TEXT NOT NULL,               -- full team name e.g. "Los Angeles Lakers"
  team_abbr TEXT,                   -- e.g. "LAL"
  league TEXT NOT NULL,             -- "NBA", "MLB", etc.
  position TEXT,                    -- "PG", "SF", "SP", etc.
  jersey TEXT,
  headshot TEXT,                    -- headshot URL
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast search
CREATE INDEX IF NOT EXISTS idx_players_name ON players USING gin (to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_players_team ON players (team);
CREATE INDEX IF NOT EXISTS idx_players_league ON players (league);

-- RLS: public read
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Players are viewable by everyone" ON players FOR SELECT USING (true);
