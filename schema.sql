create table if not exists estimates (
  id bigserial primary key,
  created_at timestamptz not null default now(),

  user_id text null,         -- keep nullable for later "User 1/User 2" login phase
  agent_label text null,     -- free text in v1

  job_type text not null,    -- STANDARD | DUMPSTER_CLEANOUT | DUMPSTER_OVERFLOW
  dumpster_size int null,    -- 2,4,6,8,10 or null

  notes text null,
  photo_count int not null default 0,

  model_name text not null,
  result_text text not null,
  confidence text null       -- parsed from output if available
);

create index if not exists estimates_created_at_idx on estimates (created_at desc);
create index if not exists estimates_job_type_idx on estimates (job_type);
