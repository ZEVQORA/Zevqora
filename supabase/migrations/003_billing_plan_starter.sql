-- Adds the Starter tier to the existing billing_plan enum. Kept in its own
-- migration because a new enum value cannot be referenced in the same
-- transaction that creates it.
alter type public.billing_plan add value if not exists 'starter';
