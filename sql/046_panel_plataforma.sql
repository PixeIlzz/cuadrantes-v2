-- =====================================================================
--  046 · Panel de plataforma: ver y gobernar los negocios
-- =====================================================================
--  Objetivo: dejar de entrar a Supabase para las tareas del día a día.
--  Este es el primer trozo: ver todas las empresas con sus cifras y poder
--  suspender o reactivar una sin tocar la base de datos a mano.
--
--  Requiere la 45 (profiles.es_admin y los códigos de alta).
--
--  LO QUE NO HACE, a propósito: entrar como si fueras el cliente ("modo
--  soporte"). Eso no es una función más — es acceso de un tercero a datos
--  personales de trabajadores que no lo han consentido. Necesita registro
--  de quién entró, cuándo y por qué, y probablemente aviso al cliente.
--  Va aparte y con cabeza.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Estado del negocio
-- ---------------------------------------------------------------------
--  Suspender NO borra nada: los datos siguen intactos y al reactivar
--  vuelve todo. Es lo que hace falta para un impago.

alter table public.businesses
  add column if not exists activo boolean not null default true;

comment on column public.businesses.activo is
  'false = suspendido (impago, baja). Los datos se conservan; solo se corta el acceso.';


-- ---------------------------------------------------------------------
--  2. La suspensión se aplica de verdad
-- ---------------------------------------------------------------------
--  is_member() e is_manager() son la puerta de CASI TODAS las políticas
--  RLS del esquema, así que basta con añadir la condición aquí para que un
--  negocio suspendido quede sin acceso en bloque.
--
--  Cuidado: esto es exactamente por eso lo más delicado del archivo. Si se
--  equivoca la condición, se queda todo el mundo fuera. Por eso `activo`
--  nace NOT NULL DEFAULT true: los negocios existentes siguen dentro.
--
--  Los administradores NO entran aquí. Ser admin de la plataforma no te
--  convierte en gestor de todos los negocios: el acceso a los datos de un
--  cliente tiene que ser explícito y quedar registrado, no ambiente.

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
  );
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
  );
$function$;


-- ---------------------------------------------------------------------
--  3. La lista de empresas, para el panel
-- ---------------------------------------------------------------------
--  "Último acceso" sale de auth.users.last_sign_in_at, que es el dato real
--  de Supabase. No hay que inventarse una tabla de sesiones para eso.

create or replace function public.admin_negocios()
returns table (
  id            uuid,
  nombre        text,
  activo        boolean,
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
    select b.id,
           b.name,
           b.activo,
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
     order by b.activo desc, b.created_at desc;
end;
$function$;

revoke execute on function public.admin_negocios() from public, anon;
grant  execute on function public.admin_negocios() to authenticated;


-- ---------------------------------------------------------------------
--  4. Suspender y reactivar
-- ---------------------------------------------------------------------

create or replace function public.admin_estado_negocio(
  p_business_id uuid, p_activo boolean
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  update public.businesses set activo = p_activo where id = p_business_id;
end;
$function$;

revoke execute on function public.admin_estado_negocio(uuid, boolean) from public, anon;
grant  execute on function public.admin_estado_negocio(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
--  5. ¿Soy administrador de la plataforma?
-- ---------------------------------------------------------------------
--  Para que la app sepa si pintar el panel. No revela nada de nadie.

create or replace function public.soy_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false);
$function$;

revoke execute on function public.soy_admin() from public, anon;
grant  execute on function public.soy_admin() to authenticated;


-- =====================================================================
--  PASO MANUAL · Dar de alta a los administradores
-- =====================================================================
--  La cuenta tiene que EXISTIR ya (haberse registrado al menos una vez en
--  la app), porque profiles se crea al registrarse.
--
-- update public.profiles
--    set es_admin = true
--  where id in (
--    select id from auth.users
--     where email in (
--       'franciscojavierleonperezz@gmail.com',
--       'pixellzdev04@gmail.com'
--     )
--  );
--
--  Comprobar (deben salir las dos):
--
-- select u.email, p.es_admin
--   from public.profiles p join auth.users u on u.id = p.id
--  where p.es_admin;
--
--  Si alguna no aparece, esa cuenta todavía no se ha registrado en la app.
-- =====================================================================


-- =====================================================================
--  COMPROBAR LA SUSPENSIÓN
-- =====================================================================
--  Con el negocio de pruebas, y con su gestor, no contigo:
--
-- select public.admin_estado_negocio('ID_DEL_NEGOCIO_DE_PRUEBAS', false);
--
--  Ese gestor debe dejar de ver sus datos (la app le dirá que no tiene
--  negocio). Reactivar:
--
-- select public.admin_estado_negocio('ID_DEL_NEGOCIO_DE_PRUEBAS', true);
--
--  Y confirmar que los datos siguen ahí, que es la clave de "suspender sin
--  borrar": el trabajador y sus fichajes vuelven intactos.
-- =====================================================================
