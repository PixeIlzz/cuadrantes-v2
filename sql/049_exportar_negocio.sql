-- =====================================================================
--  049 · Exportar una empresa entera
-- =====================================================================
--  Tres usos, uno de ellos legal:
--
--   1. Antes de borrar una empresa. Hoy "Eliminar" destruye el registro de
--      jornada y no hay vuelta atrás; con esto queda un archivo.
--   2. Cuando un cliente se va. Tiene derecho a llevarse sus datos, y tú
--      sigues obligado a conservar el registro horario cuatro años.
--   3. Como copia de seguridad manual mientras no haya plan con
--      recuperación a un punto en el tiempo.
--
--  NO sustituye a un backup de verdad: esto lo lanzas tú a mano. Lo que
--  hace es que borrar deje de ser irreversible.
--
--  QUÉ NO SALE, a propósito:
--   · kioscos.device_token — es la credencial de la tablet. En un archivo
--     que se guarda en Drive no pinta nada, y quien lo tuviera podría
--     fichar.
--   · workers.pin_hash — hash de credencial, inútil fuera y sensible.
--  SÍ salen NIF y número de la Seguridad Social: sin ellos el registro de
--  jornada no vale como documento legal. El archivo contiene datos
--  personales y hay que guardarlo en consecuencia.
-- =====================================================================

create or replace function public.admin_exportar_negocio(p_business_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  select jsonb_build_object(
    'exportado_en', now(),
    'version', 1,

    'negocio', (select to_jsonb(b) from public.businesses b where b.id = p_business_id),

    'cuentas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'email', u.email, 'rol', m.role, 'alta', m.created_at)), '[]'::jsonb)
                  from public.memberships m
                  join auth.users u on u.id = m.profile_id
                 where m.business_id = p_business_id),

    -- Sin pin_hash ni el contador de intentos
    'equipo', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', w.id, 'nombre', w.name, 'nombre_legal', w.full_name,
                 'nif', w.nif, 'nss', w.nss, 'turnos_semana', w.weekly_shifts,
                 'activo', w.active, 'orden', w.sort_order, 'alta', w.created_at)
                 order by w.sort_order), '[]'::jsonb)
                 from public.workers w where w.business_id = p_business_id),

    'semanas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'inicio', wk.start_date, 'estado', wk.status,
                  'publicada', wk.publish_at, 'visibilidad', wk.visibility,
                  'notas', wk.notes, 'config', wk.config_snapshot,
                  'asignaciones', (select coalesce(jsonb_agg(jsonb_build_object(
                      'dia', a.day_id, 'puesto', a.position_id,
                      'worker_id', a.worker_id, 'todos', a.is_all,
                      'orden', a.sort_order)), '[]'::jsonb)
                      from public.assignments a where a.week_id = wk.id))
                  order by wk.start_date), '[]'::jsonb)
                  from public.weeks wk where wk.business_id = p_business_id),

    'vacaciones', (select coalesce(jsonb_agg(to_jsonb(v2) order by v2.start_date), '[]'::jsonb)
                     from public.vacations v2 where v2.business_id = p_business_id),

    'solicitudes', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
                      from public.requests r where r.business_id = p_business_id),

    'avisos', (select coalesce(jsonb_agg(to_jsonb(an) order by an.created_at), '[]'::jsonb)
                 from public.announcements an where an.business_id = p_business_id),

    'tareas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at), '[]'::jsonb)
                 from public.tasks t where t.business_id = p_business_id),

    -- Sin device_token: es la credencial de la tablet
    'kioscos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'nombre', k.nombre, 'activo', k.activo,
                  'ips_permitidas', k.ips_permitidas, 'alta', k.created_at)), '[]'::jsonb)
                  from public.kioscos k where k.business_id = p_business_id),

    -- El registro de jornada: lo que hay obligación de conservar
    'fichajes', (select coalesce(jsonb_agg(to_jsonb(te) order by te.momento), '[]'::jsonb)
                   from public.time_entries te where te.business_id = p_business_id),

    'auditoria', (select coalesce(jsonb_agg(to_jsonb(ta) order by ta.momento), '[]'::jsonb)
                    from public.time_entry_audit ta where ta.business_id = p_business_id),

    'soporte', (select coalesce(jsonb_agg(jsonb_build_object(
                  'motivo', s.motivo, 'inicio', s.started_at,
                  'fin', coalesce(s.ended_at, s.expires_at)) order by s.started_at), '[]'::jsonb)
                  from public.soporte_sesiones s where s.business_id = p_business_id)
  ) into v;

  return v;
end;
$function$;

revoke execute on function public.admin_exportar_negocio(uuid) from public, anon;
grant  execute on function public.admin_exportar_negocio(uuid) to authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  Desde la consola: botón "Exportar" en cualquier empresa. Se descarga un
--  .json. Ábrelo y confirma que están el equipo, las semanas y los
--  fichajes, y que NO aparecen device_token ni pin_hash:
--
-- select jsonb_pretty(public.admin_exportar_negocio('ID_DEL_NEGOCIO'));
--
--  Y el tamaño, por si algún cliente grande lo hiciera pesado:
--
-- select pg_size_pretty(length(public.admin_exportar_negocio('ID')::text)::bigint);
-- =====================================================================
