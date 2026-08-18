-- =====================================================================
--  BASELINE 03 · Funciones y RPC
-- =====================================================================
--  Orden: primero los ayudantes en `language sql`, porque Postgres SÍ
--  analiza su cuerpo al crearlas y fallarían si llamasen a algo que
--  todavía no existe. Las de plpgsql no tienen ese problema.
--
--  Se excluye rls_auto_enable(): es de Supabase, no de la aplicación.
--
--  Los grant/revoke están al final. Léelos: no son opcionales.
-- =====================================================================


-- #####################################################################
--  Ayudantes de permisos — el corazón del multi-tenancy
-- #####################################################################

CREATE OR REPLACE FUNCTION public.is_manager(biz uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.memberships m
    where m.business_id = biz and m.profile_id = auth.uid() and m.role = 'manager'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_member(biz uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.memberships m
    where m.business_id = biz and m.profile_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.my_worker_id(biz uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.id from public.workers w
  where w.business_id = biz and w.profile_id = auth.uid()
  limit 1;
$function$
;

-- Flag de beta: mientras esté en uso, el fichaje solo existe para quien lo tenga
CREATE OR REPLACE FUNCTION public.soy_probador()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select es_probador from public.profiles where id = auth.uid()),
    false);
$function$
;

CREATE OR REPLACE FUNCTION public.quiere_notif(p_profile uuid, p_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select (prefs ->> p_type)::boolean
       from public.notification_prefs where profile_id = p_profile),
    true);   -- si no ha tocado nada, recibe todo
$function$
;


-- #####################################################################
--  Alta de cuentas y negocio
-- #####################################################################

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_business(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;

  insert into public.businesses (name) values (p_name) returning id into v_id;

  insert into public.memberships (business_id, profile_id, role)
  values (v_id, auth.uid(), 'manager');

  return v_id;
end;
$function$
;


-- #####################################################################
--  Invitaciones
-- #####################################################################

CREATE OR REPLACE FUNCTION public.create_invite(p_worker uuid, p_dias integer DEFAULT 30)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_biz  uuid;
  v_code text;
  intentos int := 0;
begin
  select business_id into v_biz from public.workers where id = p_worker;
  if v_biz is null then raise exception 'Trabajador no encontrado'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  -- Un código vivo por trabajador: los anteriores sin usar se retiran
  delete from public.invites where worker_id = p_worker and used_at is null;

  loop
    -- 6 caracteres sin vocales ni caracteres ambiguos (0/O, 1/I)
    v_code := (
      select string_agg(substr('BCDFGHJKMNPQRSTVWXYZ23456789',
                               floor(random()*28)::int + 1, 1), '')
        from generate_series(1,6)
    );
    exit when not exists (select 1 from public.invites where code = v_code);
    intentos := intentos + 1;
    if intentos > 20 then raise exception 'No se pudo generar un código'; end if;
  end loop;

  insert into public.invites (code, business_id, worker_id, expires_at)
  values (v_code, v_biz, p_worker, now() + (p_dias || ' days')::interval);

  return v_code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_invite(p_worker uuid)
 RETURNS TABLE(code text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.code, i.expires_at
    from public.invites i
    join public.workers w on w.id = i.worker_id
   where i.worker_id = p_worker
     and i.used_at is null
     and i.expires_at > now()
     and public.is_manager(w.business_id)
   limit 1;
$function$
;

-- Nombre del trabajador al que pertenece un código: lo mira quien se registra
CREATE OR REPLACE FUNCTION public.invite_owner(p_code text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.name
    from public.invites i
    join public.workers w on w.id = i.worker_id
   where i.code = upper(trim(p_code))
     and i.used_at is null
     and i.expires_at > now()
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.redeem_invite(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv    public.invites%rowtype;
  v_name text;
  g      record;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;

  select * into inv from public.invites
  where code = upper(trim(p_code)) for update;

  if not found then              raise exception 'Código no válido'; end if;
  if inv.used_at is not null then raise exception 'Ese código ya se ha usado'; end if;
  if inv.expires_at < now() then  raise exception 'Ese código ha caducado'; end if;

  insert into public.memberships (business_id, profile_id, role)
  values (inv.business_id, auth.uid(), 'employee')
  on conflict (business_id, profile_id) do nothing;

  update public.workers
     set profile_id = auth.uid()
   where id = inv.worker_id and profile_id is null;

  select name into v_name from public.workers where id = inv.worker_id;
  if v_name is not null then
    update public.profiles set full_name = v_name where id = auth.uid();
  end if;

  update public.invites
     set used_at = now(), used_by = auth.uid()
   where code = inv.code;

  -- Avisar a los gestores de que este empleado ya tiene cuenta activa
  for g in
    select profile_id from public.memberships
     where business_id = inv.business_id and role = 'manager'
  loop
    perform public.crear_notif(
      inv.business_id, g.profile_id, 'employee_joined',
      'Nuevo empleado activo',
      coalesce(v_name, 'Un empleado') || ' ha creado su cuenta y ya puede ver sus turnos.',
      'equipo');
  end loop;

  return inv.business_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unlink_worker(p_worker uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid; v_profile uuid;
begin
  select business_id, profile_id into v_biz, v_profile
    from public.workers where id = p_worker;
  if v_biz is null then raise exception 'Trabajador no encontrado'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  update public.workers set profile_id = null where id = p_worker;

  if v_profile is not null then
    delete from public.memberships
     where business_id = v_biz and profile_id = v_profile and role = 'employee';
  end if;
end;
$function$
;


-- #####################################################################
--  Cuadrante: guardado, publicación y visibilidad
-- #####################################################################

CREATE OR REPLACE FUNCTION public.save_week(p_week_id uuid, p_cells jsonb, p_notes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid;
begin
  select business_id into v_biz from public.weeks where id = p_week_id;
  if v_biz is null then
    raise exception 'Semana no encontrada';
  end if;
  if not public.is_manager(v_biz) then
    raise exception 'Sin permiso para editar esta semana';
  end if;

  delete from public.assignments where week_id = p_week_id;

  insert into public.assignments (week_id, day_id, position_id, worker_id, is_all, sort_order)
  select p_week_id,
         x->>'day',
         x->>'role',
         nullif(x->>'worker','')::uuid,
         coalesce((x->>'all')::boolean, false),
         coalesce((x->>'ord')::int, 0)
    from jsonb_array_elements(coalesce(p_cells, '[]'::jsonb)) as x;

  update public.weeks
     set notes = coalesce(p_notes, '{}'::jsonb),
         updated_at = now()
   where id = p_week_id;
end;
$function$
;

-- El cálculo de la hora de publicación se hace en el servidor para que la
-- zona horaria sea correcta pase lo que pase con el reloj del dispositivo.
CREATE OR REPLACE FUNCTION public.compute_publish_at(p_business uuid, p_start date)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg      jsonb;
  v_wd     int;
  v_time   time;
  v_tz     text;
  v_offset int;
  v_day    date;
begin
  select config->'publish' into cfg from public.businesses where id = p_business;

  v_wd   := coalesce((cfg->>'weekday')::int, 0);          -- 0 = domingo
  v_time := coalesce((cfg->>'time')::time, '18:00'::time);
  v_tz   := coalesce(cfg->>'tz', 'Atlantic/Canary');

  -- Última fecha <= inicio de semana cuyo día de la semana coincide
  v_offset := (extract(dow from p_start)::int - v_wd + 7) % 7;
  v_day    := p_start - v_offset;

  return (v_day + v_time) at time zone v_tz;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.schedule_week(p_week_id uuid, p_manual timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid; v_start date; v_at timestamptz;
begin
  select business_id, start_date into v_biz, v_start
    from public.weeks where id = p_week_id;
  if v_biz is null then raise exception 'Semana no encontrada'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  if p_manual is null then
    v_at := public.compute_publish_at(v_biz, v_start);
  else
    v_at := p_manual;
  end if;

  update public.weeks
     set publish_at = v_at,
         publish_at_manual = (p_manual is not null),
         status = case when v_at <= now() then 'published' else 'scheduled' end,
         updated_at = now()
   where id = p_week_id;

  return v_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_week_now(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid;
begin
  select business_id into v_biz from public.weeks where id = p_week_id;
  if v_biz is null then raise exception 'Semana no encontrada'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  update public.weeks
     set publish_at = now(), publish_at_manual = true,
         status = 'published', updated_at = now()
   where id = p_week_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unpublish_week(p_week_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid;
begin
  select business_id into v_biz from public.weeks where id = p_week_id;
  if v_biz is null then raise exception 'Semana no encontrada'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  update public.weeks
     set publish_at = null, publish_at_manual = false,
         status = 'draft', updated_at = now()
   where id = p_week_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_week_visibility(p_week_id uuid, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid;
begin
  if p_mode not in ('auto','shown','hidden') then
    raise exception 'Modo de visibilidad no válido';
  end if;
  select business_id into v_biz from public.weeks where id = p_week_id;
  if v_biz is null then raise exception 'Semana no encontrada'; end if;
  if not public.is_manager(v_biz) then raise exception 'Sin permiso'; end if;

  update public.weeks
     set visibility = p_mode, updated_at = now()
   where id = p_week_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_week(p_from uuid, p_to uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz_from uuid; v_biz_to uuid;
begin
  select business_id into v_biz_from from public.weeks where id = p_from;
  select business_id into v_biz_to   from public.weeks where id = p_to;
  if v_biz_from is null or v_biz_to is null then raise exception 'Semana no encontrada'; end if;
  if v_biz_from <> v_biz_to then raise exception 'Semanas de negocios distintos'; end if;
  if not public.is_manager(v_biz_to) then raise exception 'Sin permiso'; end if;

  delete from public.assignments where week_id = p_to;

  insert into public.assignments (week_id, day_id, position_id, worker_id, is_all, sort_order)
  select p_to, day_id, position_id, worker_id, is_all, sort_order
    from public.assignments where week_id = p_from;

  update public.weeks
     set notes = (select notes from public.weeks where id = p_from),
         updated_at = now()
   where id = p_to;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_scheduled(p_business uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if not public.is_manager(p_business) then raise exception 'Sin permiso'; end if;

  with actualizadas as (
    update public.weeks w
       set publish_at = public.compute_publish_at(p_business, w.start_date),
           updated_at = now()
     where w.business_id = p_business
       and w.status = 'scheduled'
       and w.publish_at_manual = false
    returning 1
  )
  select count(*) into n from actualizadas;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_weeks_range(p_business uuid, p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if not public.is_manager(p_business) then raise exception 'Sin permiso'; end if;

  with borradas as (
    delete from public.weeks
     where business_id = p_business
       and start_date >= p_from
       and start_date <= p_to
    returning 1
  )
  select count(*) into n from borradas;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.count_weeks_range(p_business uuid, p_from date, p_to date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select count(*)::int from public.weeks
   where business_id = p_business
     and start_date >= p_from and start_date <= p_to
     and public.is_manager(p_business);
$function$
;

CREATE OR REPLACE FUNCTION public.weeks_overlapping(p_business uuid, p_from date, p_to date)
 RETURNS TABLE(start_date date, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select w.start_date, w.status
    from public.weeks w
   where w.business_id = p_business
     and public.is_manager(p_business)
     and w.status in ('scheduled','published')
     and w.start_date <= p_to
     and (w.start_date + 6) >= p_from
   order by w.start_date;
$function$
;


-- #####################################################################
--  Solicitudes
-- #####################################################################

CREATE OR REPLACE FUNCTION public.resolve_request(p_request uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.requests%rowtype;
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if not public.is_manager(r.business_id) then raise exception 'Sin permiso'; end if;
  if r.status <> 'pending' then raise exception 'Esa solicitud ya estaba resuelta'; end if;

  update public.requests
     set status       = case when p_approve then 'approved' else 'denied' end,
         manager_note = nullif(trim(coalesce(p_note, '')), ''),
         resolved_at  = now(),
         resolved_by  = auth.uid()
   where id = p_request;

  -- Solo las vacaciones aprobadas se reflejan solas: sus fechas son datos
  -- estructurados. Los cambios de turno se aprueban y el gestor mueve los
  -- chips a mano (decisión de diseño acordada).
  if p_approve and r.type = 'vacation' and r.start_date is not null then
    insert into public.vacations
      (business_id, worker_id, start_date, end_date, source, request_id, note)
    values
      (r.business_id, r.worker_id, r.start_date,
       coalesce(r.end_date, r.start_date), 'request', r.id, r.message);
  end if;
end;
$function$
;


-- #####################################################################
--  Notificaciones
-- #####################################################################

CREATE OR REPLACE FUNCTION public.crear_notif(p_business uuid, p_profile uuid, p_type text, p_title text, p_body text, p_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_profile is null then return; end if;
  if not public.quiere_notif(p_profile, p_type) then return; end if;
  insert into public.notifications (business_id, profile_id, type, title, body, link_tab)
  values (p_business, p_profile, p_type, p_title, p_body, p_link);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.avisar_gestores(p_business_id uuid, p_type text, p_title text, p_body text, p_link_tab text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notifications (profile_id, business_id, type, title, body, link_tab)
  select m.profile_id, p_business_id, p_type, p_title, p_body, p_link_tab
    from public.memberships m
   where m.business_id = p_business_id
     and m.role = 'manager'
     and m.profile_id is not null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.avisar_cambio_semana(p_week_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_biz    uuid;
  v_inicio date;
  e        record;
  v_cuenta integer := 0;
begin
  -- Comprobar que quien llama es gestor del negocio de esa semana
  select business_id, start_date into v_biz, v_inicio
    from public.weeks where id = p_week_id;
  if v_biz is null then
    raise exception 'Semana no encontrada';
  end if;

  if not exists (
    select 1 from public.memberships
     where business_id = v_biz and profile_id = auth.uid() and role = 'manager'
  ) then
    raise exception 'Solo un gestor puede avisar de cambios';
  end if;

  for e in
    select w.profile_id from public.workers w
     where w.business_id = v_biz and w.profile_id is not null and w.active
  loop
    perform public.crear_notif(
      v_biz, e.profile_id, 'week_changed',
      'Cambio en el cuadrante',
      'Se ha modificado la semana del ' || to_char(v_inicio, 'DD/MM')
        || '. Revisa tus turnos.',
      'emp-turnos');
    v_cuenta := v_cuenta + 1;
  end loop;

  return v_cuenta;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guardar_push(p_endpoint text, p_p256dh text, p_auth text, p_ua text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_ua)
  on conflict (endpoint) do update
    set profile_id = auth.uid(), p256dh = excluded.p256dh,
        auth = excluded.auth, user_agent = excluded.user_agent;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.borrar_push(p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.push_subscriptions
   where endpoint = p_endpoint and profile_id = auth.uid();
end;
$function$
;


-- #####################################################################
--  Fichaje: turno previsto y día laboral
-- #####################################################################

-- Tramos previstos de una persona un día concreto, sacados del cuadrante
-- publicado, con respaldo al horario general del negocio.
-- Las vacaciones anulan el turno: devuelve [] sin mirar nada más.
CREATE OR REPLACE FUNCTION public.turno_previsto(p_business_id uuid, p_worker_id uuid, p_dia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg jsonb; v_dias jsonb; v_semana record; v_idx int;
  v_tramos jsonb := '[]'::jsonb; v_col jsonb; v_id text;
  DIAS constant text[] := array['lun','mar','mie','jue','vie','sab','dom'];
begin
  -- De vacaciones ese día: no hay turno previsto, punto.
  if exists (
    select 1 from public.vacations v
     where v.worker_id = p_worker_id
       and p_dia between v.start_date and v.end_date
  ) then
    return '[]'::jsonb;
  end if;

  select config into v_cfg from public.businesses where id = p_business_id;
  v_dias := coalesce(v_cfg->'days', '[]'::jsonb);

  select w.id, w.start_date, coalesce(w.config_snapshot->'days', v_dias) as days
    into v_semana
    from public.weeks w
   where w.business_id = p_business_id
     and w.status = 'published'
     and p_dia between w.start_date and (w.start_date + 6)
   order by w.start_date desc limit 1;

  if found then
    v_idx := (p_dia - v_semana.start_date);

    for v_col in
      select d
        from jsonb_array_elements(v_semana.days) d
       where exists (
         select 1 from public.assignments a
          where a.week_id = v_semana.id
            and a.day_id = (d->>'id')
            and (a.worker_id = p_worker_id or a.is_all = true)
       )
    loop
      v_id := v_col->>'id';
      if v_idx = (
        select ord - 1 from (
          select row_number() over () as ord, dd->>'id' as did
            from jsonb_array_elements(v_semana.days) dd
           where coalesce((dd->>'night')::boolean, false) = false
        ) base where base.did = regexp_replace(v_id, 'N$', '')
      ) then
        if coalesce(v_col->>'desde','') <> '' and coalesce(v_col->>'hasta','') <> '' then
          v_tramos := v_tramos || jsonb_build_array(
            jsonb_build_object('desde', v_col->>'desde', 'hasta', v_col->>'hasta'));
        end if;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_tramos) = 0 then
    v_tramos := coalesce(
      v_cfg->'fichaje'->'horarios'->DIAS[extract(isodow from p_dia)::int],
      '[]'::jsonb);
  end if;

  return v_tramos;
end;
$function$
;

-- ¿Trabaja hoy? Misma lógica de columnas que turno_previsto, pero sin mirar
-- horas: sirve para no avisar a quien no tiene turno ni está de vacaciones.
CREATE OR REPLACE FUNCTION public.tiene_turno_hoy(p_business_id uuid, p_worker_id uuid, p_dia date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_semana record; v_idx int; v_col jsonb; v_id text;
begin
  if exists (select 1 from public.vacations v
              where v.worker_id = p_worker_id
                and p_dia between v.start_date and v.end_date) then
    return false;
  end if;

  select w.id, w.start_date, w.config_snapshot->'days' as days
    into v_semana
    from public.weeks w
   where w.business_id = p_business_id
     and w.status = 'published'
     and p_dia between w.start_date and (w.start_date + 6)
   order by w.start_date desc limit 1;
  if not found then return false; end if;

  v_idx := (p_dia - v_semana.start_date);

  for v_col in
    select d from jsonb_array_elements(coalesce(v_semana.days, '[]'::jsonb)) d
     where exists (
       select 1 from public.assignments a
        where a.week_id = v_semana.id
          and a.day_id = (d->>'id')
          and (a.worker_id = p_worker_id or a.is_all = true))
  loop
    v_id := v_col->>'id';
    if v_idx = (
      select ord - 1 from (
        select row_number() over () as ord, dd->>'id' as did
          from jsonb_array_elements(coalesce(v_semana.days, '[]'::jsonb)) dd
         where coalesce((dd->>'night')::boolean, false) = false
      ) base where base.did = regexp_replace(v_id, 'N$', '')
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$function$
;

-- Jornada nocturna: los fichajes de madrugada se atribuyen al día anterior
-- si ese día tenía un turno que cruza medianoche.
CREATE OR REPLACE FUNCTION public.dia_laboral(p_business_id uuid, p_worker_id uuid, p_momento timestamp with time zone)
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text; v_corte numeric; v_local timestamp;
  v_dia date; v_hora numeric; t jsonb;
begin
  select coalesce(nullif(config->'fichaje'->>'tz',''), 'Atlantic/Canary'),
         coalesce(nullif(config->'fichaje'->>'corte_madrugada_h','')::numeric, 6)
    into v_tz, v_corte
    from public.businesses where id = p_business_id;

  v_local := p_momento at time zone v_tz;
  v_dia   := v_local::date;
  v_hora  := extract(hour from v_local) + extract(minute from v_local) / 60.0;

  -- Solo puede pertenecer al día anterior si es de madrugada
  if v_hora >= v_corte then return v_dia; end if;

  -- ¿El día anterior tenía un turno que cruza medianoche?
  for t in select jsonb_array_elements(
             public.turno_previsto(p_business_id, p_worker_id, v_dia - 1))
  loop
    if coalesce(t->>'desde','') ~ '^\d{1,2}:\d{2}$'
       and coalesce(t->>'hasta','') ~ '^\d{1,2}:\d{2}$' then
      -- Cruza medianoche cuando la hora final es menor que la inicial
      if (t->>'hasta')::time < (t->>'desde')::time then
        -- Dentro del turno (con 2 h de margen para salidas tardías)
        if v_hora <= extract(hour from (t->>'hasta')::time)
                     + extract(minute from (t->>'hasta')::time) / 60.0 + 2 then
          return v_dia - 1;
        end if;
      end if;
    end if;
  end loop;

  return v_dia;
end;
$function$
;


-- #####################################################################
--  Fichaje: fichar
-- #####################################################################

-- OJO (ver CLAUDE.md, apartado 8): esta función lleva la zona horaria
-- escrita a fuego y busca la ficha sin filtrar por negocio. Las dos cosas
-- rompen en cuanto haya un segundo negocio.
CREATE OR REPLACE FUNCTION public.fichar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prof  uuid := auth.uid();
  v_worker uuid;
  v_biz   uuid;
  v_ultimo text;
  v_tipo  text;
  v_id    uuid;
begin
  if not soy_probador() then
    raise exception 'El fichaje aún no está disponible.';
  end if;

  -- Ficha del trabajador vinculada a este perfil
  select w.id, w.business_id into v_worker, v_biz
    from public.workers w
   where w.profile_id = v_prof
   limit 1;
  if v_worker is null then
    raise exception 'Tu cuenta no está vinculada a una ficha de trabajador.';
  end if;

  -- Último fichaje de hoy (por hora del servidor, zona Canarias)
  select tipo into v_ultimo
    from public.time_entries
   where worker_id = v_worker
     and (momento at time zone 'Atlantic/Canary')::date
       = (now() at time zone 'Atlantic/Canary')::date
   order by momento desc
   limit 1;

  -- Si el último fue entrada, ahora toca salida; si no, entrada
  v_tipo := case when v_ultimo = 'entrada' then 'salida' else 'entrada' end;

  insert into public.time_entries(business_id, worker_id, profile_id, tipo, origen)
  values (v_biz, v_worker, v_prof, v_tipo, 'empleado')
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'tipo', v_tipo, 'momento', now());
end;
$function$
;

-- Alterna entrada/salida de un worker YA validado. Solo la Edge Function.
CREATE OR REPLACE FUNCTION public.fichar_worker(p_business_id uuid, p_worker_id uuid, p_origen text DEFAULT 'kiosco'::text, p_kiosco_id uuid DEFAULT NULL::uuid, p_ip text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_profile uuid; v_ultimo text; v_tipo text; v_momento timestamptz;
begin
  -- Coherencia worker <-> negocio (y de paso saco su profile si lo tiene).
  select profile_id into v_profile from public.workers
   where id = p_worker_id and business_id = p_business_id;
  if not found then raise exception 'Trabajador no válido'; end if;

  -- Último fichaje del trabajador (sin filtrar por día: soporta turnos
  -- que cruzan medianoche; los olvidos los cierra el cierre automático).
  select tipo into v_ultimo from public.time_entries
   where worker_id = p_worker_id
   order by momento desc limit 1;

  v_tipo := case when v_ultimo = 'entrada' then 'salida' else 'entrada' end;

  insert into public.time_entries
    (business_id, worker_id, profile_id, tipo, origen, kiosco_id, ip, nota)
  values
    (p_business_id, p_worker_id, v_profile, v_tipo, p_origen, p_kiosco_id, p_ip, p_nota)
  returning momento into v_momento;

  return jsonb_build_object('tipo', v_tipo, 'momento', v_momento);
end;
$function$
;


-- #####################################################################
--  Fichaje: kiosco
-- #####################################################################

CREATE OR REPLACE FUNCTION public.vincular_kiosco(p_nonce text, p_business_id uuid, p_nombre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if not public.is_manager(p_business_id) then
    raise exception 'No eres gestor de ese negocio';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Ponle un nombre al kiosko';
  end if;
  if p_nonce !~ '^[a-f0-9]{16,64}$' then
    raise exception 'Código de emparejamiento no válido';
  end if;

  insert into public.kioscos (business_id, nombre, pairing_nonce, pairing_nonce_at)
  values (p_business_id, trim(p_nombre), p_nonce, now());
end;
$function$
;

-- La tablet recoge su token UNA sola vez y el nonce se borra
CREATE OR REPLACE FUNCTION public.reclamar_token(p_nonce text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_token text;
begin
  update public.kioscos
     set pairing_nonce = null, pairing_nonce_at = null
   where pairing_nonce = p_nonce
     and pairing_nonce_at > now() - interval '10 minutes'
  returning device_token into v_token;

  return v_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_mi_pin(p_business_id uuid, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_worker uuid;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'El PIN debe tener entre 4 y 6 dígitos';
  end if;

  select id into v_worker from public.workers
   where business_id = p_business_id and profile_id = auth.uid();
  if v_worker is null then raise exception 'No tienes ficha en este negocio'; end if;

  update public.workers
     set pin_hash = crypt(p_pin, gen_salt('bf'))
   where id = v_worker;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tengo_pin(p_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pin_hash is not null from public.workers
   where business_id = p_business_id and profile_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.kiosco_equipo(p_device_token text)
 RETURNS TABLE(worker_id uuid, name text, tiene_pin boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid;
begin
  select business_id into v_biz from public.kioscos
   where device_token = p_device_token and activo = true;
  if v_biz is null then raise exception 'KIOSCO_INVALIDO'; end if;

  return query
    select w.id, w.name, (w.pin_hash is not null)
      from public.workers w
     where w.business_id = v_biz and w.active = true
     order by w.sort_order, w.name;
end;
$function$
;

-- Los errores viajan como DATO (jsonb), no como excepción: una excepción
-- revierte la transacción y se perdería el contador de intentos de PIN.
CREATE OR REPLACE FUNCTION public.fichar_kiosco(p_device_token text, p_worker_id uuid, p_pin text, p_ip text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_kiosco public.kioscos%rowtype;
  v_hash text; v_bloqueo timestamptz; v_intentos int;
  MAX_INTENTOS constant int := 5;
  ESPERA constant interval := interval '5 minutes';
begin
  select * into v_kiosco from public.kioscos
   where device_token = p_device_token and activo = true;
  if not found then return jsonb_build_object('error', 'KIOSCO_INVALIDO'); end if;

  if v_kiosco.ips_permitidas is not null
     and array_length(v_kiosco.ips_permitidas, 1) is not null
     and (p_ip is null or not (p_ip = any (v_kiosco.ips_permitidas))) then
    return jsonb_build_object('error', 'IP_NO_PERMITIDA');
  end if;

  select pin_hash, pin_bloqueado_hasta, pin_intentos
    into v_hash, v_bloqueo, v_intentos
   from public.workers
   where id = p_worker_id and business_id = v_kiosco.business_id and active = true;
  if v_hash is null then return jsonb_build_object('error', 'SIN_PIN'); end if;

  -- ¿Bloqueado ahora mismo?
  if v_bloqueo is not null and v_bloqueo > now() then
    return jsonb_build_object('error', 'BLOQUEADO');
  end if;

  -- PIN incorrecto: suma intento (se guarda, ya no revertimos) y bloquea si toca
  if crypt(p_pin, v_hash) <> v_hash then
    v_intentos := coalesce(v_intentos, 0) + 1;
    if v_intentos >= MAX_INTENTOS then
      update public.workers set pin_intentos = 0, pin_bloqueado_hasta = now() + ESPERA
       where id = p_worker_id;
    else
      update public.workers set pin_intentos = v_intentos where id = p_worker_id;
    end if;
    return jsonb_build_object('error', 'PIN_INCORRECTO');
  end if;

  -- Acierto: resetea contador y bloqueo, y ficha
  update public.workers set pin_intentos = 0, pin_bloqueado_hasta = null
   where id = p_worker_id;

  return public.fichar_worker(
    v_kiosco.business_id, p_worker_id, 'kiosco', v_kiosco.id, p_ip, null
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.kiosco_estado(p_device_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_biz uuid; v_workers jsonb; v_margen numeric; v_tz text; v_hoy date;
begin
  select business_id into v_biz from public.kioscos
   where device_token = p_device_token and activo = true;
  if v_biz is null then raise exception 'KIOSCO_INVALIDO'; end if;

  select coalesce(nullif(config->'fichaje'->>'margen_seg','')::numeric, 300),
         coalesce(nullif(config->'fichaje'->>'tz',''), 'Atlantic/Canary')
    into v_margen, v_tz
    from public.businesses where id = v_biz;
  v_hoy := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(x order by srt, nm), '[]'::jsonb) into v_workers
  from (
    select w.sort_order as srt, w.name as nm,
      jsonb_build_object(
        'worker_id', w.id,
        'name', w.name,
        'tiene_pin', (w.pin_hash is not null),
        'dentro', (ult.tipo = 'entrada'),
        'desde', case when ult.tipo = 'entrada' then ult.momento else null end,
        'tramos', public.turno_previsto(v_biz, w.id, v_hoy),
        'seg_hoy', coalesce(hoy.seg, 0)
      ) as x
    from public.workers w
    left join lateral (
      select te.tipo, te.momento from public.time_entries te
       where te.worker_id = w.id
       order by te.momento desc limit 1
    ) ult on true
    left join lateral (
      select sum(extract(epoch from (
               coalesce(case when p.sig_tipo = 'salida' then p.sig end, now()) - p.momento))) as seg
        from (
          select te.tipo, te.momento,
                 lead(te.momento) over (order by te.momento) as sig,
                 lead(te.tipo)    over (order by te.momento) as sig_tipo
            from public.time_entries te
           where te.worker_id = w.id
        ) p
       where p.tipo = 'entrada'
         and (p.momento at time zone v_tz)::date = v_hoy
    ) hoy on true
    where w.business_id = v_biz and w.active = true
  ) sub;

  return jsonb_build_object('workers', v_workers, 'margen_seg', v_margen,
                            'horarios', '{}'::jsonb);
end;
$function$
;


-- #####################################################################
--  Fichaje: consulta y registro
-- #####################################################################

-- OJO (migración 33): la función declara una columna de salida 'id', así que
-- cualquier 'id' sin alias dentro del cuerpo es ambiguo y la aborta entera
-- (error 42702). Cualificar SIEMPRE con alias de tabla.
CREATE OR REPLACE FUNCTION public.fichajes_por_jornada(p_worker_id uuid, p_desde date, p_hasta date)
 RETURNS TABLE(id uuid, tipo text, momento timestamp with time zone, estimado boolean, origen text, nota text, dia date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.jornada_hoy(p_business_id uuid)
 RETURNS TABLE(worker_id uuid, name text, dentro boolean, desde timestamp with time zone, seg_hoy numeric, tramos jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tz text; v_hoy date;
begin
  if not public.is_manager(p_business_id) then
    raise exception 'Sin acceso';
  end if;

  select coalesce(nullif(config->'fichaje'->>'tz',''), 'Atlantic/Canary')
    into v_tz from public.businesses where id = p_business_id;
  v_hoy := (now() at time zone v_tz)::date;

  return query
  with ult as (
    select distinct on (te.worker_id) te.worker_id, te.tipo, te.momento
      from public.time_entries te
     where te.business_id = p_business_id
     order by te.worker_id, te.momento desc
  ),
  pares as (
    select te.worker_id, te.tipo, te.momento,
           lead(te.momento) over (partition by te.worker_id order by te.momento) as sig,
           lead(te.tipo)    over (partition by te.worker_id order by te.momento) as sig_tipo
      from public.time_entries te
     where te.business_id = p_business_id
  ),
  sesiones as (
    select p.worker_id,
           extract(epoch from (
             coalesce(case when p.sig_tipo = 'salida' then p.sig end, now()) - p.momento
           )) as seg
      from pares p
     where p.tipo = 'entrada'
       and (p.momento at time zone v_tz)::date = v_hoy
  )
  select w.id, w.name,
         coalesce(u.tipo = 'entrada', false),
         case when u.tipo = 'entrada' then u.momento end,
         coalesce((select sum(s.seg) from sesiones s where s.worker_id = w.id), 0)::numeric,
         public.turno_previsto(p_business_id, w.id, v_hoy)
    from public.workers w
    left join ult u on u.worker_id = w.id
   where w.business_id = p_business_id and w.active = true
   order by w.sort_order, w.name;
end;
$function$
;


-- #####################################################################
--  Fichaje: correcciones propuestas por el empleado
-- #####################################################################

-- Van por RPC propia y no por crearSolicitud: corregir el propio registro de
-- jornada es un derecho del trabajador y no depende de solicitudes_activas.
CREATE OR REPLACE FUNCTION public.crear_correccion(p_business_id uuid, p_dia date, p_accion text, p_tipo text, p_momento_local text, p_motivo text, p_entry_id uuid DEFAULT NULL::uuid, p_momento_fin_local text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_worker uuid; v_nombre text; v_tz text;
  v_momento timestamptz; v_fin timestamptz;
  v_req uuid;
begin
  -- ¿Quién es? Su ficha en ESTE negocio (un mismo perfil puede estar en varios)
  select w.id, coalesce(nullif(w.full_name, ''), w.name)
    into v_worker, v_nombre
    from public.workers w
   where w.business_id = p_business_id
     and w.profile_id = auth.uid()
     and w.active
   limit 1;

  if v_worker is null then
    return jsonb_build_object('ok', false,
      'error', 'Tu cuenta no está enlazada a una ficha de trabajador.');
  end if;

  if p_accion not in ('editar', 'anadir', 'borrar', 'jornada') then
    return jsonb_build_object('ok', false, 'error', 'Acción no válida.');
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Explica el motivo de la corrección.');
  end if;

  -- Sobre un fichaje concreto: tiene que ser suyo
  if p_accion in ('editar', 'borrar') then
    if p_entry_id is null then
      return jsonb_build_object('ok', false, 'error', 'Falta indicar el fichaje.');
    end if;
    if not exists (select 1 from public.time_entries te
                    where te.id = p_entry_id and te.worker_id = v_worker) then
      return jsonb_build_object('ok', false, 'error', 'Ese fichaje no es tuyo.');
    end if;
  end if;

  -- Horas propuestas, interpretadas en la zona del negocio
  if p_accion in ('editar', 'anadir', 'jornada') then
    if coalesce(p_momento_local, '') = '' then
      return jsonb_build_object('ok', false, 'error', 'Falta la hora propuesta.');
    end if;
    if p_accion = 'anadir' and p_tipo not in ('entrada', 'salida') then
      return jsonb_build_object('ok', false, 'error', 'Indica si falta la entrada o la salida.');
    end if;
    if p_accion = 'jornada' and coalesce(p_momento_fin_local, '') = '' then
      return jsonb_build_object('ok', false, 'error', 'Falta la hora de salida.');
    end if;

    select coalesce(nullif(b.config->'fichaje'->>'tz', ''), 'Atlantic/Canary')
      into v_tz
      from public.businesses b where b.id = p_business_id;

    begin
      v_momento := (replace(p_momento_local, 'T', ' '))::timestamp at time zone v_tz;
      if p_accion = 'jornada' then
        v_fin := (replace(p_momento_fin_local, 'T', ' '))::timestamp at time zone v_tz;
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'La fecha y hora no son válidas.');
    end;

    if v_momento > now() + interval '1 hour'
       or (v_fin is not null and v_fin > now() + interval '1 hour') then
      return jsonb_build_object('ok', false, 'error', 'No puedes proponer una hora futura.');
    end if;
    if v_fin is not null and v_fin <= v_momento then
      return jsonb_build_object('ok', false, 'error', 'La salida tiene que ser posterior a la entrada.');
    end if;
  end if;

  -- Una pendiente por fichaje (o por día, si es un día entero que falta)
  if exists (
    select 1 from public.requests r
     where r.worker_id = v_worker
       and r.type = 'timefix'
       and r.status = 'pending'
       and ( (p_entry_id is not null and r.entry_id = p_entry_id)
          or (p_entry_id is null and r.entry_id is null and r.start_date = p_dia) )
  ) then
    return jsonb_build_object('ok', false,
      'error', 'Ya tienes una corrección pendiente para eso. Espera a que la revisen.');
  end if;

  insert into public.requests
    (business_id, worker_id, type, status, start_date, end_date, message, entry_id, fix)
  values
    (p_business_id, v_worker, 'timefix', 'pending', p_dia, p_dia, trim(p_motivo), p_entry_id,
     jsonb_build_object('accion', p_accion, 'tipo', p_tipo,
                        'momento', v_momento, 'momento_fin', v_fin))
  returning requests.id into v_req;

  -- Aviso al gestor. Si algo falla aquí, la corrección ya está guardada: no se
  -- pierde por un problema de notificaciones.
  begin
    perform public.avisar_gestores(
      p_business_id,
      'request_new',
      'Corrección de fichaje',
      v_nombre || ' pide corregir su registro del '
        || to_char(p_dia, 'DD/MM') || '.',
      'solicitudes');
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'id', v_req);
end;
$function$
;

-- Aislada de resolve_request a propósito: las vacaciones no se tocan.
-- Al aprobar, el fichaje se escribe con origen 'gestor' Y request_id, para que
-- time_entry_audit recoja por trigger quién pidió el cambio y por qué.
CREATE OR REPLACE FUNCTION public.resolve_timefix(p_request uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.requests%rowtype;
  v_profile uuid;
  v_nota text;
  v_cuerpo text;
begin
  select req.* into r
    from public.requests req
   where req.id = p_request and req.type = 'timefix';

  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'Esa corrección ya no existe.');
  end if;
  if not public.is_manager(r.business_id) then
    return jsonb_build_object('ok', false, 'error', 'Sin acceso.');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'Esa corrección ya estaba resuelta.');
  end if;

  v_nota := coalesce(nullif(trim(p_note), ''), 'Corrección aprobada a petición del trabajador');

  select w.profile_id into v_profile
    from public.workers w where w.id = r.worker_id;

  if p_approve then
    if r.fix->>'accion' = 'editar' then
      if r.entry_id is null then
        return jsonb_build_object('ok', false, 'error', 'El fichaje ya no existe.');
      end if;
      update public.time_entries te
         set momento    = (r.fix->>'momento')::timestamptz,
             origen     = 'gestor',
             nota       = v_nota,
             request_id = r.id
       where te.id = r.entry_id;

    elsif r.fix->>'accion' = 'anadir' then
      insert into public.time_entries
        (business_id, worker_id, profile_id, tipo, momento, origen, nota, request_id)
      values
        (r.business_id, r.worker_id, v_profile, r.fix->>'tipo',
         (r.fix->>'momento')::timestamptz, 'gestor', v_nota, r.id);

    elsif r.fix->>'accion' = 'jornada' then
      -- Día entero sin fichar: entrada y salida en una sola aprobación
      insert into public.time_entries
        (business_id, worker_id, profile_id, tipo, momento, origen, nota, request_id)
      values
        (r.business_id, r.worker_id, v_profile, 'entrada',
         (r.fix->>'momento')::timestamptz, 'gestor', v_nota, r.id),
        (r.business_id, r.worker_id, v_profile, 'salida',
         (r.fix->>'momento_fin')::timestamptz, 'gestor', v_nota, r.id);

    elsif r.fix->>'accion' = 'borrar' then
      if r.entry_id is null then
        return jsonb_build_object('ok', false, 'error', 'El fichaje ya no existe.');
      end if;
      -- El borrado queda en time_entry_audit por el trigger
      delete from public.time_entries te where te.id = r.entry_id;
    end if;
  end if;

  update public.requests req
     set status       = case when p_approve then 'approved' else 'denied' end,
         manager_note = nullif(trim(p_note), ''),
         resolved_at  = now()
   where req.id = p_request;

  -- Aviso al trabajador. Va a 'emp-fichaje' (Mi registro) y no a las solicitudes:
  -- esa pestaña puede estar oculta si el gestor apagó las solicitudes.
  if v_profile is not null then
    begin
      v_cuerpo := 'Tu corrección del ' || to_char(r.start_date, 'DD/MM') || ' ha sido '
        || case when p_approve then 'aprobada' else 'denegada' end || '.'
        || coalesce(' ' || nullif(trim(p_note), ''), '');

      insert into public.notifications (profile_id, business_id, type, title, body, link_tab)
      values (v_profile, r.business_id, 'request_resolved',
              'Corrección de fichaje', v_cuerpo, 'emp-fichaje');
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;


-- #####################################################################
--  Fichaje: recordatorios (lo llama pg_cron cada 5 minutos)
-- #####################################################################

CREATE OR REPLACE FUNCTION public.recordatorios_fichaje()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_total int := 0; r record; t jsonb;
  v_tz text; v_hoy date; v_ahora timestamptz := now();
begin
  -- 1) Salida no fichada (a quien tenga la jornada abierta, sin más filtro)
  for r in
    with ult as (
      select distinct on (te.worker_id)
             te.id, te.worker_id, te.business_id, te.tipo, te.momento
        from public.time_entries te
       order by te.worker_id, te.momento desc
    )
    select u.id as entry_id, u.business_id, u.momento, w.profile_id,
           coalesce(
             nullif(b.config->'fichaje'->>'recordar_salida_seg','')::numeric,
             nullif(b.config->'fichaje'->>'recordar_h','')::numeric * 3600,
             9 * 3600
           ) as seg
      from ult u
      join public.workers w on w.id = u.worker_id and w.active = true and w.profile_id is not null
      join public.businesses b on b.id = u.business_id
     where u.tipo = 'entrada'
       and not exists (select 1 from public.fichaje_recordatorios fr where fr.entry_id = u.id)
  loop
    if r.seg > 0 and r.momento < v_ahora - make_interval(secs => r.seg::int) then
      if coalesce((select prefs->>'fichaje_recordatorio' from public.notification_prefs
                    where profile_id = r.profile_id), 'true') <> 'false' then
        insert into public.notifications (business_id, profile_id, type, title, body, link_tab)
        values (r.business_id, r.profile_id, 'fichaje_recordatorio',
                'Recuerda fichar la salida',
                'Sigues con la jornada abierta. Ficha la salida en el kiosco al terminar.',
                'emp-fichaje');
        v_total := v_total + 1;
      end if;
      insert into public.fichaje_recordatorios (entry_id) values (r.entry_id) on conflict do nothing;
    end if;
  end loop;

  -- 2) Entrada no fichada: SOLO a quien trabaja hoy y no está de vacaciones
  for r in
    select w.id as worker_id, w.profile_id, b.id as business_id,
           coalesce(nullif(b.config->'fichaje'->>'recordar_entrada_seg','')::numeric, 0) as seg,
           coalesce(nullif(b.config->'fichaje'->>'tz',''), 'Atlantic/Canary') as tz
      from public.workers w
      join public.businesses b on b.id = w.business_id
     where w.active = true and w.profile_id is not null
  loop
    continue when r.seg <= 0;
    v_tz := r.tz;
    v_hoy := (v_ahora at time zone v_tz)::date;

    continue when not public.tiene_turno_hoy(r.business_id, r.worker_id, v_hoy);
    continue when exists (select 1 from public.fichaje_avisos_entrada a
                           where a.worker_id = r.worker_id and a.dia = v_hoy);
    continue when exists (
      select 1 from public.time_entries te
       where te.worker_id = r.worker_id and te.tipo = 'entrada'
         and (te.momento at time zone v_tz)::date = v_hoy);

    for t in select jsonb_array_elements(
               public.turno_previsto(r.business_id, r.worker_id, v_hoy))
    loop
      if coalesce(t->>'desde','') ~ '^\d{1,2}:\d{2}$' then
        if v_ahora > ((v_hoy::text || ' ' || (t->>'desde') || ':00')::timestamp
                      at time zone v_tz) + make_interval(secs => r.seg::int) then
          if coalesce((select prefs->>'fichaje_recordatorio' from public.notification_prefs
                        where profile_id = r.profile_id), 'true') <> 'false' then
            insert into public.notifications (business_id, profile_id, type, title, body, link_tab)
            values (r.business_id, r.profile_id, 'fichaje_recordatorio',
                    'Recuerda fichar la entrada',
                    'Tu turno ya ha empezado y no hemos registrado tu entrada.',
                    'emp-fichaje');
            v_total := v_total + 1;
          end if;
          insert into public.fichaje_avisos_entrada (worker_id, dia)
          values (r.worker_id, v_hoy) on conflict do nothing;
          exit;
        end if;
      end if;
    end loop;
  end loop;

  return v_total;
end;
$function$
;


-- #####################################################################
--  Funciones de trigger
-- #####################################################################

CREATE OR REPLACE FUNCTION public.trg_auditar_fichaje()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.time_entry_audit(entry_id, business_id, actor_id, accion, antes, despues)
    values (NEW.id, NEW.business_id, coalesce(v_actor, NEW.profile_id),
            case when NEW.origen='auto' then 'cierre_auto' else 'crear' end,
            null, to_jsonb(NEW));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    insert into public.time_entry_audit(entry_id, business_id, actor_id, accion, antes, despues)
    values (NEW.id, NEW.business_id, coalesce(v_actor, NEW.profile_id),
            'editar', to_jsonb(OLD), to_jsonb(NEW));
    return NEW;
  elsif TG_OP = 'DELETE' then
    insert into public.time_entry_audit(entry_id, business_id, actor_id, accion, antes, despues)
    values (OLD.id, OLD.business_id, coalesce(v_actor, OLD.profile_id),
            'borrar', to_jsonb(OLD), null);
    return OLD;
  end if;
  return null;
end;
$function$
;

-- Un trigger salta aunque la función que inserta sea SECURITY DEFINER: por eso
-- la exención de 'timefix' tiene que estar AQUÍ y no en crear_correccion.
CREATE OR REPLACE FUNCTION public.trg_bloquear_solicitud()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_activas boolean;
begin
  -- Las correcciones del registro de jornada nunca se bloquean
  if NEW.type = 'timefix' then
    return NEW;
  end if;

  select coalesce((b.config ->> 'solicitudes_activas')::boolean, true)
    into v_activas
    from public.businesses b
   where b.id = NEW.business_id;

  if v_activas is false then
    raise exception 'Las solicitudes están desactivadas en este negocio.';
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notif_request_new()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g record; v_worker text;
begin
  if NEW.status <> 'pending' then return NEW; end if;
  select name into v_worker from public.workers where id = NEW.worker_id;
  for g in
    select profile_id from public.memberships
     where business_id = NEW.business_id and role = 'manager'
  loop
    perform public.crear_notif(
      NEW.business_id, g.profile_id, 'request_new',
      'Nueva solicitud',
      coalesce(v_worker,'Un empleado') || ' ha enviado una solicitud.',
      'solicitudes');
  end loop;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notif_request_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_profile uuid;
begin
  if NEW.status = OLD.status then return NEW; end if;
  if NEW.status not in ('approved','denied') then return NEW; end if;
  select profile_id into v_profile from public.workers where id = NEW.worker_id;
  perform public.crear_notif(
    NEW.business_id, v_profile, 'request_resolved',
    case when NEW.status='approved' then 'Solicitud aprobada' else 'Solicitud denegada' end,
    case when NEW.status='approved'
         then 'Tu responsable ha aprobado tu solicitud.'
         else 'Tu responsable ha respondido a tu solicitud.' end,
    'emp-solicitudes');
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notif_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e record;
begin
  if not NEW.pinned then return NEW; end if;   -- solo los destacados
  for e in
    select w.profile_id from public.workers w
     where w.business_id = NEW.business_id and w.profile_id is not null and w.active
  loop
    perform public.crear_notif(
      NEW.business_id, e.profile_id, 'announcement',
      'Aviso del negocio', left(NEW.text, 120), 'emp-hoy');
  end loop;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notif_week_visible()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e record; v_ahora boolean;
begin
  -- ¿Es visible AHORA?
  v_ahora := (NEW.visibility = 'shown')
             or (NEW.visibility = 'auto' and NEW.publish_at is not null and NEW.publish_at <= now());

  -- Solo avisamos si es visible y no se había avisado nunca.
  if not v_ahora then return NEW; end if;
  if NEW.notified_at is not null then return NEW; end if;
  if NEW.status is distinct from 'published' then return NEW; end if;

  for e in
    select w.profile_id from public.workers w
     where w.business_id = NEW.business_id and w.profile_id is not null and w.active
  loop
    perform public.crear_notif(
      NEW.business_id, e.profile_id, 'week_published',
      'Nuevo cuadrante publicado',
      'Ya puedes ver tus turnos de la semana del ' || to_char(NEW.start_date,'DD/MM') || '.',
      'emp-turnos');
  end loop;

  -- Dejamos constancia para no repetir (sin volver a disparar el trigger)
  update public.weeks set notified_at = now() where id = NEW.id;
  return NEW;
end;
$function$
;

-- =====================================================================
--  ATENCIÓN · SECRETO REDACTADO
-- =====================================================================
--  En la base de datos real, esta función lleva el bearer token de la Edge
--  Function y la URL del proyecto ESCRITOS EN SU CUERPO. Aquí van como
--  marcadores porque este archivo va a git y el repositorio se publica.
--
--  Antes de usar este baseline: rotar el token, sacarlo del código (tabla de
--  configuración accesible solo por service_role, o ajuste de base de datos)
--  y que la función lo lea de ahí. Ver README.md de esta carpeta.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trg_enviar_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url text := 'https://<PROJECT_REF>.supabase.co/functions/v1/enviar-push';
  v_key text := '<TOKEN_DE_LA_EDGE_FUNCTION>';
begin
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('notification_id', NEW.id)
  );
  return NEW;
end;
$function$
;


-- #####################################################################
--  PERMISOS
-- #####################################################################
--  El volcado daba la definición de cada función, NO su lista de permisos,
--  así que esta sección está reconstruida a partir de las migraciones
--  originales. Hay que verificarla en el proyecto actual:
--
--    select p.proname, p.proacl
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' order by p.proname;
--
--  IMPORTANTE: en Postgres, una función recién creada es EJECUTABLE POR
--  `public` mientras no se le haga un revoke explícito. Como casi todas son
--  SECURITY DEFINER, una sin revoke es una puerta abierta.

-- Internas: solo la Edge Function (service_role). Nunca desde el cliente.
revoke execute on function public.fichar_worker(uuid,uuid,text,uuid,text,text) from public, anon, authenticated;
grant  execute on function public.fichar_worker(uuid,uuid,text,uuid,text,text) to service_role;
revoke execute on function public.fichar_kiosco(text,uuid,text,text) from public, anon, authenticated;
grant  execute on function public.fichar_kiosco(text,uuid,text,text) to service_role;

-- Ayudantes internos: los llaman otras funciones, no el cliente.
revoke execute on function public.crear_notif(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.avisar_gestores(uuid,text,text,text,text)  from public, anon, authenticated;
revoke execute on function public.quiere_notif(uuid,text)                    from public, anon, authenticated;
revoke execute on function public.handle_new_user()                          from public, anon, authenticated;
revoke execute on function public.recordatorios_fichaje()                    from public, anon, authenticated;

-- La tablet del kiosco está deslogueada: necesita anon.
grant execute on function public.reclamar_token(text)  to anon, authenticated;
grant execute on function public.kiosco_equipo(text)   to anon, authenticated;
grant execute on function public.kiosco_estado(text)   to anon, authenticated;

-- Resto de RPC del cliente.
grant execute on function public.is_manager(uuid)                     to authenticated;
grant execute on function public.is_member(uuid)                      to authenticated;
grant execute on function public.my_worker_id(uuid)                   to authenticated;
grant execute on function public.soy_probador()                       to authenticated;
grant execute on function public.create_business(text)                to authenticated;
grant execute on function public.create_invite(uuid, int)             to authenticated;
grant execute on function public.get_invite(uuid)                     to authenticated;
grant execute on function public.invite_owner(text)                   to authenticated;
grant execute on function public.redeem_invite(text)                  to authenticated;
grant execute on function public.unlink_worker(uuid)                  to authenticated;
grant execute on function public.save_week(uuid, jsonb, jsonb)        to authenticated;
grant execute on function public.compute_publish_at(uuid, date)       to authenticated;
grant execute on function public.schedule_week(uuid, timestamptz)     to authenticated;
grant execute on function public.publish_week_now(uuid)               to authenticated;
grant execute on function public.unpublish_week(uuid)                 to authenticated;
grant execute on function public.set_week_visibility(uuid, text)      to authenticated;
grant execute on function public.copy_week(uuid, uuid)                to authenticated;
grant execute on function public.recompute_scheduled(uuid)            to authenticated;
grant execute on function public.delete_weeks_range(uuid, date, date) to authenticated;
grant execute on function public.count_weeks_range(uuid, date, date)  to authenticated;
grant execute on function public.weeks_overlapping(uuid, date, date)  to authenticated;
grant execute on function public.avisar_cambio_semana(uuid)           to authenticated;
grant execute on function public.resolve_request(uuid, boolean, text) to authenticated;
grant execute on function public.guardar_push(text,text,text,text)    to authenticated;
grant execute on function public.borrar_push(text)                    to authenticated;
grant execute on function public.set_mi_pin(uuid, text)               to authenticated;
grant execute on function public.tengo_pin(uuid)                      to authenticated;
grant execute on function public.vincular_kiosco(text,uuid,text)      to authenticated;
grant execute on function public.fichar()                             to authenticated;
grant execute on function public.turno_previsto(uuid, uuid, date)     to authenticated;
grant execute on function public.dia_laboral(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.tiene_turno_hoy(uuid, uuid, date)    to authenticated;
grant execute on function public.jornada_hoy(uuid)                    to authenticated;
grant execute on function public.fichajes_por_jornada(uuid,date,date) to authenticated;
grant execute on function public.crear_correccion(uuid,date,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.resolve_timefix(uuid, boolean, text) to authenticated;
