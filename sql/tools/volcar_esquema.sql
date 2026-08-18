-- =====================================================================
-- VOLCADO DEL ESQUEMA  ·  herramienta, NO es una migración
-- =====================================================================
-- Las migraciones 1–32 nunca se guardaron en el repo: el esquema solo
-- existe dentro de Supabase. Esto lo saca a texto para reconstruir un
-- sql/000_baseline.sql versionado.
--
-- CÓMO USARLO
--   1. Abrir el SQL Editor de Supabase.
--   2. Ejecutar UNA consulta cada vez (las de abajo, separadas por ▓▓▓).
--   3. Cada una devuelve UNA sola celda de texto. Click en la celda,
--      copiar entera, y pegarla en el archivo que se indica.
--
-- No modifica nada: todo son SELECT de solo lectura.
-- =====================================================================


-- ▓▓▓ 1 · TABLAS Y COLUMNAS  →  volcado/1-tablas.txt
select string_agg(linea, E'\n' order by tabla, orden) as volcado
from (
  select c.relname as tabla, a.attnum as orden,
         c.relname || ' | ' || a.attname
           || ' | ' || format_type(a.atttypid, a.atttypmod)
           || ' | ' || case when a.attnotnull then 'NOT NULL' else 'null' end
           || ' | ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
           as linea
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r'
     and a.attnum > 0 and not a.attisdropped
) t;


-- ▓▓▓ 2 · CLAVES, CHECKS E ÍNDICES  →  volcado/2-restricciones.txt
select string_agg(linea, E'\n' order by linea) as volcado
from (
  select 'alter table public.' || c.relname
         || ' add constraint ' || con.conname || ' '
         || pg_get_constraintdef(con.oid) || ';' as linea
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union all
  select indexdef || ';' from pg_indexes where schemaname = 'public'
) t;


-- ▓▓▓ 3 · FUNCIONES Y RPC  →  volcado/3-funciones.txt
--     (lo más importante: fichar, turno_previsto, dia_laboral,
--      is_manager, soy_probador, resolve_request, crear_correccion…)
select string_agg(pg_get_functiondef(p.oid) || E';\n', E'\n' order by p.proname) as volcado
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind in ('f', 'p');


-- ▓▓▓ 4 · TRIGGERS  →  volcado/4-triggers.txt
select string_agg(pg_get_triggerdef(t.oid) || ';', E'\n' order by c.relname, t.tgname) as volcado
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal;


-- ▓▓▓ 5 · RLS: estado y políticas  →  volcado/5-rls.txt
select string_agg(linea, E'\n' order by linea) as volcado
from (
  select 'alter table public.' || c.relname || ' enable row level security;' as linea
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  union all
  select 'create policy "' || policyname || '" on public.' || tablename
         || ' as ' || permissive || ' for ' || cmd
         || ' to ' || array_to_string(roles, ', ')
         || coalesce(' using (' || qual || ')', '')
         || coalesce(' with check (' || with_check || ')', '') || ';'
    from pg_policies where schemaname = 'public'
) t;


-- ▓▓▓ 6 · TAREAS PROGRAMADAS (pg_cron)  →  volcado/6-cron.txt
select string_agg(
         'select cron.schedule(' || quote_literal(jobname) || ', '
         || quote_literal(schedule) || ', ' || quote_literal(command) || ');',
         E'\n' order by jobid) as volcado
  from cron.job;
