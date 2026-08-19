-- =====================================================================
--  052 · Negocio de demostración
-- =====================================================================
--  Un botón en la consola que crea una empresa ficticia con equipo,
--  cuadrante publicado y fichajes de los últimos días. Sirve para enseñar
--  StaffPoint a un cliente sin abrirle los datos reales de tu plantilla,
--  que son de gente que no ha dado permiso para ser el escaparate.
--
--  Se crea a nombre del admin que pulsa, así que aparece en su selector de
--  negocios y entra como en cualquier otro. Queda marcada con
--  config.demo = true para reconocerla, y se borra desde la consola como
--  las demás.
--
--  Requiere la 45 (es_admin) y la 48 (archivado).
-- =====================================================================

create or replace function public.admin_crear_demo(p_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_biz uuid; v_week uuid; v_nombre text;
  v_lunes date := (current_date - ((extract(isodow from current_date)::int - 1)));
  w_ana uuid; w_luis uuid; w_marta uuid; w_javi uuid;
  v_dia date; i int;
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  v_nombre := coalesce(nullif(trim(p_nombre), ''),
                       'Bar Ejemplo · demo ' || to_char(now(), 'DD/MM'));

  -- ---------- El negocio ----------
  -- Puestos y columnas propios, no los del ejemplo de fábrica, para que la
  -- demo se parezca a un bar de verdad. Fichaje ya encendido: es lo que se
  -- quiere enseñar.
  insert into public.businesses (name, config) values (
    v_nombre,
    jsonb_build_object(
      'demo', true,
      'roles', jsonb_build_array(
        jsonb_build_object('id','bar','label','Barra','min',1),
        jsonb_build_object('id','sala','label','Sala','min',2),
        jsonb_build_object('id','coc','label','Cocina','min',1)),
      'days', jsonb_build_array(
        jsonb_build_object('id','lun','label','Lunes','desde','12:00','hasta','17:00'),
        jsonb_build_object('id','mar','label','Martes','desde','12:00','hasta','17:00'),
        jsonb_build_object('id','mie','label','Miércoles','desde','12:00','hasta','17:00'),
        jsonb_build_object('id','jue','label','Jueves','desde','12:00','hasta','17:00'),
        jsonb_build_object('id','vie','label','Viernes','desde','12:00','hasta','17:00'),
        jsonb_build_object('id','vieN','label','Viernes noche','night',true,'desde','20:00','hasta','01:00'),
        jsonb_build_object('id','sab','label','Sábado','desde','12:00','hasta','17:00'),
        jsonb_build_object('id','sabN','label','Sábado noche','night',true,'desde','20:00','hasta','01:00'),
        jsonb_build_object('id','dom','label','Domingo','desde','12:00','hasta','17:00')),
      'publish', jsonb_build_object('tz','Atlantic/Canary','time','18:00','weekday',0),
      'legal', jsonb_build_object('razon_social','Bar Ejemplo S.L.','cif','B00000000'),
      'fichaje', jsonb_build_object(
        'activo', true, 'tz', 'Atlantic/Canary', 'margen_seg', 300,
        'cierre_auto_activo', true, 'cierre_margen_h', 2, 'cierre_max_h', 12)
    )
  ) returning id into v_biz;

  insert into public.memberships (business_id, profile_id, role)
  values (v_biz, auth.uid(), 'manager');

  -- ---------- El equipo ----------
  -- Nombres y NIF claramente inventados: nada de parecerse a nadie real.
  insert into public.workers (business_id, name, full_name, nif, weekly_shifts, sort_order)
  values (v_biz, 'Ana',   'Ana Ejemplo Demo',   '00000001A', 5, 0) returning id into w_ana;
  insert into public.workers (business_id, name, full_name, nif, weekly_shifts, sort_order)
  values (v_biz, 'Luis',  'Luis Ejemplo Demo',  '00000002B', 5, 1) returning id into w_luis;
  insert into public.workers (business_id, name, full_name, nif, weekly_shifts, sort_order)
  values (v_biz, 'Marta', 'Marta Ejemplo Demo', '00000003C', 4, 2) returning id into w_marta;
  insert into public.workers (business_id, name, full_name, nif, weekly_shifts, sort_order)
  values (v_biz, 'Javi',  'Javi Ejemplo Demo',  '00000004D', 3, 3) returning id into w_javi;

  -- ---------- La semana, ya publicada ----------
  insert into public.weeks (business_id, start_date, status, publish_at,
                            visibility, notes, config_snapshot)
  select v_biz, v_lunes, 'published', now() - interval '2 days', 'shown', '{}'::jsonb, b.config
    from public.businesses b where b.id = v_biz
  returning id into v_week;

  insert into public.assignments (week_id, day_id, position_id, worker_id, sort_order) values
    (v_week,'lun','bar',  w_ana,   0), (v_week,'lun','sala', w_luis,  0),
    (v_week,'mar','sala', w_marta, 0), (v_week,'mar','coc',  w_javi,  0),
    (v_week,'mie','bar',  w_luis,  0), (v_week,'mie','sala', w_ana,   0),
    (v_week,'jue','sala', w_marta, 0), (v_week,'jue','coc',  w_javi,  0),
    (v_week,'vie','bar',  w_ana,   0), (v_week,'vie','sala', w_luis,  0),
    (v_week,'vieN','bar', w_marta, 0), (v_week,'vieN','sala', w_javi, 0),
    (v_week,'sab','bar',  w_luis,  0), (v_week,'sab','sala', w_ana,   0),
    (v_week,'sabN','bar', w_javi,  0), (v_week,'sabN','sala', w_marta,0),
    (v_week,'dom','sala', w_ana,   0);

  -- ---------- Vacaciones y una solicitud pendiente ----------
  insert into public.vacations (business_id, worker_id, start_date, end_date, source, note)
  values (v_biz, w_javi, v_lunes + 14, v_lunes + 20, 'manager', 'Vacaciones de ejemplo');

  insert into public.requests (business_id, worker_id, type, status, start_date, end_date, message)
  values (v_biz, w_marta, 'vacation', 'pending', v_lunes + 28, v_lunes + 32,
          'Solicitud de ejemplo, para enseñar cómo se aprueban.');

  insert into public.announcements (business_id, text, pinned)
  values (v_biz, 'Este es el tablón: aquí publicas avisos para todo el equipo.', true);

  insert into public.tasks (business_id, title, detail, repeat_type)
  values (v_biz, 'Revisar cámaras', 'Tarea de ejemplo que se repite cada día', 'daily');

  -- ---------- Fichajes de los últimos días ----------
  -- Jornadas completas de 12:00 a 17:00, con algún minuto de retraso para
  -- que el registro no salga sospechosamente perfecto.
  for i in 1..6 loop
    v_dia := current_date - i;
    insert into public.time_entries (business_id, worker_id, tipo, momento, origen)
    values
      (v_biz, w_ana,  'entrada', (v_dia + time '12:03') at time zone 'Atlantic/Canary', 'kiosco'),
      (v_biz, w_ana,  'salida',  (v_dia + time '17:05') at time zone 'Atlantic/Canary', 'kiosco'),
      (v_biz, w_luis, 'entrada', (v_dia + time '11:58') at time zone 'Atlantic/Canary', 'kiosco'),
      (v_biz, w_luis, 'salida',  (v_dia + time '17:12') at time zone 'Atlantic/Canary', 'kiosco');
    if i % 2 = 0 then
      insert into public.time_entries (business_id, worker_id, tipo, momento, origen)
      values
        (v_biz, w_marta, 'entrada', (v_dia + time '12:15') at time zone 'Atlantic/Canary', 'kiosco'),
        (v_biz, w_marta, 'salida',  (v_dia + time '17:00') at time zone 'Atlantic/Canary', 'kiosco');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_biz, 'nombre', v_nombre);
end;
$function$;

revoke execute on function public.admin_crear_demo(text) from public, anon;
grant  execute on function public.admin_crear_demo(text) to authenticated;


-- ---------------------------------------------------------------------
--  La consola marca las de demo con su etiqueta
-- ---------------------------------------------------------------------
--  Hay que DROP: la función gana una columna y Postgres no deja cambiar el
--  tipo de retorno con create or replace.

drop function if exists public.admin_negocios();

create or replace function public.admin_negocios()
returns table (
  id            uuid,
  nombre        text,
  activo        boolean,
  archivado     boolean,
  demo          boolean,
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
    select b.id, b.name, b.activo, b.archivado,
           coalesce((b.config->>'demo')::boolean, false),
           b.created_at,
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
--  Desde la consola: botón "Crear demo". Luego entra en ella y mira que
--  hay cuadrante publicado, equipo, una solicitud pendiente y registro de
--  jornada con horas.
--
--  Para borrarla, el botón Eliminar de la consola: pedirá el nombre exacto
--  y avisará de los fichajes, igual que con una empresa real.
--
--  Las de demo se reconocen así:
-- select name, config->>'demo' as demo from public.businesses;
-- =====================================================================
