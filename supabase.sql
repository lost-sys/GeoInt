-- GeoInt — stockage persistant
create table if not exists public.geoint_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
 
-- Sécurité : bloque l'accès via la clé publique (anon). La clé secrète du serveur contourne RLS.
alter table public.geoint_state enable row level security;
 
