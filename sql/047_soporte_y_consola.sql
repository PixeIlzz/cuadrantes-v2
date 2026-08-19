-- =====================================================================
--  047 · Sesiones de soporte y detalle de empresa para la consola
-- =====================================================================
--  Entrar en la cuenta de un cliente es acceder a datos personales de
--  trabajadores que no te han contratado a ti. No se hace con un permiso
--  permanente y silencioso: se hace con una sesión que caduca sola, deja
--  constancia de quién entró, cuándo y por qué, y avisa al gestor.
--
--  Ese es el motivo de que ser admin NO te haga gestor de nada. Lo que te
--  da acceso es una sesión abierta, y solo mientras dura.
--
--  Requiere la 45 (es_admin) y la 46 (businesses.activo).
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. El registro de sesiones
-- ---------------------------------------------------------------------
--  No se borra nunca: es la prueba de qué se hizo y cuándo. Si algún día
--  un cliente pregunta quién entró en sus datos, la respuesta está aquí.

create table if not exists public.soporte_sesiones (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  admin_id    uuid not null references public.profiles(id) on delete cascade,
  motivo      text not null,
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz
);

create index if not exists soporte_biz_idx
  on public.soporte_sesiones (business_id, started_at desc);
create index if not exists soporte_vivas_idx
  on public.soporte_sesiones (admin_id, expires_at) where ended_at is null;

alter table public.soporte_sesiones enable row level security;
revoke all on public.soporte_sesiones from anon, authenticated;

-- El gestor del negocio SÍ puede ver quién ha entrado en su empresa.
-- Es lo que convierte esto en transparencia y no en una puerta trasera.
create policy "soporte: el gestor ve las de su negocio"
  on public.soporte_sesiones for select
  using (exists (
    select 1 from public.memberships m
     where m.business_id = soporte_sesiones.business_id
       and m.profile_id = auth.uid() and m.role = 'manager'));


-- ---------------------------------------------------------------------
--  2. ¿Hay sesión viva ahora mismo?
-- ---------------------------------------------------------------------

create or replace function public.soporte_activo(p_business_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.soporte_sesiones s
     where s.business_id = p_business_id
       and s.admin_id = auth.uid()
       and s.ended_at is null
       and s.expires_at > now()
  );
$function$;

revoke execute on function public.soporte_activo(uuid) from public, anon;
grant  execute on function public.soporte_activo(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  3. La excepción en la puerta
-- ---------------------------------------------------------------------
--  is_manager() e is_member() son la puerta de casi toda la RLS. Aquí se
--  añade la única vía por la que un admin llega a los datos de un cliente.
--
--  Ojo: en la rama de soporte NO se exige que el negocio esté activo. Es a
--  propósito: si suspendes una empresa por un problema, tienes que poder
--  entrar precisamente a resolverlo.

create or replace function public.is_manager(biz uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memberships m
      join public.businesses b on b.id = m.business_id
     where m.business_id = biz
       and m.profile_id = auth.uid()
       and m.role = 'manager'
       and b.activo
  )
  or public.soporte_activo(biz);
$function$;

create or replace function public.is_member(biz uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memberships m
      join public.businesses b on b.id = m.business_id
     where m.business_id = biz
       and m.profile_id = auth.uid()
       and b.activo
  )
  or public.soporte_activo(biz);
$function$;


-- ---------------------------------------------------------------------
--  4. Abrir y cerrar sesión de soporte
-- ---------------------------------------------------------------------

create or replace function public.soporte_abrir(
  p_business_id uuid, p_motivo text, p_minutos int default 60
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_nombre text;
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Escribe el motivo de la intervención.';
  end if;
  -- Tope duro: una sesión de soporte no dura una jornada entera
  if p_minutos is null or p_minutos < 5 or p_minutos > 240 then
    raise exception 'La duración tiene que estar entre 5 y 240 minutos.';
  end if;

  insert into public.soporte_sesiones (business_id, admin_id, motivo, expires_at)
  values (p_business_id, auth.uid(), trim(p_motivo),
          now() + make_interval(mins => p_minutos))
  returning id into v_id;

  -- Avisar al gestor. Que se entere por la app, no por casualidad.
  begin
    select b.name into v_nombre from public.businesses b where b.id = p_business_id;
    perform public.avisar_gestores(
      p_business_id, 'soporte',
      'Soporte técnico ha accedido',
      'Un administrador de StaffPoint ha abierto una sesión de soporte en '
        || coalesce(v_nombre, 'tu empresa') || '. Motivo: ' || trim(p_motivo) || '.',
      'ajustes');
  exception when others then null;
  end;

  return v_id;
end;
$function$;

revoke execute on function public.soporte_abrir(uuid, text, int) from public, anon;
grant  execute on function public.soporte_abrir(uuid, text, int) to authenticated;


create or replace function public.soporte_cerrar(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.soporte_sesiones s
     set ended_at = now()
   where s.business_id = p_business_id
     and s.admin_id = auth.uid()
     and s.ended_at is null;
end;
$function$;

revoke execute on function public.soporte_cerrar(uuid) from public, anon;
grant  execute on function public.soporte_cerrar(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  5. Mis sesiones vivas (para que la consola sepa dónde estoy dentro)
-- ---------------------------------------------------------------------

create or replace function public.soporte_mis_sesiones()
returns table (business_id uuid, negocio text, motivo text,
               started_at timestamptz, expires_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  return query
    select s.business_id, b.name, s.motivo, s.started_at, s.expires_at
      from public.soporte_sesiones s
      join public.businesses b on b.id = s.business_id
     where s.admin_id = auth.uid()
       and s.ended_at is null
       and s.expires_at > now()
     order by s.started_at desc;
end;
$function$;

revoke execute on function public.soporte_mis_sesiones() from public, anon;
grant  execute on function public.soporte_mis_sesiones() to authenticated;


-- ---------------------------------------------------------------------
--  6. Detalle de una empresa, para la consola
-- ---------------------------------------------------------------------
--  Información OPERATIVA: lo que necesitas para diagnosticar. Fíjate en lo
--  que NO devuelve: ni NIF, ni número de la Seguridad Social, ni pin_hash.
--  Esos son datos personales de los trabajadores y no hacen falta para
--  resolver una incidencia. Si algún día hicieran falta, se entra en modo
--  soporte, que deja registro.

create or replace function public.admin_negocio_detalle(p_business_id uuid)
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
    'negocio', (select jsonb_build_object(
                  'id', b.id, 'nombre', b.name, 'activo', b.activo,
                  'alta', b.created_at,
                  'tz', coalesce(b.config->'fichaje'->>'tz', 'Atlantic/Canary'),
                  'fichaje_activo', coalesce((b.config->'fichaje'->>'activo')::boolean, false),
                  'cierre_auto', coalesce((b.config->'fichaje'->>'cierre_auto_activo')::boolean, false),
                  'razon_social', b.config->'legal'->>'razon_social',
                  'cif', b.config->'legal'->>'cif',
                  'puestos', jsonb_array_length(coalesce(b.config->'roles','[]'::jsonb)),
                  'columnas', jsonb_array_length(coalesce(b.config->'days','[]'::jsonb)))
                from public.businesses b where b.id = p_business_id),

    'codigo_alta', (select jsonb_build_object('codigo', a.codigo, 'nota', a.nota,
                                              'usado', a.used_at)
                      from public.altas a where a.business_id = p_business_id),

    'cuentas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'email', u.email, 'rol', m.role,
                  'ultimo_acceso', u.last_sign_in_at) order by m.role, u.email), '[]'::jsonb)
                  from public.memberships m
                  join auth.users u on u.id = m.profile_id
                 where m.business_id = p_business_id),

    'equipo', (select coalesce(jsonb_agg(jsonb_build_object(
                 'nombre', w.name,
                 'activo', w.active,
                 'tiene_cuenta', (w.profile_id is not null),
                 'tiene_pin', (w.pin_hash is not null)) order by w.sort_order, w.name), '[]'::jsonb)
                 from public.workers w where w.business_id = p_business_id),

    'kioscos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'nombre', k.nombre, 'activo', k.activo,
                  'con_ips', (k.ips_permitidas is not null)) order by k.nombre), '[]'::jsonb)
                  from public.kioscos k where k.business_id = p_business_id),

    'actividad', jsonb_build_object(
       'semanas',   (select count(*) from public.weeks w where w.business_id = p_business_id),
       'fichajes',  (select count(*) from public.time_entries t where t.business_id = p_business_id),
       'ultimo_fichaje', (select max(t.momento) from public.time_entries t where t.business_id = p_business_id),
       'solicitudes_pendientes', (select count(*) from public.requests r
                                   where r.business_id = p_business_id and r.status = 'pending')),

    'soporte', (select coalesce(jsonb_agg(jsonb_build_object(
                  'motivo', s.motivo, 'inicio', s.started_at,
                  'fin', coalesce(s.ended_at, s.expires_at),
                  'viva', (s.ended_at is null and s.expires_at > now()))
                  order by s.started_at desc), '[]'::jsonb)
                  from public.soporte_sesiones s where s.business_id = p_business_id)
  ) into v;

  return v;
end;
$function$;

revoke execute on function public.admin_negocio_detalle(uuid) from public, anon;
grant  execute on function public.admin_negocio_detalle(uuid) to authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  1) Que sin sesión de soporte NO ves nada de un cliente. Como admin,
--     desde el SQL Editor haciéndote pasar por ti mismo:
--
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims to '{"sub":"TU_USER_ID","role":"authenticated"}';
-- select count(*) from public.workers where business_id = 'ID_DEL_CLIENTE';
-- rollback;
--
--     Debe dar 0.
--
--  2) Abrir soporte y repetir: ahora sí. Y al gestor del cliente le llega
--     una notificación.
--
--  3) Que el registro queda:
--
-- select * from public.soporte_sesiones order by started_at desc;
-- =====================================================================
