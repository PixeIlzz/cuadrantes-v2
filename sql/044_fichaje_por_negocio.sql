-- =====================================================================
--  044 · El fichaje se activa POR NEGOCIO, no por persona
-- =====================================================================
--  Hasta ahora la puerta era soy_probador(), que mira profiles.es_probador:
--  una marca GLOBAL de la cuenta. Eso servía para probar en casa, pero no
--  escala a varios clientes: al vender al segundo negocio habría que ir
--  marcando a mano a cada uno de sus empleados.
--
--  Pasa a ser un ajuste del negocio, como el cierre automático:
--    businesses.config.fichaje.activo  (por defecto false)
--
--  TRANSICIÓN SIN CORTES. La condición queda como
--      fichaje_activo(negocio)  OR  soy_probador()
--  para que hoy no cambie nada: el negocio nace con el flag apagado y los
--  probadores siguen viendo el módulo igual que ayer. El día que el PDF
--  legal esté validado, se enciende el interruptor del negocio desde
--  Ajustes → Fichaje y lo ve toda la plantilla. Cuando ya no quede ningún
--  probador, se puede quitar el OR y borrar es_probador.
--
--  Es DECIR: ejecutar esta migración no abre el fichaje a nadie nuevo.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. La nueva puerta
-- ---------------------------------------------------------------------

create or replace function public.fichaje_activo(p_business_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select (b.config->'fichaje'->>'activo')::boolean
       from public.businesses b where b.id = p_business_id),
    false);
$function$;

revoke execute on function public.fichaje_activo(uuid) from public, anon;
grant  execute on function public.fichaje_activo(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  2. Las políticas de time_entries y de la auditoría
-- ---------------------------------------------------------------------
--  Mismas condiciones que tenían, cambiando solo la puerta.

drop policy if exists "fich: empleado ve los suyos" on public.time_entries;
create policy "fich: empleado ve los suyos"
  on public.time_entries for select
  using (
    (public.fichaje_activo(business_id) or public.soy_probador())
    and (
      profile_id = auth.uid()
      or exists (select 1 from public.memberships m
                  where m.business_id = time_entries.business_id
                    and m.profile_id = auth.uid() and m.role = 'manager')
    )
  );

drop policy if exists "fich: gestor añade" on public.time_entries;
create policy "fich: gestor añade"
  on public.time_entries for insert
  with check (
    (public.fichaje_activo(business_id) or public.soy_probador())
    and exists (select 1 from public.memberships m
                 where m.business_id = time_entries.business_id
                   and m.profile_id = auth.uid() and m.role = 'manager')
  );

drop policy if exists "fich: gestor corrige" on public.time_entries;
create policy "fich: gestor corrige"
  on public.time_entries for update
  using (
    (public.fichaje_activo(business_id) or public.soy_probador())
    and exists (select 1 from public.memberships m
                 where m.business_id = time_entries.business_id
                   and m.profile_id = auth.uid() and m.role = 'manager')
  );

drop policy if exists "fich: gestor borra" on public.time_entries;
create policy "fich: gestor borra"
  on public.time_entries for delete
  using (
    (public.fichaje_activo(business_id) or public.soy_probador())
    and exists (select 1 from public.memberships m
                 where m.business_id = time_entries.business_id
                   and m.profile_id = auth.uid() and m.role = 'manager')
  );

drop policy if exists "audit: gestor lee" on public.time_entry_audit;
create policy "audit: gestor lee"
  on public.time_entry_audit for select
  using (
    (public.fichaje_activo(business_id) or public.soy_probador())
    and exists (select 1 from public.memberships m
                 where m.business_id = time_entry_audit.business_id
                   and m.profile_id = auth.uid() and m.role = 'manager')
  );


-- ---------------------------------------------------------------------
--  3. La guarda de dentro de fichar()
-- ---------------------------------------------------------------------
--  Cuidado: aquí el negocio se resuelve DESPUÉS de encontrar la ficha, así
--  que la comprobación va después de la búsqueda, no antes como estaba.

create or replace function public.fichar(p_business_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid; v_biz uuid;
begin
  select w.id, w.business_id into v_worker, v_biz
    from public.workers w
   where w.profile_id = auth.uid()
     and w.active
     and (p_business_id is null or w.business_id = p_business_id)
   limit 1;

  if v_worker is null then
    raise exception 'Tu cuenta no está vinculada a una ficha de trabajador.';
  end if;

  if not (public.fichaje_activo(v_biz) or public.soy_probador()) then
    raise exception 'El fichaje aún no está disponible.';
  end if;

  return public.fichar_worker(v_biz, v_worker, 'empleado', null, null, null);
end;
$function$;

revoke execute on function public.fichar(uuid) from public, anon;
grant  execute on function public.fichar(uuid) to authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  1) Que nada ha cambiado para quien ya lo usaba: entrar con la cuenta
--     de siempre y ver el fichaje igual que antes.
--
--  2) Estado del interruptor por negocio (debe salir vacío o false):
--
-- select name, config->'fichaje'->>'activo' as fichaje_activo
--   from public.businesses;
--
--  3) Encenderlo se hace desde la app: Ajustes → Fichaje. A mano sería:
--
-- update public.businesses
--    set config = jsonb_set(
--          coalesce(config, '{}'::jsonb), '{fichaje}',
--          coalesce(config->'fichaje', '{}'::jsonb) || '{"activo": true}'::jsonb,
--          true)
--  where name = 'Asadero Las Brasas';
--
--  NO lo enciendas hasta haber validado el PDF y el CSV con datos reales:
--  a partir de ese momento lo ve y lo usa toda la plantilla.
-- =====================================================================
