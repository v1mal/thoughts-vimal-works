create table if not exists public.thoughts (
  id text primary key,
  text_original text not null,
  text_published text,
  status text not null check (status in ('pending', 'approved', 'rejected', 'hidden')),
  timestamp_ist timestamptz not null,
  seed text,
  score integer,
  reason text,
  suggestion text,
  round integer,
  source text not null default 'n8n',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by_email text,
  hidden_at timestamptz
);

create index if not exists thoughts_status_idx on public.thoughts (status);
create index if not exists thoughts_timestamp_idx on public.thoughts (timestamp_ist desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_thoughts_updated_at on public.thoughts;
create trigger set_thoughts_updated_at
before update on public.thoughts
for each row
execute function public.set_updated_at();

alter table public.thoughts enable row level security;

drop policy if exists "Thoughts admin select" on public.thoughts;
create policy "Thoughts admin select"
on public.thoughts
for select
using ((auth.jwt() ->> 'email') = 'vimal@nusigma.in');

drop policy if exists "Thoughts admin insert" on public.thoughts;
create policy "Thoughts admin insert"
on public.thoughts
for insert
with check ((auth.jwt() ->> 'email') = 'vimal@nusigma.in');

drop policy if exists "Thoughts admin update" on public.thoughts;
create policy "Thoughts admin update"
on public.thoughts
for update
using ((auth.jwt() ->> 'email') = 'vimal@nusigma.in')
with check ((auth.jwt() ->> 'email') = 'vimal@nusigma.in');

create or replace view public.approved_thoughts_export as
select
  id,
  coalesce(text_published, text_original) as text,
  timestamp_ist as timestamp
from public.thoughts
where status = 'approved'
order by timestamp_ist desc;
