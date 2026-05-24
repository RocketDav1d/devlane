create table todos (
  id serial primary key,
  title text not null unique,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);
