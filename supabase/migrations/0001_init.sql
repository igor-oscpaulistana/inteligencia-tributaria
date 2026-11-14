-- Assistente executivo no WhatsApp — esquema inicial.
-- Todo acesso é feito no servidor com a service role key; o RLS fica ligado
-- e sem políticas, de modo que as chaves públicas (anon) não leem nada.

create extension if not exists pgcrypto;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  phone_key text not null unique,
  wa_id text not null,
  name text,
  email text,
  role text not null default 'desconhecido'
    check (role in ('ceo', 'cliente', 'desconhecido', 'bloqueado')),
  notes text,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null default 'chat'
    check (kind in ('chat', 'reminder', 'briefing', 'notification')),
  body text not null,
  wa_message_id text unique,
  created_at timestamptz not null default now()
);
create index messages_contact_created_idx on public.messages (contact_id, created_at desc);

create table public.meeting_requests (
  id bigint generated always as identity primary key,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  subject text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  modality text not null check (modality in ('presencial', 'online')),
  hold_event_id text,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  created_at timestamptz not null default now()
);
create index meeting_requests_status_idx on public.meeting_requests (status, start_at);

-- Idempotência de lembretes, briefings e resumos.
create table public.sent_notifications (
  key text primary key,
  created_at timestamptz not null default now()
);

create table public.news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.news_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.news_sources (id) on delete cascade,
  url text not null unique,
  title text not null,
  summary text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  digested_at timestamptz
);
create index news_items_pending_idx on public.news_items (fetched_at) where digested_at is null;

alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.meeting_requests enable row level security;
alter table public.sent_notifications enable row level security;
alter table public.news_sources enable row level security;
alter table public.news_items enable row level security;
