-- 035 · Correcciones de fichaje propuestas por el empleado.
--
-- El trabajador propone; el gestor aprueba o deniega. Al aprobar, el cambio
-- se aplica a time_entries con origen 'gestor' Y con request_id apuntando a
-- la solicitud, de modo que el trigger de time_entry_audit recoge solo quién
-- lo pidió y por qué. Sin esto, la única vía es corregir a mano y no queda
-- constancia del origen de la petición.
--
-- Se aísla en su propia RPC: resolve_request (vacaciones) NO se toca.

/* ---------- 1. Columnas ---------- */

alter table public.requests
  add column if not exists entry_id uuid references public.time_entries(id) on delete set null,
  add column if not exists fix jsonb;

comment on column public.requests.entry_id is 'Fichaje al que se refiere la corrección (null si falta)';
comment on column public.requests.fix      is '{accion, tipo, momento, momento_fin} de la corrección propuesta';

alter table public.time_entries
  add column if not exists request_id uuid references public.requests(id) on delete set null;

comment on column public.time_entries.request_id is 'Solicitud del trabajador que originó este cambio';

/* ---------- 2. Admitir el tipo 'timefix' ---------- */
/* Si había un CHECK sobre 'type', se sustituye por otro que incluya el tipo
   nuevo. Si no había ninguno, no se añade: no inventamos restricciones. */

do $$
declare c record; habia boolean := false; v_tipo text;
begin
  -- Si 'type' fuese un enum, el CHECK no sería el problema: habría que añadir
  -- el valor al enum. Se avisa claro en vez de fallar de forma confusa.
  select a.atttypid::regtype::text into v_tipo
    from pg_attribute a
   where a.attrelid = 'public.requests'::regclass and a.attname = 'type';

  if v_tipo not in ('text', 'character varying') then
    raise exception 'requests.type es de tipo %. Añade ''timefix'' a ese tipo antes de seguir.', v_tipo;
  end if;

  for c in
    select conname from pg_constraint
     where conrelid = 'public.requests'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%type%'
  loop
    execute format('alter table public.requests drop constraint %I', c.conname);
    habia := true;
    raise notice 'Sustituida la restricción %', c.conname;
  end loop;

  if habia then
    execute 'alter table public.requests add constraint requests_type_chk '
         || 'check (type in (''vacation'',''change'',''other'',''timefix''))';
  end if;
end $$;

/* ---------- 3. El empleado propone ---------- */
/* p_momento_local llega como texto 'YYYY-MM-DDTHH:MM' (hora de pared) y se
   interpreta aquí en la zona del negocio. Nunca se manda un instante ya
   calculado desde el navegador: la zona la decide el servidor.

   Los errores se devuelven como datos JSONB, no con raise: así el cliente
   los distingue de un fallo real. */

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
  v_worker uuid; v_tz text; v_momento timestamptz; v_fin timestamptz;
  v_req uuid;
begin
  -- ¿Quién es? Su ficha en ESTE negocio (un mismo perfil puede estar en varios)
  select w.id into v_worker
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

  return jsonb_build_object('ok', true, 'id', v_req);
end;
$function$;

/* ---------- 4. El gestor resuelve ---------- */
/* Aparte de resolve_request a propósito: esa función aprueba vacaciones y
   funciona; no se toca por meterle una rama nueva. */

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
      select w.profile_id into v_profile
        from public.workers w where w.id = r.worker_id;

      insert into public.time_entries
        (business_id, worker_id, profile_id, tipo, momento, origen, nota, request_id)
      values
        (r.business_id, r.worker_id, v_profile, r.fix->>'tipo',
         (r.fix->>'momento')::timestamptz, 'gestor', v_nota, r.id);

    elsif r.fix->>'accion' = 'jornada' then
      -- Día entero sin fichar: entrada y salida en una sola aprobación
      select w.profile_id into v_profile
        from public.workers w where w.id = r.worker_id;

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

  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.crear_correccion(uuid, date, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.resolve_timefix(uuid, boolean, text) to authenticated;
