create table api_events (
  id bigserial primary key,
  route text not null,
  created_at timestamptz not null default now()
);
