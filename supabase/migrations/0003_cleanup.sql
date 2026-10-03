-- 0002 inlined stock decrements into the create_order transaction, so the
-- standalone helper is dead code. Drop it to avoid two competing writers.
-- Safe to apply any time after 0002.

drop function if exists public.decrement_stock(text, integer);
