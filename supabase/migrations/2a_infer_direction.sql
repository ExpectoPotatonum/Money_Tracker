-- 2a: direction inference helper (run first)

create or replace function infer_direction(body text)
returns text
language sql
immutable
as $$
  select case
    when body ilike '%transferred%' and body ilike '%to you%' then 'credit'
    when body ilike '%received%' or body ilike '%credited%'
      or body ilike '%credit%' or body ilike '%cashback%'
      or body ilike '%refund%' or body ilike '%deposit%'
      or body ilike '%transferred%' or body ilike '%added%'
      or body ilike '%top-up%' or body ilike '%top up%' then 'credit'
    when body ilike '%debited%' or body ilike '%debit%'
      or body ilike '%paid%' or body ilike '%payment%'
      or body ilike '%charged%' or body ilike '%spent%'
      or body ilike '%purchase%' or body ilike '%deducted%'
      or body ilike '%withdrawn%' or body ilike '%transfer out%'
      or body ilike '%sent%' or body ilike '%from your%' then 'debit'
    else 'debit'
  end;
$$;
