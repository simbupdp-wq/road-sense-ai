-- Run this once in Supabase Dashboard > SQL Editor.
-- Profiles are linked to Supabase Auth. End users can read only their own
-- profile; they cannot change their role from the app.

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null,
    email text not null unique,
    role text not null default 'public'
        check (role in ('public', 'authority')),
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant usage on schema public to authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
    on public.profiles
    for select
    to authenticated
    using ((select auth.uid()) = id);

create or replace function public.handle_new_roadsense_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name, email, role)
    values (
        new.id,
        coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
        new.email,
        'public'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_roadsense on auth.users;
create trigger on_auth_user_created_roadsense
    after insert on auth.users
    for each row execute procedure public.handle_new_roadsense_user();

-- Backfill profiles for accounts that existed before this setup was applied.
insert into public.profiles (id, display_name, email, role)
select
    users.id,
    coalesce(nullif(users.raw_user_meta_data ->> 'display_name', ''), split_part(users.email, '@', 1)),
    users.email,
    'public'
from auth.users as users
where users.email is not null
on conflict (id) do nothing;

-- Reviewed event snapshots power the Public confirmed-hotspot map.
-- Analysis candidates stay private until an Authority records a decision.
create table if not exists public.road_safety_events (
    event_id text primary key,
    analysis_id text not null,
    camera_id text,
    location_name text not null,
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    location_source text not null default 'demo'
        check (location_source in ('camera', 'demo')),
    risk text,
    object_classes jsonb not null default '[]'::jsonb,
    object_ids jsonb not null default '[]'::jsonb,
    start_frame integer,
    peak_frame integer,
    end_frame integer,
    minimum_distance_pixels double precision,
    review_status text not null check (review_status in ('confirmed', 'dismissed')),
    review_note text not null default '',
    reviewed_at timestamptz not null default now()
);

alter table public.road_safety_events enable row level security;
grant usage on schema public to anon;
grant select (camera_id, location_name, latitude, longitude, location_source, review_status)
    on public.road_safety_events to anon;
grant insert on public.road_safety_events to authenticated;
revoke update, delete on public.road_safety_events from anon, authenticated;

drop policy if exists "Anyone can read confirmed road safety events" on public.road_safety_events;
create policy "Anyone can read confirmed road safety events"
    on public.road_safety_events
    for select
    to anon
    using (review_status = 'confirmed');

drop policy if exists "Authorities can save event reviews" on public.road_safety_events;
create policy "Authorities can save event reviews"
    on public.road_safety_events
    for insert
    to authenticated
    with check (
        exists (
            select 1
            from public.profiles
            where profiles.id = (select auth.uid())
              and profiles.role = 'authority'
        )
    );

create index if not exists road_safety_events_camera_location_idx
    on public.road_safety_events (camera_id, latitude, longitude);
create index if not exists road_safety_events_review_status_idx
    on public.road_safety_events (review_status);

do $$
begin
    if to_regclass('public.profiles') is null then
        raise exception 'RoadSense setup incomplete: public.profiles was not created.';
    end if;
    if to_regclass('public.road_safety_events') is null then
        raise exception 'RoadSense setup incomplete: public.road_safety_events was not created.';
    end if;
end;
$$;

notify pgrst, 'reload schema';

select
    to_regclass('public.profiles') as profiles_table,
    to_regclass('public.road_safety_events') as events_table;
