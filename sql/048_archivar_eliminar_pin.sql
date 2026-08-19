-- =====================================================================
--  048 · Archivar y eliminar empresas · Reiniciar el PIN de un empleado
-- =====================================================================
--  Requiere la 45, 46 y 47.
--
--  TRES ESTADOS, no dos:
--    activo=true,  archivado=false  → normal
--    activo=false, archivado=false  → SUSPENDIDA (impago). Vuelve sola al
--                                     reactivar. Es temporal.
--    activo=false, archivado=true   → ARCHIVADA. El cliente se fue. Los
--                                     datos se conservan pero sale de la
--                                     lista operativa.
--
--  Se apoya en el `activo` que ya existía en vez de meter un enum, para no
--  volver a tocar is_manager()/is_member(), que son la puerta de casi toda
--  la RLS. Archivada implica activo=false, así que el corte de acceso ya
--  está resuelto y no hay que cambiar nada allí.
-- =====================================================================


alter table public.businesses
  add column if not exists archivado boolean not null default false;

comment on column public.businesses.archivado is
  'true = cliente que se fue. Datos conservados, fuera de la lista operativa. Implica activo=false.';


-- ---------------------------------------------------------------------
--  1. Archivar y desarchivar
-- ---------------------------------------------------------------------

create or replace function public.admin_archivar_negocio(
  p_business_id uuid, p_archivar boolean
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  update public.businesses
     set archivado = p_archivar,
         -- Archivar corta el acceso. Desarchivar NO lo devuelve solo: se
         -- reactiva aparte, a conciencia.
         activo = case when p_archivar then false else activo end
   where id = p_business_id;
end;
$function$;

revoke execute on function public.admin_archivar_negocio(uuid, boolean) from public, anon;
grant  execute on function public.admin_archivar_negocio(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
--  2. Eliminar de verdad
-- ---------------------------------------------------------------------
--  AVISO SERIO: borrar una empresa con fichajes destruye un registro de
--  jornada, que en España hay que conservar CUATRO AÑOS y entregar a
--  inspección. Archivar existe justo para no tener que llegar aquí.
--
--  Por eso pide dos cosas:
--   · el nombre exacto de la empresa, escrito a mano;
--   · y si hay fichajes, además p_forzar := true.
--
--  El borrado arrastra en cascada equipo, semanas, asignaciones,
--  vacaciones, solicitudes, avisos, tareas, kioscos, membresías y
--  fichajes. Las filas de time_entry_audit NO tienen clave ajena y
--  sobreviven: queda el rastro de que aquello existió.

create or replace function public.admin_eliminar_negocio(
  p_business_id uuid, p_confirmacion text, p_forzar boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_nombre text; v_fichajes bigint;
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  select b.name into v_nombre from public.businesses b where b.id = p_business_id;
  if v_nombre is null then
    return jsonb_build_object('ok', false, 'error', 'Esa empresa ya no existe.');
  end if;

  if coalesce(trim(p_confirmacion), '') <> v_nombre then
    return jsonb_build_object('ok', false,
      'error', 'El nombre no coincide. Escribe exactamente: ' || v_nombre);
  end if;

  select count(*) into v_fichajes
    from public.time_entries t where t.business_id = p_business_id;

  if v_fichajes > 0 and not p_forzar then
    return jsonb_build_object('ok', false, 'fichajes', v_fichajes,
      'error', 'Esta empresa tiene ' || v_fichajes || ' fichajes. Son registro de '
            || 'jornada y hay que conservarlo cuatro años. Archívala en vez de '
            || 'borrarla, o confirma que quieres destruirlos.');
  end if;

  delete from public.businesses where id = p_business_id;

  return jsonb_build_object('ok', true, 'nombre', v_nombre, 'fichajes', v_fichajes);
end;
$function$;

revoke execute on function public.admin_eliminar_negocio(uuid, text, boolean) from public, anon;
grant  execute on function public.admin_eliminar_negocio(uuid, text, boolean) to authenticated;


-- ---------------------------------------------------------------------
--  3. Reiniciar el PIN de un trabajador
-- ---------------------------------------------------------------------
--  Faltaba y era un agujero de verdad: el PIN solo lo podía poner el
--  propio empleado con set_mi_pin(), así que quien lo olvidaba se quedaba
--  sin poder fichar en el kiosco y no había forma de recuperarlo.
--
--  No se pone un PIN nuevo desde fuera: se BORRA el que había, y el
--  trabajador elige otro desde su app. Así nadie más llega a conocerlo, ni
--  el gestor ni tú. De paso se levanta el bloqueo por intentos fallidos.
--
--  Lo puede hacer el gestor del negocio — y por tanto también tú en modo
--  soporte, que es como se atenderá esa incidencia.

create or replace function public.resetear_pin(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_biz uuid; v_profile uuid; v_nombre text;
begin
  select w.business_id, w.profile_id, w.name
    into v_biz, v_profile, v_nombre
    from public.workers w where w.id = p_worker_id;

  if v_biz is null then raise exception 'Trabajador no encontrado'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  update public.workers
     set pin_hash = null, pin_intentos = 0, pin_bloqueado_hasta = null
   where id = p_worker_id;

  -- Avisar al trabajador de que tiene que poner uno nuevo
  begin
    perform public.crear_notif(
      v_biz, v_profile, 'pin_reiniciado',
      'Tu PIN se ha reiniciado',
      'Entra en Ajustes y elige un PIN nuevo para poder fichar en el kiosco.',
      'emp-ajustes');
  exception when others then null;
  end;
end;
$function$;

revoke execute on function public.resetear_pin(uuid) from public, anon;
grant  execute on function public.resetear_pin(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  4. La consola necesita saber si está archivada
-- ---------------------------------------------------------------------

drop function if exists public.admin_negocios();

create or replace function public.admin_negocios()
returns table (
  id            uuid,
  nombre        text,
  activo        boolean,
  archivado     boolean,
  alta          timestamptz,
  n_empleados   integer,
  n_gestores    integer,
  n_cuentas     integer,
  ultimo_acceso timestamptz,
  ultimo_fichaje timestamptz,
  fichaje_activo boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  return query
    select b.id, b.name, b.activo, b.archivado, b.created_at,
           (select count(*)::int from public.workers w
             where w.business_id = b.id and w.active),
           (select count(*)::int from public.memberships m
             where m.business_id = b.id and m.role = 'manager'),
           (select count(*)::int from public.memberships m
             where m.business_id = b.id),
           (select max(u.last_sign_in_at) from public.memberships m
              join auth.users u on u.id = m.profile_id
             where m.business_id = b.id),
           (select max(te.momento) from public.time_entries te
             where te.business_id = b.id),
           coalesce((b.config->'fichaje'->>'activo')::boolean, false)
      from public.businesses b
     order by b.archivado, b.activo desc, b.created_at desc;
end;
$function$;

revoke execute on function public.admin_negocios() from public, anon;
grant  execute on function public.admin_negocios() to authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  · Archivar el negocio de pruebas y ver que sale al final de la lista y
--    que su gestor pierde el acceso.
--  · Intentar eliminarlo escribiendo mal el nombre: debe negarse.
--  · Intentarlo con el nombre bien y fichajes dentro: debe pedir forzar.
--  · Reiniciar el PIN de un trabajador y comprobar que en el kiosco pasa a
--    salir sin PIN y que a él le llega el aviso.
-- =====================================================================
