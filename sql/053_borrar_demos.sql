-- =====================================================================
--  053 · Borrar las empresas de demostración
-- =====================================================================
--  Se crea una demo por cada cliente al que se le enseña la app, así que
--  se acumulan. Esto las borra todas de golpe.
--
--  A diferencia de admin_eliminar_negocio(), aquí NO se pide el nombre ni
--  se exporta antes: son datos inventados, no hay registro de jornada real
--  que conservar. Por eso solo actúa sobre las que llevan config.demo, y
--  nunca puede tocar una empresa de verdad aunque se llame "demo".
--
--  Requiere la 52.
-- =====================================================================

create or replace function public.admin_borrar_demos()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int; v_nombres text[];
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  select array_agg(b.name) into v_nombres
    from public.businesses b
   where coalesce((b.config->>'demo')::boolean, false);

  with borradas as (
    delete from public.businesses b
     where coalesce((b.config->>'demo')::boolean, false)
    returning 1
  )
  select count(*)::int into v_n from borradas;

  return jsonb_build_object('ok', true, 'borradas', v_n,
                            'nombres', coalesce(to_jsonb(v_nombres), '[]'::jsonb));
end;
$function$;

revoke execute on function public.admin_borrar_demos() from public, anon;
grant  execute on function public.admin_borrar_demos() to authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  Cuáles hay ahora mismo:
-- select name from public.businesses where (config->>'demo')::boolean;
--
--  Y que no se lleva por delante ninguna real: después de borrarlas,
--  las de verdad tienen que seguir todas ahí.
-- select name, coalesce((config->>'demo')::boolean, false) as demo
--   from public.businesses order by demo desc, name;
-- =====================================================================
