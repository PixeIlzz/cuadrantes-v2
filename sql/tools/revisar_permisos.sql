-- =====================================================================
--  REVISAR PERMISOS DE FUNCIONES  ·  herramienta, NO es una migración
-- =====================================================================
--  Por qué importa: en Postgres una función recién creada es EJECUTABLE
--  POR `public` mientras no se le haga un revoke explícito. Y en este
--  esquema casi todas son SECURITY DEFINER, o sea que corren con permisos
--  del propietario. Una función interna sin revoke es una puerta abierta.
--
--  Solo son SELECT: no cambia nada.
-- =====================================================================


-- ▓▓▓ 1 · Qué está abierto a quién
--  proacl null = nadie tocó los permisos = EJECUTABLE POR PUBLIC.
--  Esas salen primero, que son las que hay que mirar.

select p.proname                                   as funcion,
       pg_get_function_identity_arguments(p.oid)   as argumentos,
       p.prosecdef                                 as security_definer,
       case when p.proacl is null
            then '⚠ PUBLIC (por defecto, sin revoke)'
            else array_to_string(p.proacl, '  |  ')
       end                                          as permisos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
 order by (p.proacl is null) desc, p.prosecdef desc, p.proname;


-- ▓▓▓ 2 · Las que más preocupan, en corto
--  avisar_gestores y crear_notif insertan notificaciones con título y
--  cuerpo arbitrarios en el negocio que les pases, y no comprueban quién
--  llama. Si están abiertas, cualquier usuario con sesión puede mandar
--  push a los gestores de cualquier negocio.
--
--  turno_previsto, tiene_turno_hoy y dia_laboral no comprueban nada
--  tampoco: filtran el horario de cualquier trabajador de cualquier
--  negocio a quien sepa dos UUID. Menos grave, pero es fuga entre
--  inquilinos y con multinegocio deja de ser aceptable.
--
--  fichar_worker, fichar_kiosco y recordatorios_fichaje deberían estar
--  cerradas ya; esto lo confirma.

select p.proname as funcion,
       case when p.proacl is null
            then '⚠ ABIERTA A PUBLIC'
            else array_to_string(p.proacl, '  |  ')
       end as permisos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'avisar_gestores', 'crear_notif', 'quiere_notif',
     'turno_previsto', 'tiene_turno_hoy', 'dia_laboral',
     'fichar_worker', 'fichar_kiosco', 'recordatorios_fichaje',
     'cerrar_jornadas_olvidadas', 'handle_new_user', 'avisar_cambio_semana'
   )
 order by (p.proacl is null) desc, p.proname;


-- =====================================================================
--  CÓMO SE LEE UNA ACL
-- =====================================================================
--  postgres=X/postgres        el propietario puede ejecutarla
--  =X/postgres                ⚠ PUBLIC puede ejecutarla
--  authenticated=X/postgres   los usuarios con sesión
--  anon=X/postgres            ⚠ cualquiera, sin sesión
--  service_role=X/postgres    solo las Edge Functions
--
--  La X es el permiso EXECUTE. Lo de después de la barra es quién lo
--  concedió.
--
--  Y la trampa: si la columna sale NULL no significa "sin permisos", sino
--  justo lo contrario — que nadie los ha tocado nunca y por tanto vale el
--  defecto de Postgres, que es PUBLIC.
-- =====================================================================
