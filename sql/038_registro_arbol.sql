-- =====================================================================
--  038 · Una sola llamada para el árbol del registro
-- =====================================================================
--  El árbol pedía los fichajes de 2 años y luego lanzaba una RPC
--  turno_previsto POR CADA DÍA con fichajes (Promise.all). Con un año de
--  datos son cientos de peticiones HTTP para pintar una pantalla.
--
--  registro_arbol() devuelve, en una sola llamada y ya agrupado por día
--  laboral: los fichajes de ese día y su turno previsto.
--
--  Lo que NO se mueve al servidor, a propósito: las horas trabajadas, el
--  saldo y el retraso se siguen calculando en el navegador. Son las cifras
--  que acaban en el PDF que se entrega a inspección, y reescribir esa
--  aritmética en SQL solo añadiría una segunda implementación que puede
--  divergir de la primera. Además el contador de una jornada abierta tiene
--  que correr en vivo en el cliente; congelado en el servidor saldría viejo.
--  El problema era el número de peticiones, y eso es lo que se arregla:
--  N+1 peticiones pasan a ser 1.
--
--  turno_previsto se sigue llamando una vez por día, pero dentro del
--  servidor. dia_laboral se llama por fila y es barato: sale corriendo si
--  la hora es posterior al corte de madrugada, así que solo hace trabajo
--  de verdad con los fichajes de madrugada.
--
--  CUIDADO con el error 42702: la función declara columnas de salida
--  llamadas dia/tramos/items, así que dentro del cuerpo esos nombres son
--  variables. Todo va cualificado con alias (b., a.) y los nombres
--  internos son distintos (d, lista) para que no haya ambigüedad posible.
-- =====================================================================

create or replace function public.registro_arbol(
  p_worker_id uuid,
  p_desde     date,
  p_hasta     date
)
returns table (dia date, tramos jsonb, items jsonb)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_biz uuid;
begin
  select w.business_id into v_biz from public.workers w where w.id = p_worker_id;
  if v_biz is null then raise exception 'Trabajador no válido'; end if;

  -- Permiso: el propio trabajador o un gestor del negocio
  if not (
    exists (select 1 from public.workers w
             where w.id = p_worker_id and w.profile_id = auth.uid())
    or public.is_manager(v_biz)
  ) then
    raise exception 'Sin acceso';
  end if;

  return query
  with base as (
    select te.id       as te_id,
           te.tipo     as te_tipo,
           te.momento  as te_momento,
           te.estimado as te_estimado,
           te.origen   as te_origen,
           te.nota     as te_nota,
           public.dia_laboral(v_biz, p_worker_id, te.momento) as d
      from public.time_entries te
     where te.worker_id = p_worker_id
       -- Margen de un día por cada lado: la madrugada puede reasignarse
       and te.momento >= (p_desde - 1)::timestamp
       and te.momento <  (p_hasta + 2)::timestamp
  ),
  agrupado as (
    select b.d,
           jsonb_agg(
             jsonb_build_object(
               'id',       b.te_id,
               'tipo',     b.te_tipo,
               'momento',  b.te_momento,
               'estimado', b.te_estimado,
               'origen',   b.te_origen,
               'nota',     b.te_nota
             ) order by b.te_momento
           ) as lista
      from base b
     -- El margen de arriba puede traer días fuera del rango pedido
     where b.d between p_desde and p_hasta
     group by b.d
  )
  select a.d,
         public.turno_previsto(v_biz, p_worker_id, a.d),
         a.lista
    from agrupado a
   order by a.d;
end;
$function$;

revoke execute on function public.registro_arbol(uuid, date, date) from public, anon;
grant  execute on function public.registro_arbol(uuid, date, date) to authenticated;

-- fichajes_por_jornada() se queda: ya no la usa nadie después de este cambio,
-- pero borrar una función en producción no aporta nada. Retirarla cuando el
-- árbol lleve un tiempo funcionando con la nueva.
