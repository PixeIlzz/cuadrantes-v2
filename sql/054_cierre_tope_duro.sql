-- =====================================================================
--  054 · El cierre automático nunca pasa del tope, y lo deja escrito
-- =====================================================================
--  Dos cambios sobre la migración 40:
--
--  1. `cierre_max_h` pasa de ser SOLO el respaldo (cuando no hay turno) a
--     ser un TOPE DURO. Antes, si el último tramo del turno acababa muy
--     lejos de la entrada —alguien que ficha a las 08:00 en un día cuyo
--     turno de noche termina a la 01:00— se le anotaban diecisiete horas.
--     Ahora, pase lo que pase, una jornada cerrada sola no supera el tope.
--
--  2. La nota dice POR QUÉ tiene esa hora. En un registro que se entrega a
--     inspección, «salida estimada» a secas no explica nada; ahora se
--     distingue si la hora sale del turno previsto o del tope.
--
--  Lo demás no cambia: sigue marcando estimado y origen 'auto', sigue
--  avisando al trabajador, y sigue sin tocar la entrada original.
-- =====================================================================

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
  v_salida timestamptz; v_limite timestamptz; v_tope timestamptz;
  v_nota text;
  v_ahora timestamptz := now();
begin
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
       and coalesce((b.config->'fichaje'->>'cierre_auto_activo')::boolean, false) = true
  loop
    v_dia := public.dia_laboral(r.business_id, r.worker_id, r.momento);
    v_tope := r.momento + make_interval(hours => r.max_h::int);

    v_tramos := public.turno_previsto(r.business_id, r.worker_id, v_dia);
    v_salida := null;
    v_nota := null;

    -- 1) Fin del último tramo de su turno
    if jsonb_array_length(coalesce(v_tramos, '[]'::jsonb)) > 0 then
      v_ultimo := v_tramos -> (jsonb_array_length(v_tramos) - 1);
      v_desde  := v_ultimo->>'desde';
      v_hasta  := v_ultimo->>'hasta';

      if coalesce(v_hasta,'') ~ '^\d{1,2}:\d{2}$'
         and coalesce(v_desde,'') ~ '^\d{1,2}:\d{2}$' then
        v_dia_fin := case when v_hasta::time <= v_desde::time
                          then v_dia + 1 else v_dia end;
        v_salida := (v_dia_fin::text || ' ' || v_hasta || ':00')::timestamp
                      at time zone r.tz;
        v_nota := 'Cierre automático: no se fichó la salida. Hora del fin de turno previsto.';
      end if;
    end if;

    -- 2) Sin turno, o con un fin anterior a la propia entrada
    if v_salida is null or v_salida <= r.momento then
      v_salida := v_tope;
      v_nota := 'Cierre automático: no se fichó la salida. Sin turno previsto, se aplica el máximo de '
                || r.max_h::text || ' h.';
    end if;

    -- 3) TOPE DURO. Da igual lo que diga el turno: una jornada que cierra
    --    sola no puede registrar más del máximo configurado.
    if v_salida > v_tope then
      v_salida := v_tope;
      v_nota := 'Cierre automático: no se fichó la salida. Limitado al máximo de '
                || r.max_h::text || ' h.';
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
      (r.business_id, r.worker_id, r.profile_id, 'salida', v_salida, true, 'auto', v_nota);

    v_total := v_total + 1;

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


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  Qué ha anotado y con qué explicación:
--
-- select w.name, te.momento, te.nota
--   from public.time_entries te join public.workers w on w.id = te.worker_id
--  where te.origen = 'auto'
--  order by te.momento desc limit 20;
--
--  El tope de cada negocio (12 si no está puesto):
--
-- select name, coalesce(config->'fichaje'->>'cierre_max_h','12') as tope_h
--   from public.businesses;
-- =====================================================================
