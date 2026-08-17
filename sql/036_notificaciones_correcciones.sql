-- 036 · Avisos de las correcciones de fichaje.
--
-- Hasta ahora crear_correccion y resolve_timefix no notificaban nada: el gestor
-- solo veía el badge al abrir la app, y el empleado tenía que entrar a mirar si
-- se la habían aprobado. Se reusan los tipos que ya existen en el catálogo
-- (js/data/notificaciones.js): 'request_new' para el gestor y 'request_resolved'
-- para el empleado, así respetan las preferencias de aviso que ya tiene cada uno.
--
-- Insertar en notifications dispara el push por trigger: aquí no se toca nada
-- de push.
--
-- El link_tab del empleado es 'emp-fichaje' (Mi registro), NO 'emp-solicitudes':
-- esa pestaña desaparece si el gestor apaga las solicitudes, y el panel «Mis
-- correcciones» vive en Mi registro, que está siempre disponible.

/* ---------- 1. Ayudante: avisar a los gestores del negocio ---------- */

create or replace function public.avisar_gestores(
  p_business_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link_tab text
)
returns void
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
begin
  insert into public.notifications (profile_id, business_id, type, title, body, link_tab)
  select m.profile_id, p_business_id, p_type, p_title, p_body, p_link_tab
    from public.memberships m
   where m.business_id = p_business_id
     and m.role = 'manager'
     and m.profile_id is not null;
end;
$function$;

/* ---------- 2. Al proponer: avisar al gestor ---------- */

create or replace function public.crear_correccion(
  p_business_id uuid,
  p_dia date,
  p_accion text,                 -- 'editar' | 'anadir' | 'borrar' | 'jornada'
  p_tipo text,                   -- 'entrada' | 'salida'  (para anadir)
  p_momento_local text,          -- 'YYYY-MM-DDTHH:MM'    (entrada, o la hora corregida)
  p_motivo text,
  p_entry_id uuid default null,
  p_momento_fin_local text default null   -- salida, solo para 'jornada'
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
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
$function$;

/* ---------- 3. Al resolver: avisar al empleado ---------- */

create or replace function public.resolve_timefix(
  p_request uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
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
$function$;

grant execute on function public.crear_correccion(uuid, date, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.resolve_timefix(uuid, boolean, text) to authenticated;
grant execute on function public.avisar_gestores(uuid, text, text, text, text) to authenticated;
