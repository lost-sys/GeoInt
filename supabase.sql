-- GeoInt V10 — stockage persistant
create table if not exists public.geoint_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Le serveur utilise la clé secrète Supabase côté Render.
-- Ne mets JAMAIS cette clé dans le HTML ou GitHub.
