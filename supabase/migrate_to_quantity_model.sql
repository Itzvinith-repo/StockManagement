-- Run this once in the Supabase SQL Editor for an existing project.
alter table public.items add column if not exists quantity integer not null default 0;
alter table public.items add column if not exists unit_price numeric(12,2) not null default 0;
alter table public.items add column if not exists total_value numeric(14,2) not null default 0;

alter table public.transactions add column if not exists transaction_time timestamptz default now();
alter table public.transactions add column if not exists unit_price numeric(12,2) default 0;
alter table public.transactions add column if not exists total_amount numeric(14,2) default 0;
alter table public.transactions add column if not exists description text default '';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'timestamp'
  ) then
    update public.transactions
    set transaction_time = "timestamp"
    where "timestamp" is not null;
  end if;
end $$;

create index if not exists idx_transactions_transaction_time
  on public.transactions(transaction_time desc);

notify pgrst, 'reload schema';