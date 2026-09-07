-- Credit balances must hold provider-reported micro-costs exactly.
--
-- usage_events.credits_usd and credit_ledger.delta_usd already carry six
-- decimals, but credit_balances (and the ledger's before/after snapshots) were
-- numeric(10,2) / numeric(12,2): a $0.0000054 platform completion rounded to
-- $0.00 on the balance, so sub-cent requests never accumulated against the
-- plan's included credit. Widening the scale is non-destructive; existing
-- values are preserved exactly.

alter table public.credit_balances
  alter column included_usd type numeric(12,6),
  alter column used_usd type numeric(12,6);

alter table public.credit_ledger
  alter column included_before type numeric(12,6),
  alter column included_after type numeric(12,6),
  alter column used_before type numeric(12,6),
  alter column used_after type numeric(12,6);
