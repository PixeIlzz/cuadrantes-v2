-- =====================================================================
--  050 · Respaldo automático fuera de Supabase
-- =====================================================================
--  El plan gratuito NO guarda ninguna copia, y el registro de jornada hay
--  que conservarlo cuatro años. Ni siquiera el plan Pro lo resuelve: son 7
--  días. Esto se ocupa de la parte de archivo, que es la obligación legal.
--
--  Cada semana, un job de pg_cron llama a la Edge Function `respaldo`, que
--  vuelca todas las empresas y las guarda en un repositorio PRIVADO de
--  GitHub, con un archivo por fecha.
--
--  QUÉ NO CUBRE: auth.users. Las cuentas y sus contraseñas viven en el
--  esquema de autenticación y no salen aquí. Si se perdiera el proyecto
--  entero, los datos se recuperan pero cada usuario tendría que
--  restablecer su contraseña. Para eso hace falta el plan Pro (25 $/mes),
--  que sí copia la base completa.
--
--  Requiere la 49 y la 39 (app_config).
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. El volcado, separado del control de acceso
-- ---------------------------------------------------------------------
--  admin_exportar_negocio() comprueba es_admin con auth.uid(), y el cron
--  no tiene sesión: llamarla desde ahí daría siempre "Sin acceso". Se
--  parte en dos, como ya se hizo con turno_previsto/mi_turno_previsto:
--  una función interna sin control, y envoltorios delante con el suyo.

create or replace function public.exportar_negocio_datos(p_business_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'exportado_en', now(),
    'version', 1,
    'negocio', (select to_jsonb(b) from public.businesses b where b.id = p_business_id),
    'cuentas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'email', u.email, 'rol', m.role, 'alta', m.created_at)), '[]'::jsonb)
                  from public.memberships m
                  join auth.users u on u.id = m.profile_id
                 where m.business_id = p_business_id),
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

revoke execute on function public.exportar_negocio_datos(uuid) from public, anon, authenticated;


-- El botón de la consola: mismo volcado, con su control de acceso delante
create or replace function public.admin_exportar_negocio(p_business_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;
  return public.exportar_negocio_datos(p_business_id);
end;
$function$;

revoke execute on function public.admin_exportar_negocio(uuid) from public, anon;
grant  execute on function public.admin_exportar_negocio(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  2. Todas las empresas de una vez, para el respaldo
-- ---------------------------------------------------------------------
--  Solo service_role: la llama la Edge Function, nadie más.

create or replace function public.respaldo_completo()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'generado_en', now(),
    'version', 1,
    'empresas', coalesce(jsonb_agg(public.exportar_negocio_datos(b.id) order by b.created_at), '[]'::jsonb)
  ) into v
  from public.businesses b;

  return v;
end;
$function$;

revoke execute on function public.respaldo_completo() from public, anon, authenticated;
grant  execute on function public.respaldo_completo() to service_role;


-- ---------------------------------------------------------------------
--  3. Disparar el respaldo
-- ---------------------------------------------------------------------
--  Mismo patrón que el push: la URL y el secreto viven en app_config, no
--  escritos en la función (ver migración 39 y por qué).

create or replace function public.lanzar_respaldo()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_url text; v_key text;
begin
  select c.valor into v_url from public.app_config c where c.clave = 'respaldo_url';
  select c.valor into v_key from public.app_config c where c.clave = 'respaldo_key';
  if v_url is null or v_key is null then return; end if;

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('origen', 'cron')
    );
  exception when others then null;
  end;
end;
$function$;

revoke execute on function public.lanzar_respaldo() from public, anon, authenticated;


-- ---------------------------------------------------------------------
--  4. Programarlo: los domingos de madrugada
-- ---------------------------------------------------------------------

select cron.schedule('respaldo-semanal', '0 4 * * 0',
                     'select public.lanzar_respaldo();');


-- =====================================================================
--  PASOS MANUALES · en este orden
-- =====================================================================
--  1. Crea en GitHub un repositorio PRIVADO nuevo, por ejemplo
--     "staffpoint-respaldos".
--
--     ⚠ NO uses cuadrantes-v2. Ese es público porque lo sirve GitHub
--     Pages: subir ahí estos archivos publicaría en internet el NIF y el
--     número de la Seguridad Social de todos los trabajadores.
--
--  2. Crea un token de acceso personal de tipo *fine-grained*, con acceso
--     SOLO a ese repositorio y permiso únicamente de "Contents: Read and
--     write". Nada más.
--
--  3. En Supabase → Edge Functions → Secrets, añade:
--       GITHUB_TOKEN     el token del paso 2
--       GITHUB_REPO      usuario/staffpoint-respaldos
--       RESPALDO_SECRET  otro secreto, para que solo el cron pueda llamar
--                        (genéralo con: select encode(gen_random_bytes(32),'hex'); )
--
--  4. Despliega la Edge Function `respaldo` (edge/respaldo/index.ts), con
--     "Verify JWT" DESACTIVADO, igual que enviar-push.
--
--  5. Guarda aquí la URL y el mismo RESPALDO_SECRET:
--
-- insert into public.app_config (clave, valor) values
--   ('respaldo_url', 'https://TU_PROJECT_REF.supabase.co/functions/v1/respaldo'),
--   ('respaldo_key', 'EL_MISMO_RESPALDO_SECRET')
-- on conflict (clave) do update set valor = excluded.valor, actualizado_at = now();
--
--  6. Pruébalo sin esperar al domingo:
--
-- select public.lanzar_respaldo();
--
--     Y mira en el repositorio que aparece el archivo. Si no, revisa los
--     logs de la Edge Function.
--
--  7. Comprueba los dos jobs:
--
-- select jobname, schedule, active from cron.job order by jobid;
-- =====================================================================
