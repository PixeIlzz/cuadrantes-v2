-- =====================================================================
--  043 · fichar() deja de asumir un solo negocio
-- =====================================================================
--  Tenía dos problemas, los dos mortales en cuanto haya un segundo
--  cliente:
--
--  1. `'Atlantic/Canary'` escrito a fuego para decidir qué es "hoy",
--     mientras el resto del módulo lee config->'fichaje'->>'tz'. Un bar
--     de Madrid o de Canarias en invierno calculaba mal el día.
--  2. Buscaba la ficha con `where w.profile_id = auth.uid() limit 1`, sin
--     filtrar por negocio. Quien tuviera ficha en dos, fichaba en uno
--     arbitrario — el que devolviese Postgres primero.
--
--  ARREGLO: en vez de parchear la lógica, se delega en fichar_worker(),
--  que ya la tiene resuelta y es la que usa el kiosco. Así app y kiosco
--  se comportan EXACTAMENTE igual, que es lo que uno espera de un
--  registro legal, y desaparece la copia duplicada del alternado
--  entrada/salida.
--
--  Efecto secundario buscado: fichar_worker mira el último fichaje SIN
--  filtrar por día, lo que soporta turnos que cruzan medianoche. Antes
--  fichar() miraba solo los de hoy, así que a quien entraba a las 20:00 y
--  salía a la 01:00 le creaba una segunda ENTRADA en vez de la salida.
--  Los olvidos los recoge el cierre automático (migración 40).
--
--  Hay que DROP antes: la función pasa a tener un parámetro, y dejar las
--  dos versiones convivir haría ambigua la llamada sin argumentos.
-- =====================================================================

drop function if exists public.fichar();

create or replace function public.fichar(p_business_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid; v_biz uuid;
begin
  if not public.soy_probador() then
    raise exception 'El fichaje aún no está disponible.';
  end if;

  -- Su ficha EN ESE negocio. El parámetro admite null por compatibilidad
  -- con clientes viejos que aún llamen sin argumentos: en ese caso se
  -- comporta como antes y coge la primera que encuentre.
  select w.id, w.business_id into v_worker, v_biz
    from public.workers w
   where w.profile_id = auth.uid()
     and w.active
     and (p_business_id is null or w.business_id = p_business_id)
   limit 1;

  if v_worker is null then
    raise exception 'Tu cuenta no está vinculada a una ficha de trabajador.';
  end if;

  -- Toda la lógica de alternar entrada/salida vive en un solo sitio
  return public.fichar_worker(v_biz, v_worker, 'empleado', null, null, null);
end;
$function$;

revoke execute on function public.fichar(uuid) from public, anon;
grant  execute on function public.fichar(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  kiosco_estado() devuelve también la zona horaria del local
-- ---------------------------------------------------------------------
--  La tablet está deslogueada: no puede leer businesses.config, así que
--  tenía la zona escrita a fuego en el cliente y pintaba el reloj y las
--  horas de entrada en hora canaria fuese cual fuese el negocio.
--  La función ya calculaba v_tz para sus cuentas; solo faltaba mandarla.
--  Único cambio: una clave más en el jsonb de salida.

create or replace function public.kiosco_estado(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        'tramos', public.turno_previsto(v_biz, w.id, v_hoy),
        'seg_hoy', coalesce(hoy.seg, 0)
      ) as x
    from public.workers w
    left join lateral (
      select te.tipo, te.momento from public.time_entries te
       where te.worker_id = w.id
       order by te.momento desc limit 1
    ) ult on true
    left join lateral (
      select sum(extract(epoch from (
               coalesce(case when p.sig_tipo = 'salida' then p.sig end, now()) - p.momento))) as seg
        from (
          select te.tipo, te.momento,
                 lead(te.momento) over (order by te.momento) as sig,
                 lead(te.tipo)    over (order by te.momento) as sig_tipo
            from public.time_entries te
           where te.worker_id = w.id
        ) p
       where p.tipo = 'entrada'
         and (p.momento at time zone v_tz)::date = v_hoy
    ) hoy on true
    where w.business_id = v_biz and w.active = true
  ) sub;

  return jsonb_build_object('workers', v_workers, 'margen_seg', v_margen,
                            'tz', v_tz, 'horarios', '{}'::jsonb);
end;
$function$;

revoke execute on function public.kiosco_estado(text) from public;
grant  execute on function public.kiosco_estado(text) to anon, authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  1) Que solo queda una versión de la función:
--
-- select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'fichar';
--
--     Debe devolver UNA fila: fichar(uuid).
--
--  2) En la app, con cuenta de empleado: fichar entrada, ver el contador
--     correr, fichar salida. Y comprobar que en Mi registro sale la
--     jornada con su hora correcta.
--
--  3) El valor de retorno cambia de {id, tipo, momento} a {tipo, momento}.
--     El cliente solo usaba tipo y momento, así que no afecta; queda
--     anotado por si alguna vez hiciera falta el id.
-- =====================================================================
