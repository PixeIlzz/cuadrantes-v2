-- =====================================================================
--  040 · Cierre automático de jornadas olvidadas
-- =====================================================================
--  El esquema lo daba por hecho desde la 17 —origen 'auto', columna
--  'estimado', acción 'cierre_auto' en la auditoría— pero nunca se
--  escribió. Consecuencia real: fichar_worker() coge el último fichaje
--  SIN filtrar por día, así que quien olvida la salida del viernes
--  convierte su entrada del sábado en la salida del viernes, y queda una
--  jornada de veinte horas en el registro legal.
--
--  CÓMO DECIDE LA HORA DE SALIDA
--    1. El fin de SU turno ese día, sacado de turno_previsto(). Es lo más
--       defendible: refleja lo que esa persona tenía que trabajar.
--       Sirve para multinegocio sin tocar nada: turno_previsto ya resuelve
--       por negocio, con su cuadrante, su config y su zona horaria.
--    2. Si no hay turno previsto (o el fin cae antes de la entrada):
--       entrada + cierre_max_h horas.
--
--  En los dos casos la fila se marca estimado = true y origen = 'auto', y
--  el trabajador recibe un aviso para revisarla. Si no le cuadra, la
--  corrige por el flujo de la 35 y el gestor la aprueba. La entrada
--  original NUNCA se toca.
--
--  OPT-IN POR NEGOCIO. Nace apagado: esto escribe en un registro legal, y
--  no se activa solo en la casa de nadie.
--
--  DESDE v75 SE ENCIENDE DESDE LA APP: Ajustes → Fichaje → «Cerrar
--  automáticamente las jornadas que se queden abiertas», con sus dos
--  parámetros al lado. El gestor no necesita tocar SQL. El PASO 3 de abajo
--  se conserva solo por si hay que hacerlo a mano o revisar el estado.
--
--  Ajustes en businesses.config.fichaje:
--    cierre_auto_activo  bool  ¿activar?           (por defecto false)
--    cierre_margen_h     num   cortesía tras el fin (por defecto 2)
--    cierre_max_h        num   tope sin turno       (por defecto 12)
--
--  (La clave antigua 'cierre_auto' de la 17 nunca llegó a usarse y se deja
--   en paz: guardaba una hora en texto y aquí haría falta un booleano.)
-- =====================================================================


-- ---------------------------------------------------------------------
--  PASO 1 · La función
-- ---------------------------------------------------------------------

create or replace function public.cerrar_jornadas_olvidadas()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total int := 0;
  r record;
  v_tramos jsonb; v_ultimo jsonb;
  v_desde text; v_hasta text;
  v_dia date; v_dia_fin date;
  v_salida timestamptz; v_limite timestamptz;
  v_ahora timestamptz := now();
begin
  -- Jornadas abiertas: trabajadores cuyo ÚLTIMO fichaje es una entrada
  for r in
    with ult as (
      select distinct on (te.worker_id)
             te.id, te.worker_id, te.business_id, te.tipo, te.momento
        from public.time_entries te
       order by te.worker_id, te.momento desc
    )
    select u.id as entry_id, u.worker_id, u.business_id, u.momento,
           w.profile_id,
           coalesce(nullif(b.config->'fichaje'->>'tz',''), 'Atlantic/Canary') as tz,
           coalesce(nullif(b.config->'fichaje'->>'cierre_margen_h','')::numeric, 2)  as margen_h,
           coalesce(nullif(b.config->'fichaje'->>'cierre_max_h','')::numeric, 12)    as max_h
      from ult u
      join public.workers w    on w.id = u.worker_id and w.active = true
      join public.businesses b on b.id = u.business_id
     where u.tipo = 'entrada'
       -- Opt-in: solo los negocios que lo hayan activado
       and coalesce((b.config->'fichaje'->>'cierre_auto_activo')::boolean, false) = true
  loop
    -- Día laboral al que pertenece esa entrada (respeta turnos de noche)
    v_dia := public.dia_laboral(r.business_id, r.worker_id, r.momento);

    v_tramos := public.turno_previsto(r.business_id, r.worker_id, v_dia);
    v_salida := null;

    -- 1) Fin del último tramo de su turno
    if jsonb_array_length(coalesce(v_tramos, '[]'::jsonb)) > 0 then
      v_ultimo := v_tramos -> (jsonb_array_length(v_tramos) - 1);
      v_desde  := v_ultimo->>'desde';
      v_hasta  := v_ultimo->>'hasta';

      if coalesce(v_hasta,'') ~ '^\d{1,2}:\d{2}$'
         and coalesce(v_desde,'') ~ '^\d{1,2}:\d{2}$' then
        -- Si el tramo cruza medianoche, el fin cae al día siguiente.
        -- '00:00' entra aquí: es menor que cualquier hora de inicio.
        v_dia_fin := case when v_hasta::time <= v_desde::time
                          then v_dia + 1 else v_dia end;
        v_salida := (v_dia_fin::text || ' ' || v_hasta || ':00')::timestamp
                      at time zone r.tz;
      end if;
    end if;

    -- 2) Respaldo: sin turno, o con un fin anterior a la propia entrada
    --    (p. ej. fichó cuando su turno ya había terminado)
    if v_salida is null or v_salida <= r.momento then
      v_salida := r.momento + make_interval(hours => r.max_h::int);
    end if;

    -- Cortesía: no se cierra a nadie que solo va tarde recogiendo
    v_limite := v_salida + make_interval(hours => r.margen_h::int);
    continue when v_ahora <= v_limite;

    -- Por si acaso: que no haya aparecido una salida por otra vía
    continue when exists (
      select 1 from public.time_entries te
       where te.worker_id = r.worker_id and te.momento > r.momento);

    insert into public.time_entries
      (business_id, worker_id, profile_id, tipo, momento, estimado, origen, nota)
    values
      (r.business_id, r.worker_id, r.profile_id, 'salida', v_salida, true, 'auto',
       'Cierre automático: no se fichó la salida');

    v_total := v_total + 1;

    -- Avisar para que la revise. Si falla el aviso, el cierre ya está
    -- guardado: no se pierde por un problema de notificaciones.
    begin
      perform public.crear_notif(
        r.business_id, r.profile_id, 'fichaje_cerrado',
        'Jornada cerrada automáticamente',
        'No registraste la salida del ' || to_char(v_dia, 'DD/MM')
          || '. Hemos anotado una estimada; revísala y corrígela si no cuadra.',
        'emp-fichaje');
    exception when others then
      null;
    end;
  end loop;

  return v_total;
end;
$function$;

revoke execute on function public.cerrar_jornadas_olvidadas() from public, anon, authenticated;


-- ---------------------------------------------------------------------
--  PASO 2 · Programarlo
-- ---------------------------------------------------------------------
--  Cada media hora basta: solo actúa horas después del fin previsto, así
--  que no gana nada mirando más a menudo.

select cron.schedule('cierre-jornadas', '*/30 * * * *',
                     'select public.cerrar_jornadas_olvidadas();');


-- =====================================================================
--  PASO 3 · Activarlo en el negocio  ·  HAZLO A MANO Y CUANDO QUIERAS
-- =====================================================================
--  Hasta que se ejecute esto, la función no cierra absolutamente nada:
--  recorre los negocios, ve que ninguno lo tiene activado y sale.
--
--  Antes de activar, conviene ver a quién afectaría. Esta consulta lista
--  las jornadas abiertas ahora mismo, sin tocar nada:
--
-- with ult as (
--   select distinct on (te.worker_id) te.worker_id, te.tipo, te.momento
--     from public.time_entries te order by te.worker_id, te.momento desc
-- )
-- select w.name, u.momento as entrada_sin_cerrar,
--        round(extract(epoch from (now() - u.momento)) / 3600, 1) as horas_abierta
--   from ult u join public.workers w on w.id = u.worker_id
--  where u.tipo = 'entrada' and w.active
--  order by u.momento;
--
--  Ojo: al activarlo, las jornadas que lleven días abiertas se cerrarán en
--  la siguiente pasada. Si hay basura vieja, mejor arreglarla antes a mano
--  o desde Solicitudes, para que el cierre no la dé por buena.
--
--  Para activarlo (sustituye el nombre del negocio):
--
-- update public.businesses
--    set config = jsonb_set(
--          config,
--          '{fichaje,cierre_auto_activo}',
--          'true'::jsonb,
--          true)
--  where name = 'Asadero Las Brasas';
--
--  Para comprobar que quedó puesto:
--
-- select name, config->'fichaje'->>'cierre_auto_activo' as activo,
--        config->'fichaje'->>'cierre_margen_h' as margen_h,
--        config->'fichaje'->>'cierre_max_h'    as max_h
--   from public.businesses;
--
--  Para probarlo sin esperar al cron:
--
-- select public.cerrar_jornadas_olvidadas();   -- devuelve cuántas cerró
--
--  Y para desactivarlo si algo no gusta:
--
-- update public.businesses
--    set config = jsonb_set(config, '{fichaje,cierre_auto_activo}', 'false'::jsonb, true);
-- =====================================================================
