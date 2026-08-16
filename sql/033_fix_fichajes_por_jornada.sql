-- 033 · Arregla "column reference \"id\" is ambiguous" en fichajes_por_jornada.
--
-- La función declara RETURNS TABLE(id uuid, ...), así que dentro del cuerpo
-- 'id' es una variable de salida. En la primera sentencia se usaba sin
-- cualificar contra workers.id, y Postgres no podía decidir (error 42702).
-- La función abortaba antes de leer un solo fichaje, para cualquier rol.
--
-- Único cambio: alias 'w' en workers y referencias cualificadas.
-- El tipo de retorno no cambia, así que CREATE OR REPLACE basta (sin DROP).

create or replace function public.fichajes_por_jornada(p_worker_id uuid, p_desde date, p_hasta date)
 returns table(id uuid, tipo text, momento timestamp with time zone, estimado boolean, origen text, nota text, dia date)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_biz uuid;
begin
  select w.business_id into v_biz from public.workers w where w.id = p_worker_id;
  if v_biz is null then raise exception 'Trabajador no válido'; end if;

  -- Permiso: el propio trabajador o un gestor del negocio
  if not (
    exists (select 1 from public.workers w
             where w.id = p_worker_id and w.profile_id = auth.uid())
    or public.is_manager(v_biz)
  ) then
    raise exception 'Sin acceso';
  end if;

  return query
  select te.id, te.tipo, te.momento, te.estimado, te.origen, te.nota,
         public.dia_laboral(v_biz, p_worker_id, te.momento) as dia
    from public.time_entries te
   where te.worker_id = p_worker_id
     -- Margen de un día por cada lado: la madrugada puede reasignarse
     and te.momento >= (p_desde - 1)::timestamp
     and te.momento <  (p_hasta + 2)::timestamp
   order by te.momento;
end;
$function$;
