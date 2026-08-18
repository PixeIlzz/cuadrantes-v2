-- =====================================================================
--  ARCHIVO HISTÓRICO  ·  NO EJECUTAR ESTE ARCHIVO
-- =====================================================================
--  Recuperado de la lista de snippets guardados del SQL Editor de
--  Supabase (2026-08-18). Es la única copia que existe de las migraciones
--  anteriores a la 33, que nunca se versionaron en el repo.
--
--  QUÉ ES Y QUÉ NO ES
--  · Es el HISTORIAL de lo que se ejecutó, reordenado de forma ascendente.
--  · NO es el estado actual de la base de datos. Hay funciones que
--    aparecen dos veces con cuerpos distintos porque una migración
--    posterior las reemplazó (kiosco_estado y fichar_kiosco: la buena es
--    la de la 28 y la 23 respectivamente). Ejecutar este archivo de
--    arriba abajo dejaría instaladas versiones VIEJAS.
--  · Está INCOMPLETO. Faltan:
--      - la 01 (esquema base: businesses, profiles, memberships, workers,
--        weeks, assignments, vacations, requests, invites…, más
--        is_manager(), is_member(), soy_probador(), redeem_invite())
--      - las 09-16 y 21, 22, 25, 26, 27, 29-32 (entre ellas dia_laboral()
--        y la primera versión de fichajes_por_jornada(), notificaciones
--        push, y workers.full_name/nif/nss)
--      - todo lo que se hizo desde el interfaz gráfico del panel, que no
--        deja snippet.
--
--  El estado REAL y autoritativo se obtiene con las consultas de
--  sql/tools/volcar_esquema.sql. De ahí saldrá sql/000_baseline.sql.
--  Este archivo se conserva por los comentarios: el porqué de cada
--  decisión, que ningún volcado automático puede reconstruir.
--
--  Los scripts puntuales (limpiezas, diagnósticos, activar probadores)
--  están al final, COMENTADOS. Uno de ellos vacía el negocio entero.
-- =====================================================================


-- #####################################################################
--  02 — RPC de guardado de semana
-- #####################################################################
--  Reemplaza TODAS las asignaciones de la semana de una vez (atómico):
--  o se guarda todo, o no se guarda nada. Evita estados a medias si
--  se corta la conexión en mitad de un guardado.

create or replace function public.save_week(
  p_week_id uuid,
  p_cells   jsonb,   -- [{"day":"vie","role":"cam","worker":"uuid|null","all":bool,"ord":0}, ...]
  p_notes   jsonb    -- {"vie":"texto", ...}
) returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

revoke execute on function public.save_week(uuid, jsonb, jsonb) from anon;
grant  execute on function public.save_week(uuid, jsonb, jsonb) to authenticated;


-- #####################################################################
--  03 — Publicación de semanas
-- #####################################################################
--  El cálculo de la fecha/hora de publicación se hace en la base de datos
--  para que la zona horaria (Atlantic/Canary) sea siempre correcta,
--  independientemente del reloj o el país del dispositivo del gestor.

/* Momento de publicación por defecto de una semana concreta,
   según businesses.config->publish  {weekday:0..6 (0=domingo), time:"18:00", tz:"..."} */
create or replace function public.compute_publish_at(p_business uuid, p_start date)
returns timestamptz
language plpgsql stable security definer set search_path = public
as $$
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
$$;

/* Programar una semana.
   p_manual null  → usa la regla por defecto del negocio (publish_at_manual = false)
   p_manual dado  → override solo para esta semana (publish_at_manual = true) */
create or replace function public.schedule_week(p_week_id uuid, p_manual timestamptz default null)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
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
$$;

/* Publicar de inmediato */
create or replace function public.publish_week_now(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

/* Volver a borrador: deja de ser visible para los empleados */
create or replace function public.unpublish_week(p_week_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

/* Copiar las asignaciones y notas de una semana a otra (reemplaza el destino) */
create or replace function public.copy_week(p_from uuid, p_to uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

/* Recalcular las semanas programadas que NO tienen override manual.
   Se llama al cambiar el día/hora de publicación por defecto en Ajustes. */
create or replace function public.recompute_scheduled(p_business uuid)
returns int
language plpgsql security definer set search_path = public
as $$
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
$$;

revoke execute on function public.compute_publish_at(uuid, date)          from anon;
revoke execute on function public.schedule_week(uuid, timestamptz)        from anon;
revoke execute on function public.publish_week_now(uuid)                  from anon;
revoke execute on function public.unpublish_week(uuid)                    from anon;
revoke execute on function public.copy_week(uuid, uuid)                   from anon;
revoke execute on function public.recompute_scheduled(uuid)               from anon;

grant execute on function public.compute_publish_at(uuid, date)    to authenticated;
grant execute on function public.schedule_week(uuid, timestamptz)  to authenticated;
grant execute on function public.publish_week_now(uuid)            to authenticated;
grant execute on function public.unpublish_week(uuid)              to authenticated;
grant execute on function public.copy_week(uuid, uuid)             to authenticated;
grant execute on function public.recompute_scheduled(uuid)         to authenticated;


-- #####################################################################
--  04 — Invitaciones de empleados
-- #####################################################################
--  El gestor genera un código por trabajador; el empleado se registra
--  con él y su cuenta queda enlazada a su ficha.

/* Genera (o regenera) el código de un trabajador. Devuelve el código. */
create or replace function public.create_invite(p_worker uuid, p_dias int default 30)
returns text
language plpgsql security definer set search_path = public
as $$
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
$$;

/* Código vivo de un trabajador, si lo tiene (para volver a enseñarlo) */
create or replace function public.get_invite(p_worker uuid)
returns table(code text, expires_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select i.code, i.expires_at
    from public.invites i
    join public.workers w on w.id = i.worker_id
   where i.worker_id = p_worker
     and i.used_at is null
     and i.expires_at > now()
     and public.is_manager(w.business_id)
   limit 1;
$$;

/* Desvincular la cuenta de un trabajador (si se va del negocio) */
create or replace function public.unlink_worker(p_worker uuid)
returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

revoke execute on function public.create_invite(uuid, int) from anon;
revoke execute on function public.get_invite(uuid)         from anon;
revoke execute on function public.unlink_worker(uuid)      from anon;

grant execute on function public.create_invite(uuid, int) to authenticated;
grant execute on function public.get_invite(uuid)         to authenticated;
grant execute on function public.unlink_worker(uuid)      to authenticated;

-- redeem_invite ya existe (01_esquema.sql). Refuerzo del permiso por si acaso:
grant execute on function public.redeem_invite(text) to authenticated;


-- #####################################################################
--  05 — Resolución de solicitudes
-- #####################################################################
--  Aprobar unas vacaciones marca la solicitud Y crea el periodo en la
--  misma transacción: o pasan las dos cosas, o no pasa ninguna.

create or replace function public.resolve_request(
  p_request uuid,
  p_approve boolean,
  p_note    text default null
) returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

/* Semanas ya programadas o publicadas que se solapan con unas fechas.
   Sirve para avisar al gestor antes de aprobar. */
create or replace function public.weeks_overlapping(
  p_business uuid, p_from date, p_to date
) returns table(start_date date, status text)
language sql stable security definer set search_path = public
as $$
  select w.start_date, w.status
    from public.weeks w
   where w.business_id = p_business
     and public.is_manager(p_business)
     and w.status in ('scheduled','published')
     and w.start_date <= p_to
     and (w.start_date + 6) >= p_from
   order by w.start_date;
$$;

revoke execute on function public.resolve_request(uuid, boolean, text)  from anon;
revoke execute on function public.weeks_overlapping(uuid, date, date)   from anon;
grant  execute on function public.resolve_request(uuid, boolean, text)  to authenticated;
grant  execute on function public.weeks_overlapping(uuid, date, date)   to authenticated;


-- #####################################################################
--  06 — Visibilidad de semanas
-- #####################################################################
--  Antes: "ocultar" borraba publish_at y se perdía la programación.
--  Ahora: la programación (publish_at) y la visibilidad son cosas
--  distintas. weeks.visibility manda sobre el cálculo automático:
--
--    'auto'   → visible si ya llegó su fecha Y la semana no ha terminado
--    'shown'  → visible siempre (adelantar una futura, o conservar una pasada)
--    'hidden' → nunca visible para el equipo
--
--  Efecto buscado: al llegar su fecha se muestra sola, al terminar la
--  semana se archiva sola (solo la ve el gestor), y la fecha programada
--  sigue intacta pase lo que pase.

alter table public.weeks
  add column if not exists visibility text not null default 'auto';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weeks_visibility_ck') then
    alter table public.weeks
      add constraint weeks_visibility_ck check (visibility in ('auto','shown','hidden'));
  end if;
end $$;

-- ---------------------------------------------------------------------
--  Nuevas políticas de lectura para el empleado
-- ---------------------------------------------------------------------
drop policy if exists "semanas: el empleado solo las publicadas y ya en fecha" on public.weeks;
drop policy if exists "asignaciones: el empleado, las de semanas visibles"      on public.assignments;

create policy "semanas: el empleado ve las visibles"
  on public.weeks for select
  using (
    public.is_member(business_id)
    and visibility <> 'hidden'
    and (
      visibility = 'shown'
      or (publish_at is not null
          and publish_at <= now()
          and (start_date + 6) >= current_date)
    )
  );

create policy "asignaciones: el empleado, las de semanas visibles"
  on public.assignments for select
  using (
    exists (
      select 1 from public.weeks w
       where w.id = week_id
         and public.is_member(w.business_id)
         and w.visibility <> 'hidden'
         and (
           w.visibility = 'shown'
           or (w.publish_at is not null
               and w.publish_at <= now()
               and (w.start_date + 6) >= current_date)
         )
    )
  );

-- ---------------------------------------------------------------------
--  Cambiar la visibilidad sin tocar la programación
-- ---------------------------------------------------------------------
create or replace function public.set_week_visibility(p_week_id uuid, p_mode text)
returns void
language plpgsql security definer set search_path = public
as $$
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
$$;

-- ---------------------------------------------------------------------
--  Borrado por rango de fechas (un mes, un año)
-- ---------------------------------------------------------------------
create or replace function public.delete_weeks_range(
  p_business uuid, p_from date, p_to date
) returns int
language plpgsql security definer set search_path = public
as $$
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
$$;

-- Cuántas semanas hay en un rango (para avisar antes de borrar)
create or replace function public.count_weeks_range(
  p_business uuid, p_from date, p_to date
) returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.weeks
   where business_id = p_business
     and start_date >= p_from and start_date <= p_to
     and public.is_manager(p_business);
$$;

revoke execute on function public.set_week_visibility(uuid, text)       from anon;
revoke execute on function public.delete_weeks_range(uuid, date, date)  from anon;
revoke execute on function public.count_weeks_range(uuid, date, date)   from anon;
grant  execute on function public.set_week_visibility(uuid, text)       to authenticated;
grant  execute on function public.delete_weeks_range(uuid, date, date)  to authenticated;
grant  execute on function public.count_weeks_range(uuid, date, date)   to authenticated;


-- #####################################################################
--  07 — Tablón de avisos + tipo de solicitud "otro"
-- #####################################################################

-- ---------------------------------------------------------------------
--  1. Nuevo tipo de solicitud: 'other'
-- ---------------------------------------------------------------------
alter table public.requests drop constraint if exists requests_type_check;
alter table public.requests
  add constraint requests_type_check
  check (type in ('vacation','change','other'));

-- ---------------------------------------------------------------------
--  2. Tablón de avisos del negocio
-- ---------------------------------------------------------------------
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  text        text not null,
  pinned      boolean not null default false,   -- destacado arriba
  active      boolean not null default true,
  expires_at  date,                              -- opcional: deja de verse
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists announcements_biz_idx
  on public.announcements (business_id, active, created_at desc);

alter table public.announcements enable row level security;

drop policy if exists "avisos: los lee todo el equipo"  on public.announcements;
drop policy if exists "avisos: los gestiona el gestor"  on public.announcements;

-- Todo el equipo ve los avisos activos y no caducados
create policy "avisos: los lee todo el equipo"
  on public.announcements for select
  using (
    public.is_member(business_id)
    and active
    and (expires_at is null or expires_at >= current_date)
  );

-- El gestor los ve todos y los gestiona
create policy "avisos: los gestiona el gestor"
  on public.announcements for all
  using (public.is_manager(business_id))
  with check (public.is_manager(business_id));


-- #####################################################################
--  08 — Tareas / checklist del negocio
-- #####################################################################
--  Una tarea puede ser puntual (un día concreto) o repetirse cada día
--  o ciertos días de la semana. Marcarla hecha NO borra la tarea:
--  se guarda una fila por día completado, así las repetitivas vuelven
--  a aparecer al día siguiente y queda historial de lo hecho.

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  title        text not null,
  detail       text,
  repeat_type  text not null default 'once'
               check (repeat_type in ('once','daily','weekly')),
  repeat_days  int[] not null default '{}',   -- para 'weekly': 0=domingo … 6=sábado
  due_date     date,                          -- para 'once'
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists tasks_biz_idx on public.tasks (business_id, active);

create table if not exists public.task_completions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  done_date   date not null,
  done_by     uuid references public.profiles(id) on delete set null,
  done_at     timestamptz not null default now(),
  unique (task_id, done_date)
);

create index if not exists task_comp_idx
  on public.task_completions (business_id, done_date desc);

alter table public.tasks            enable row level security;
alter table public.task_completions enable row level security;

drop policy if exists "tareas: solo el gestor"       on public.tasks;
drop policy if exists "completadas: solo el gestor"  on public.task_completions;

-- De momento las tareas son cosa del gestor. Si algún día se abren al
-- equipo, basta con añadir una política de lectura con is_member.
create policy "tareas: solo el gestor"
  on public.tasks for all
  using (public.is_manager(business_id))
  with check (public.is_manager(business_id));

create policy "completadas: solo el gestor"
  on public.task_completions for all
  using (public.is_manager(business_id))
  with check (public.is_manager(business_id));


-- #####################################################################
--  17 — Base de datos del fichaje (registro horario)
-- #####################################################################
--  Diseñado con los requisitos legales: hora del servidor, inmutable,
--  auditoría de cambios, sin biometría, sin geolocalización.
--  De momento SOLO accesible para cuentas probadoras (soy_probador()).
--  Requiere el 16 ejecutado.

-- ---------------------------------------------------------------------
--  Horario previsto de cada día (para detectar retrasos)
--  Se guarda en businesses.config.fichaje, no hace falta tabla nueva.
--  Estructura ejemplo:
--    "fichaje": { "horarios": {
--        "lun": [{"desde":"11:30","hasta":"17:00"}],
--        "vie": [{"desde":"11:00","hasta":"17:00"},{"desde":"19:00","hasta":"00:00"}]
--    }, "cierre_auto": "04:00" }
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
--  Tabla de fichajes (cada entrada y cada salida es una fila)
-- ---------------------------------------------------------------------
create table if not exists public.time_entries (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  worker_id    uuid not null references public.workers(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  tipo         text not null check (tipo in ('entrada','salida')),
  -- La hora la pone el SERVIDOR (default now()), nunca el móvil
  momento      timestamptz not null default now(),
  -- Marca si esta fila fue puesta/cerrada automáticamente (jornada olvidada)
  estimado     boolean not null default false,
  -- Origen: 'empleado' (fichó él), 'auto' (cierre automático), 'gestor' (corrección)
  origen       text not null default 'empleado' check (origen in ('empleado','auto','gestor')),
  nota         text,
  created_at   timestamptz not null default now()
);

create index if not exists te_worker_dia_idx
  on public.time_entries (worker_id, momento);
create index if not exists te_business_idx
  on public.time_entries (business_id, momento);

-- ---------------------------------------------------------------------
--  Auditoría: cada cambio a un fichaje deja rastro inmutable
--  (quién, qué, cuándo, valor antes y después)
-- ---------------------------------------------------------------------
create table if not exists public.time_entry_audit (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid,                  -- puede quedar huérfano si se borra: se conserva el rastro
  business_id  uuid not null,
  actor_id     uuid not null,         -- quién hizo el cambio
  accion       text not null,         -- 'crear','editar','borrar','cierre_auto'
  antes        jsonb,
  despues      jsonb,
  momento      timestamptz not null default now()
);

create index if not exists tea_business_idx
  on public.time_entry_audit (business_id, momento desc);

-- Trigger que registra en la auditoría cualquier cambio
create or replace function public.trg_auditar_fichaje()
returns trigger language plpgsql security definer set search_path = public
as $$
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
$$;

drop trigger if exists auditar_fichaje on public.time_entries;
create trigger auditar_fichaje
  after insert or update or delete on public.time_entries
  for each row execute function public.trg_auditar_fichaje();

-- ---------------------------------------------------------------------
--  RLS: por ahora SOLO probadores. Al abrir el módulo a todos,
--  se sustituye 'soy_probador()' por la condición normal de negocio.
-- ---------------------------------------------------------------------
alter table public.time_entries      enable row level security;
alter table public.time_entry_audit  enable row level security;

-- Empleado probador: ve y crea SUS fichajes
drop policy if exists "fich: empleado ve los suyos" on public.time_entries;
create policy "fich: empleado ve los suyos"
  on public.time_entries for select
  using (soy_probador() and (
    profile_id = auth.uid()
    or exists (select 1 from public.memberships m
               where m.business_id = time_entries.business_id
                 and m.profile_id = auth.uid() and m.role = 'manager')
  ));

drop policy if exists "fich: empleado ficha lo suyo" on public.time_entries;
create policy "fich: empleado ficha lo suyo"
  on public.time_entries for insert
  with check (soy_probador() and profile_id = auth.uid());

-- Gestor probador: puede corregir (update/delete) los del negocio
drop policy if exists "fich: gestor corrige" on public.time_entries;
create policy "fich: gestor corrige"
  on public.time_entries for update
  using (soy_probador() and exists (
    select 1 from public.memberships m
     where m.business_id = time_entries.business_id
       and m.profile_id = auth.uid() and m.role = 'manager'));

drop policy if exists "fich: gestor borra" on public.time_entries;
create policy "fich: gestor borra"
  on public.time_entries for delete
  using (soy_probador() and exists (
    select 1 from public.memberships m
     where m.business_id = time_entries.business_id
       and m.profile_id = auth.uid() and m.role = 'manager'));

-- Auditoría: solo lectura, para gestores probadores. Nadie la modifica a mano.
drop policy if exists "audit: gestor lee" on public.time_entry_audit;
create policy "audit: gestor lee"
  on public.time_entry_audit for select
  using (soy_probador() and exists (
    select 1 from public.memberships m
     where m.business_id = time_entry_audit.business_id
       and m.profile_id = auth.uid() and m.role = 'manager'));

-- ---------------------------------------------------------------------
--  Función para fichar (el empleado la llama). La hora la pone el servidor.
--  Alterna: si su último fichaje de hoy fue entrada -> crea salida, y al revés.
-- ---------------------------------------------------------------------
create or replace function public.fichar()
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

grant execute on function public.fichar() to authenticated;


-- #####################################################################
--  18 — Modo Kiosco (fichaje presencial sin geolocalización)
-- #####################################################################
--  Idea: el fichaje se ata a un DISPOSITIVO físico del local (la tablet
--  del kiosco), no a coordenadas GPS. La tablet guarda un device_token
--  secreto; sin ese token no se puede fichar. Cero permisos de ubicación.
--
--  El empleado se pone su propio PIN desde la app. En el kiosco toca su
--  nombre e introduce el PIN. La verificación y el registro los hace una
--  Edge Function con service_role (llama a fichar_worker).
--
--  Requiere la migración del fichaje (17) ejecutada.

-- pgcrypto: para hashear el PIN (crypt/gen_salt) y generar tokens.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  1. Tabla de kioscos (dispositivos fijos del local)
--     Se crea PRIMERO porque time_entries la referenciará.
-- ---------------------------------------------------------------------
create table if not exists public.kioscos (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  nombre         text not null,                    -- "Barra", "Cocina"...
  device_token   text not null unique default encode(gen_random_bytes(24), 'hex'),
  activo         boolean not null default true,
  ips_permitidas text[],                           -- null = sin restricción de IP
  created_at     timestamptz not null default now()
);

create index if not exists kioscos_business_idx on public.kioscos (business_id);

alter table public.kioscos enable row level security;

-- Solo el gestor ve y gestiona los kioscos de SU negocio.
-- (El kiosco en sí no entra por RLS: ficha vía Edge Function con service_role.)
drop policy if exists "kioscos: gestor de su negocio" on public.kioscos;
create policy "kioscos: gestor de su negocio"
  on public.kioscos for all
  using (public.is_manager(business_id))
  with check (public.is_manager(business_id));

-- ---------------------------------------------------------------------
--  2. Ajustes en las tablas del fichaje
-- ---------------------------------------------------------------------

-- 'kiosco' pasa a ser un origen válido de fichaje.
alter table public.time_entries drop constraint if exists time_entries_origen_check;
alter table public.time_entries
  add constraint time_entries_origen_check
  check (origen in ('empleado','auto','gestor','kiosco'));

-- Un fichaje de kiosco puede no tener cuenta enlazada (trabajador sin app).
alter table public.time_entries    alter column profile_id drop not null;
-- Y por tanto la auditoría puede no tener actor con cuenta (queda el worker_id).
alter table public.time_entry_audit alter column actor_id  drop not null;

-- De dónde vino el fichaje (para el registro legal: imagen 2 del ejemplo).
alter table public.time_entries add column if not exists kiosco_id uuid
  references public.kioscos(id) on delete set null;
alter table public.time_entries add column if not exists ip text;

-- PIN del trabajador (hash bcrypt, NUNCA en claro).
alter table public.workers add column if not exists pin_hash text;

-- ---------------------------------------------------------------------
--  3. El empleado se pone / cambia su PIN (logueado)
-- ---------------------------------------------------------------------
create or replace function public.set_mi_pin(p_business_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public
as $$
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
$$;
revoke execute on function public.set_mi_pin(uuid, text) from anon;
grant   execute on function public.set_mi_pin(uuid, text) to authenticated;

-- ¿Tengo PIN puesto? (para la UI, sin revelar nada)
create or replace function public.tengo_pin(p_business_id uuid)
returns boolean
language sql security definer set search_path = public
as $$
  select pin_hash is not null from public.workers
   where business_id = p_business_id and profile_id = auth.uid();
$$;
grant execute on function public.tengo_pin(uuid) to authenticated;

-- ---------------------------------------------------------------------
--  4. Alternar entrada/salida de un worker YA validado.
--     La llama SOLO la Edge Function del kiosco (service_role), después
--     de comprobar device_token + PIN + IP. No expuesta al cliente.
-- ---------------------------------------------------------------------
create or replace function public.fichar_worker(
  p_business_id uuid,
  p_worker_id   uuid,
  p_origen      text default 'kiosco',
  p_kiosco_id   uuid default null,
  p_ip          text default null,
  p_nota        text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

-- Que no la pueda invocar nadie desde el cliente: solo la Edge Function.
revoke execute on function public.fichar_worker(uuid,uuid,text,uuid,text,text) from anon, authenticated;
grant   execute on function public.fichar_worker(uuid,uuid,text,uuid,text,text) to service_role;


-- #####################################################################
--  19 — Emparejar kiosko (la tablet muestra QR, el gestor lo escanea)
-- #####################################################################
--  Flujo:
--   1. La tablet (deslogueada) genera un 'nonce' aleatorio y lo enseña
--      como QR. Se queda consultando reclamar_token(nonce) cada 2 s.
--   2. El gestor (logueado) escanea -> su app llama a
--      vincular_kiosco(nonce, negocio, nombre). Se crea la fila en
--      'kioscos' con su device_token, sellada con ese nonce.
--   3. La tablet recibe el device_token UNA sola vez, lo guarda en
--      localStorage y el nonce se borra.
--
--  Requiere 18_kiosco.sql.

alter table public.kioscos add column if not exists pairing_nonce    text unique;
alter table public.kioscos add column if not exists pairing_nonce_at timestamptz;

-- ---------------------------------------------------------------------
--  Paso 2: el GESTOR vincula el kiosko a UNO de sus negocios.
--  (La app decide el negocio; si gestiona varios, se lo pregunta antes.)
-- ---------------------------------------------------------------------
create or replace function public.vincular_kiosco(
  p_nonce text, p_business_id uuid, p_nombre text
) returns void
language plpgsql security definer set search_path = public
as $$
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
$$;
revoke execute on function public.vincular_kiosco(text,uuid,text) from anon;
grant   execute on function public.vincular_kiosco(text,uuid,text) to authenticated;

-- ---------------------------------------------------------------------
--  Paso 3: la TABLET (deslogueada) recoge su token una sola vez.
--  Devuelve null mientras el gestor no haya escaneado (o si caducó).
-- ---------------------------------------------------------------------
create or replace function public.reclamar_token(p_nonce text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_token text;
begin
  update public.kioscos
     set pairing_nonce = null, pairing_nonce_at = null
   where pairing_nonce = p_nonce
     and pairing_nonce_at > now() - interval '10 minutes'
  returning device_token into v_token;

  return v_token;
end;
$$;
grant execute on function public.reclamar_token(text) to anon, authenticated;


-- #####################################################################
--  20 — Funciones del kiosco (validación + rejilla)
-- #####################################################################
--  OJO: fichar_kiosco y kiosco_estado de aquí quedaron SUPERADAS por
--  la 23 y la 28. Se conservan solo como historial.
--
--  A) fichar_kiosco: valida device_token + PIN + IP y ficha. La llama
--     SOLO la Edge Function (service_role); así el PIN se comprueba en la
--     base de datos y la IP es la real (la pone la Edge Function).
--  B) kiosco_equipo: la tablet (anónima, con su device_token) pide la
--     lista de trabajadores para pintar la rejilla.

-- ---------------------------------------------------------------------
--  A) [SUPERADA POR LA 23] Validar y fichar. Devuelve {tipo, momento}.
--     Errores como códigos cortos para que la tablet muestre el mensaje.
-- ---------------------------------------------------------------------
create or replace function public.fichar_kiosco(
  p_device_token text, p_worker_id uuid, p_pin text, p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_kiosco public.kioscos%rowtype; v_hash text;
begin
  -- 1. Kiosco válido y activo
  select * into v_kiosco from public.kioscos
   where device_token = p_device_token and activo = true;
  if not found then raise exception 'KIOSCO_INVALIDO'; end if;

  -- 2. IP permitida (solo si el kiosco tiene allowlist configurada)
  if v_kiosco.ips_permitidas is not null
     and array_length(v_kiosco.ips_permitidas, 1) is not null
     and (p_ip is null or not (p_ip = any (v_kiosco.ips_permitidas))) then
    raise exception 'IP_NO_PERMITIDA';
  end if;

  -- 3. PIN correcto para ese trabajador en ESE negocio
  select pin_hash into v_hash from public.workers
   where id = p_worker_id and business_id = v_kiosco.business_id and active = true;
  if v_hash is null then raise exception 'SIN_PIN'; end if;
  if crypt(p_pin, v_hash) <> v_hash then raise exception 'PIN_INCORRECTO'; end if;

  -- 4. Fichar (alterna entrada/salida) reutilizando fichar_worker
  return public.fichar_worker(
    v_kiosco.business_id, p_worker_id, 'kiosco', v_kiosco.id, p_ip, null
  );
end;
$$;
revoke execute on function public.fichar_kiosco(text,uuid,text,text) from anon, authenticated;
grant   execute on function public.fichar_kiosco(text,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------
--  B) Equipo a mostrar en la rejilla del kiosco.
--     tiene_pin = false -> se muestra pero al tocar avisa de configurar PIN.
-- ---------------------------------------------------------------------
create or replace function public.kiosco_equipo(p_device_token text)
returns table (worker_id uuid, name text, tiene_pin boolean)
language plpgsql security definer set search_path = public
as $$
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
$$;
grant execute on function public.kiosco_equipo(text) to anon, authenticated;


-- #####################################################################
--  23 — Arreglo del lockout + estado en vivo para los contadores
-- #####################################################################
--  A) fichar_kiosco: ahora DEVUELVE el error como dato (jsonb) en vez de
--     lanzarlo. Al no lanzar excepción, el contador de intentos se guarda
--     y el bloqueo funciona. (El cliente ya lee data.error.)
--  B) kiosco_estado: por cada trabajador activo, si está dentro y desde
--     cuándo, más el horario previsto del negocio, para pintar el contador
--     y los colores (verde / rojo por retraso o exceso).
--     [ESTA VERSIÓN DE kiosco_estado QUEDÓ SUPERADA POR LA 28]
--
--  Requiere 18-22 ejecutados.

-- ---------------------------------------------------------------------
--  A) Validar y fichar, devolviendo errores como dato
-- ---------------------------------------------------------------------
create or replace function public.fichar_kiosco(
  p_device_token text, p_worker_id uuid, p_pin text, p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
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
$$;
revoke execute on function public.fichar_kiosco(text,uuid,text,text) from anon, authenticated;
grant   execute on function public.fichar_kiosco(text,uuid,text,text) to service_role;

-- ---------------------------------------------------------------------
--  B) [SUPERADA POR LA 28] Estado del equipo para la rejilla
-- ---------------------------------------------------------------------
create or replace function public.kiosco_estado(p_device_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_biz uuid; v_horarios jsonb; v_workers jsonb;
begin
  select business_id into v_biz from public.kioscos
   where device_token = p_device_token and activo = true;
  if v_biz is null then raise exception 'KIOSCO_INVALIDO'; end if;

  select coalesce(config->'fichaje'->'horarios', '{}'::jsonb) into v_horarios
    from public.businesses where id = v_biz;

  select coalesce(jsonb_agg(x order by srt, nm), '[]'::jsonb) into v_workers
  from (
    select w.sort_order as srt, w.name as nm,
      jsonb_build_object(
        'worker_id', w.id,
        'name', w.name,
        'tiene_pin', (w.pin_hash is not null),
        'dentro', (ult.tipo = 'entrada'),
        'desde', case when ult.tipo = 'entrada' then ult.momento else null end
      ) as x
    from public.workers w
    left join lateral (
      select te.tipo, te.momento from public.time_entries te
       where te.worker_id = w.id
       order by te.momento desc limit 1
    ) ult on true
    where w.business_id = v_biz and w.active = true
  ) sub;

  return jsonb_build_object('horarios', v_horarios, 'workers', v_workers);
end;
$$;
grant execute on function public.kiosco_estado(text) to anon, authenticated;


-- #####################################################################
--  24 — Activar Realtime en time_entries
-- #####################################################################
--  Permite que la app reciba los fichajes en vivo (websocket) en vez de
--  recargar. La RLS sigue aplicando: cada usuario solo recibe las filas
--  que puede ver (empleado: las suyas; gestor: las de su negocio).

do $$
begin
  alter publication supabase_realtime add table public.time_entries;
exception when others then
  null;   -- ya estaba añadida: no pasa nada
end $$;


-- #####################################################################
--  28 — El fichaje usa el turno REAL de cada trabajador
-- #####################################################################
--  Las columnas del cuadrante ahora pueden llevar horario:
--    config.days = [{id,label,night,desde,hasta}, ...]
--
--  turno_previsto(business, worker, dia) devuelve los tramos previstos de
--  ESA persona ESE día, sacados del cuadrante publicado. Si no tiene turno
--  asignado (o su columna no tiene horas), cae al horario general del
--  negocio (config.fichaje.horarios), así nada se rompe.
--
--  Multinegocio: todo se resuelve por business_id y su propia config.
--  Requiere 18-27. Se puede ejecutar varias veces sin problema.

-- jornada_hoy gana una columna nueva (tramos): hay que borrarla primero,
-- porque Postgres no deja cambiar el tipo de retorno con create or replace.
drop function if exists public.jornada_hoy(uuid);

-- ---------------------------------------------------------------------
--  A) Tramos previstos de un trabajador en un día concreto
-- ---------------------------------------------------------------------
create or replace function public.turno_previsto(
  p_business_id uuid, p_worker_id uuid, p_dia date
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cfg jsonb; v_dias jsonb; v_semana record; v_idx int;
  v_tramos jsonb := '[]'::jsonb; v_col jsonb; v_id text;
  DIAS constant text[] := array['lun','mar','mie','jue','vie','sab','dom'];
begin
  select config into v_cfg from public.businesses where id = p_business_id;
  v_dias := coalesce(v_cfg->'days', '[]'::jsonb);

  -- Semana publicada que contiene ese día (lunes como inicio)
  select w.id, w.start_date, coalesce(w.config_snapshot->'days', v_dias) as days
    into v_semana
    from public.weeks w
   where w.business_id = p_business_id
     and w.status = 'published'
     and p_dia between w.start_date and (w.start_date + 6)
   order by w.start_date desc limit 1;

  if found then
    v_idx := (p_dia - v_semana.start_date);   -- 0..6, posición del día base

    -- Columnas donde está asignado ese día (turno base y su nocturno)
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
      -- ¿La columna corresponde a este día del calendario?
      -- Los ids nocturnos son el id base + 'N'.
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

  -- Respaldo: horario general del negocio para ese día de la semana
  if jsonb_array_length(v_tramos) = 0 then
    v_tramos := coalesce(
      v_cfg->'fichaje'->'horarios'->DIAS[extract(isodow from p_dia)::int],
      '[]'::jsonb);
  end if;

  return v_tramos;
end;
$$;
grant execute on function public.turno_previsto(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------
--  B) Aviso de ENTRADA no fichada: ahora por turno de cada persona
-- ---------------------------------------------------------------------
create or replace function public.recordatorios_fichaje()
returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_total int := 0; r record; t jsonb;
  v_tz text; v_hoy date; v_ahora timestamptz := now();
begin
  -- ---------- 1) Salida no fichada ----------
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

  -- ---------- 2) Entrada no fichada (según SU turno del cuadrante) ----------
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
$$;

-- ---------------------------------------------------------------------
--  C) jornada_hoy: añade el previsto de HOY de cada persona (su turno)
-- ---------------------------------------------------------------------
create function public.jornada_hoy(p_business_id uuid)
returns table (worker_id uuid, name text, dentro boolean,
               desde timestamptz, seg_hoy numeric, tramos jsonb)
language plpgsql security definer set search_path = public
as $$
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
$$;
grant execute on function public.jornada_hoy(uuid) to authenticated;

-- ---------------------------------------------------------------------
--  D) kiosco_estado: cada trabajador con SU turno previsto de hoy
-- ---------------------------------------------------------------------
create or replace function public.kiosco_estado(p_device_token text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
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
        'tramos', public.turno_previsto(v_biz, w.id, v_hoy)
      ) as x
    from public.workers w
    left join lateral (
      select te.tipo, te.momento from public.time_entries te
       where te.worker_id = w.id
       order by te.momento desc limit 1
    ) ult on true
    where w.business_id = v_biz and w.active = true
  ) sub;

  return jsonb_build_object('workers', v_workers, 'margen_seg', v_margen,
                            'horarios', '{}'::jsonb);
end;
$$;
grant execute on function public.kiosco_estado(text) to anon, authenticated;


-- #####################################################################
--  CRON  ·  tareas programadas activas (volcado de cron.job)
-- #####################################################################
--   select cron.schedule('recordatorios-fichaje', '*/5 * * * *',
--                        'select public.recordatorios_fichaje();');


-- =====================================================================
-- =====================================================================
--  SCRIPTS PUNTUALES  ·  COMENTADOS A PROPÓSITO
-- =====================================================================
--  No son migraciones. Se ejecutaron una vez en su momento y NO deben
--  volver a ejecutarse. El primero BORRA TODOS LOS DATOS del negocio:
--  cuadrantes, vacaciones, solicitudes, avisos, tareas y trabajadores.
--  Se conservan solo como registro de lo que se hizo.
-- =====================================================================

-- ---------------------------------------------------------------------
--  [PELIGRO] Vaciar el negocio entero, dejando solo la cuenta de gestor.
--            NO EJECUTAR NUNCA sobre producción.
-- ---------------------------------------------------------------------
-- do $$
-- declare v_biz uuid;
-- begin
--   select id into v_biz from public.businesses where name = 'Asadero Las Brasas';
--   if v_biz is null then
--     raise exception 'No se encontró el negocio. Revisa el nombre.';
--   end if;
--
--   delete from public.weeks         where business_id = v_biz;
--   delete from public.vacations     where business_id = v_biz;
--   delete from public.requests      where business_id = v_biz;
--   delete from public.announcements where business_id = v_biz;
--   delete from public.tasks         where business_id = v_biz;
--   delete from public.invites       where business_id = v_biz;
--   delete from public.memberships
--    where business_id = v_biz and role = 'employee';
--   delete from public.workers       where business_id = v_biz;
--
--   raise notice 'Negocio vaciado. Tu cuenta de gestor sigue intacta.';
-- end $$;

-- ---------------------------------------------------------------------
--  Activar como probadores al empleado y al gestor de prueba
-- ---------------------------------------------------------------------
-- update public.profiles
--    set es_probador = true
--  where id in (
--    select id from auth.users
--     where email in (
--       'franciscojavierleonperezz@gmail.com',
--       'adm.asaderolasbrasas@gmail.com'
--     )
--  );

-- ---------------------------------------------------------------------
--  Diagnósticos de solo lectura (inofensivos)
-- ---------------------------------------------------------------------
-- Comprobar quién quedó activado como probador:
-- select u.email, p.es_probador
--   from public.profiles p
--   join auth.users u on u.id = p.id
--  where p.es_probador = true;

-- Inventario de datos por negocio:
-- select
--   b.name,
--   (select count(*) from public.workers       where business_id = b.id) as trabajadores,
--   (select count(*) from public.weeks         where business_id = b.id) as semanas,
--   (select count(*) from public.vacations     where business_id = b.id) as vacaciones,
--   (select count(*) from public.requests      where business_id = b.id) as solicitudes,
--   (select count(*) from public.announcements where business_id = b.id) as avisos,
--   (select count(*) from public.tasks         where business_id = b.id) as tareas,
--   (select count(*) from public.memberships   where business_id = b.id) as cuentas
-- from public.businesses b;

-- Listado de cuentas:
-- select id, email from auth.users;

-- Probar la RLS haciéndose pasar por un usuario concreto:
-- set local role authenticated;
-- set local request.jwt.claims to
--   '{"sub":"18d27f24-0340-4f46-8383-c9402230ea2c","role":"authenticated"}';
-- select public.is_member('f68fc9bb-664f-490f-af3f-dc8a549efd00') as soy_miembro;
