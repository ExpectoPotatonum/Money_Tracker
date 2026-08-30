-- 2b: loose per-currency fallback helper (run after 2a)

create or replace function loose_parse_amount(body text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'amount', m.amount,
    'currency', m.currency,
    'direction', infer_direction(body)
  )
  from (
    select
      (regexp_match(body,
        '(RM|MYR|USD|US\$|\$|CNY|CN¥|¥|SGD|S\$|EUR|€|GBP|£)[[:space:]]*([0-9][0-9,]*\.[0-9][0-9])',
        'i'))[2] as amount,
      case
        when body ~* '(RM|MYR)' then 'MYR'
        when body ~* '(USD|US\$)' then 'USD'
        when body ~* '(CNY|CN¥)' then 'CNY'
        when body ~* 'SGD' then 'SGD'
        when body ~* 'EUR' then 'EUR'
        when body ~* 'GBP' then 'GBP'
        else 'MYR'
      end as currency
    where body ~* '(RM|MYR|USD|US\$|\$|CNY|CN¥|¥|SGD|S\$|EUR|€|GBP|£)[[:space:]]*[0-9][0-9,]*\.[0-9][0-9]'
  ) m
  where m.amount is not null;
$$;
