-- =====================================================================
--  045 · Crear un negocio deja de ser libre
-- =====================================================================
--  Con la v79 cualquiera que se registre en la app puede crear un negocio.
--  Para un SaaS que se vende eso no vale: da de alta clientes que no has
--  vendido, llena la base de datos de negocios de prueba y no hay forma de
--  saber quién es cliente y quién no.
--
--  A partir de aquí hace falta un CÓDIGO DE ALTA que generas tú. Uno por
--  cliente vendido. Es el mismo patrón que ya usan las invitaciones de
--  empleado, que funcionan bien y son fáciles de entender.
--
--  Tú, como administrador, puedes crear negocios sin código.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Quién es administrador de la plataforma
-- ---------------------------------------------------------------------
--  No existía ese concepto: había 'manager' y 'employee', pero los dos son
--  roles DENTRO de un negocio. Esto es el dueño del servicio.

alter table public.profiles
  add column if not exists es_admin boolean not null default false;

comment on column public.profiles.es_admin is
  'Administrador de la plataforma (no de un negocio): puede emitir códigos de alta.';


-- ---------------------------------------------------------------------
--  2. Los códigos de alta
-- ---------------------------------------------------------------------
--  RLS activa y sin políticas: solo se llega por las funciones de abajo.

create table if not exists public.altas (
  codigo      text primary key,
  nota        text,                       -- para quién es: "Bar Manolo, Telde"
  expires_at  timestamptz not null default (now() + interval '90 days'),
  used_at     timestamptz,
  used_by     uuid references public.profiles(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null
);

alter table public.altas enable row level security;
revoke all on public.altas from anon, authenticated;


-- ---------------------------------------------------------------------
--  3. Emitir un código (solo administrador)
-- ---------------------------------------------------------------------

create or replace function public.crear_codigo_alta(
  p_nota text default null, p_dias int default 90
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_code text; intentos int := 0;
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  loop
    -- Mismo alfabeto que las invitaciones: sin vocales ni 0/O ni 1/I
    v_code := (
      select string_agg(substr('BCDFGHJKMNPQRSTVWXYZ23456789',
                               floor(random()*28)::int + 1, 1), '')
        from generate_series(1,8)
    );
    exit when not exists (select 1 from public.altas a where a.codigo = v_code);
    intentos := intentos + 1;
    if intentos > 20 then raise exception 'No se pudo generar un código'; end if;
  end loop;

  insert into public.altas (codigo, nota, expires_at, created_by)
  values (v_code, nullif(trim(p_nota), ''), now() + (p_dias || ' days')::interval, auth.uid());

  return v_code;
end;
$function$;

revoke execute on function public.crear_codigo_alta(text, int) from public, anon;
grant  execute on function public.crear_codigo_alta(text, int) to authenticated;


-- ---------------------------------------------------------------------
--  4. Ver los códigos emitidos (solo administrador)
-- ---------------------------------------------------------------------

create or replace function public.codigos_alta()
returns table (codigo text, nota text, expires_at timestamptz,
               used_at timestamptz, negocio text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false) then
    raise exception 'Sin acceso';
  end if;

  return query
    select a.codigo, a.nota, a.expires_at, a.used_at, b.name
      from public.altas a
      left join public.businesses b on b.id = a.business_id
     order by a.created_at desc;
end;
$function$;

revoke execute on function public.codigos_alta() from public, anon;
grant  execute on function public.codigos_alta() to authenticated;


-- ---------------------------------------------------------------------
--  5. create_business exige código
-- ---------------------------------------------------------------------
--  Hay que DROP: la función gana un parámetro. El default deja que el
--  cliente siga llamándola igual mientras no se despliegue la v80.

drop function if exists public.create_business(text);

create or replace function public.create_business(
  p_name text, p_codigo text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_admin boolean; v_alta public.altas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Ponle un nombre al negocio';
  end if;

  v_admin := coalesce((select p.es_admin from public.profiles p where p.id = auth.uid()), false);

  -- El administrador crea sin código; el resto necesita uno vivo
  if not v_admin then
    if coalesce(trim(p_codigo), '') = '' then
      raise exception 'Necesitas un código de alta para crear un negocio.';
    end if;

    select * into v_alta from public.altas
     where codigo = upper(trim(p_codigo)) for update;

    if not found then                raise exception 'Ese código no es válido.'; end if;
    if v_alta.used_at is not null then raise exception 'Ese código ya se ha usado.'; end if;
    if v_alta.expires_at < now() then  raise exception 'Ese código ha caducado.'; end if;
  end if;

  insert into public.businesses (name) values (trim(p_name)) returning id into v_id;

  insert into public.memberships (business_id, profile_id, role)
  values (v_id, auth.uid(), 'manager');

  if not v_admin then
    update public.altas
       set used_at = now(), used_by = auth.uid(), business_id = v_id
     where codigo = v_alta.codigo;
  end if;

  return v_id;
end;
$function$;

revoke execute on function public.create_business(text, text) from public, anon;
grant  execute on function public.create_business(text, text) to authenticated;


-- =====================================================================
--  PASO MANUAL · Hazte administrador
-- =====================================================================
--  Sin esto no podrás emitir códigos, y como create_business ya los exige,
--  nadie podrá crear negocios. Ejecútalo justo después de la migración:
--
-- update public.profiles
--    set es_admin = true
--  where id = (select id from auth.users where email = 'franciscojavierleonperezz@gmail.com');
--
--  Comprobar:
--
-- select u.email, p.es_admin from public.profiles p
--   join auth.users u on u.id = p.id where p.es_admin;
--
--  Y para emitir el primer código:
--
-- select public.crear_codigo_alta('Negocio de pruebas', 30);
--
--  Ver los emitidos:
--
-- select * from public.codigos_alta();
-- =====================================================================
