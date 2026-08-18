-- =====================================================================
--  039 · El secreto del push sale del código
-- =====================================================================
--  trg_enviar_push() llevaba la URL del proyecto y un token ESCRITOS en su
--  cuerpo, visibles para cualquiera que pueda leer pg_proc.
--
--  Y peor: la Edge Function nunca comprobaba ese token. Es decir,
--  enviar-push era un endpoint público sin autenticar: cualquiera con la
--  URL podía mandar {notification_id} y disparar un push. Lo único que lo
--  protegía es que los ids son UUID aleatorios.
--
--  Esta migración es la mitad del arreglo. La otra mitad está en
--  edge/enviar-push/index.ts, que ahora SÍ valida la cabecera.
--
--  ORDEN DE EJECUCIÓN (importa):
--    1. Crear el secreto nuevo en Supabase → Edge Functions → Secrets,
--       con nombre PUSH_SECRET.
--    2. Desplegar la Edge Function nueva (edge/enviar-push/index.ts).
--    3. Ejecutar los PASOS 1 y 2 de este archivo.
--    4. Comprobar con el PASO 3.
--
--  Si se hace al revés, el push deja de funcionar entre medias.
-- =====================================================================


-- ---------------------------------------------------------------------
--  PASO 1 · Tabla de configuración interna
-- ---------------------------------------------------------------------
--  RLS activa y CERO políticas a propósito: nadie llega por la API. Solo
--  la alcanzan las funciones SECURITY DEFINER (que corren como el
--  propietario de la tabla y no pasan por RLS) y service_role.
--  Mismo patrón que fichaje_recordatorios y fichaje_avisos_entrada.

create table if not exists public.app_config (
  clave          text primary key,
  valor          text not null,
  actualizado_at timestamptz not null default now()
);

comment on table public.app_config is
  'Configuración interna que no debe vivir en el código. Sin políticas RLS: solo funciones SECURITY DEFINER y service_role.';

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;


-- ---------------------------------------------------------------------
--  PASO 2 · La función lee el secreto en vez de llevarlo dentro
-- ---------------------------------------------------------------------
--  Falla en silencio si no hay configuración: quedarse sin push es un
--  fastidio, pero tumbar el insert de la notificación sería mucho peor.
--  Mismo criterio que los begin/exception de crear_correccion.

create or replace function public.trg_enviar_push()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_url text; v_key text;
begin
  select c.valor into v_url from public.app_config c where c.clave = 'push_url';
  select c.valor into v_key from public.app_config c where c.clave = 'push_key';

  -- Sin configurar: no se manda push, pero la notificación se guarda igual
  if v_url is null or v_key is null then
    return NEW;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('notification_id', NEW.id)
    );
  exception when others then
    null;   -- un fallo de push no puede tumbar la notificación
  end;

  return NEW;
end;
$function$;


-- =====================================================================
--  PASO 3 · Rellenar a mano y ejecutar  ·  CON EL TOKEN NUEVO
-- =====================================================================
--  Descomentar, sustituir los dos valores y ejecutar. El token tiene que
--  ser EXACTAMENTE el mismo que el secreto PUSH_SECRET de la Edge
--  Function. El viejo no vale para nada: no lo reutilices, que ha estado en
--  texto plano dentro de la función.
--
--  Generar uno nuevo, por ejemplo:
--    select encode(gen_random_bytes(32), 'hex');
--
-- insert into public.app_config (clave, valor) values
--   ('push_url', 'https://TU_PROJECT_REF.supabase.co/functions/v1/enviar-push'),
--   ('push_key', 'EL_TOKEN_NUEVO')
-- on conflict (clave) do update
--   set valor = excluded.valor, actualizado_at = now();


-- =====================================================================
--  PASO 4 · Comprobar
-- =====================================================================
--  a) Que la configuración está puesta (debe devolver 2 filas, y el valor
--     de push_key NO debe ser el token viejo):
--
-- select clave, left(valor, 12) || '…' as valor, actualizado_at
--   from public.app_config order by clave;
--
--  b) Que la función ya no lleva el secreto dentro (no debe aparecer
--     ninguna cadena que parezca un token):
--
-- select pg_get_functiondef('public.trg_enviar_push'::regproc);
--
--  c) Que el push sigue llegando: provocar una notificación de verdad
--     (publicar una semana, o enviar una solicitud) y ver si llega al
--     móvil. Si no llega, revisar los logs de la Edge Function: un 401
--     significa que PUSH_SECRET y app_config.push_key no coinciden.
