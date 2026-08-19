-- =====================================================================
--  042 · Tres agujeros de aislamiento entre personas y negocios
-- =====================================================================
--  Los tres salieron de la revisión del 2026-08-19. Ninguno cambia la
--  arquitectura: son dos políticas y unos permisos de columna.
--
--  A) Cualquier empleado podía leer el pin_hash de sus compañeros.
--  B) Cualquier empleado podía escribir fichajes con la hora que quisiera.
--  C) Cualquier empleado podía fabricar una corrección sobre el fichaje
--     de otro y colársela al gestor para que la aprobara.
-- =====================================================================


-- ---------------------------------------------------------------------
--  A) Permisos de columna en `workers`
-- ---------------------------------------------------------------------
--  La política de SELECT es is_member(business_id), y la RLS es POR FILA:
--  no limita columnas. Con `select=pin_hash` por la API, un empleado se
--  llevaba los hashes de todo el equipo. Un PIN de 4 dígitos son 10.000
--  combinaciones: bcrypt no salva eso fuera de línea. Con el PIN de otro
--  se ficha por él en el kiosco.
--  Por la misma vía se leían el NIF y el nº de la Seguridad Social.
--
--  OJO: no vale `revoke select (columna)` a secas. Si el rol tiene el
--  privilegio a nivel de TABLA, ese cubre todas las columnas y el revoke
--  por columna no hace nada. Hay que quitar el de tabla y conceder la
--  lista explícita.

--  Lectura: fuera pin_hash, pin_intentos, pin_bloqueado_hasta, nif y nss.
revoke select on public.workers from anon, authenticated;
grant  select (id, business_id, name, weekly_shifts, active,
               profile_id, sort_order, created_at, full_name)
  on public.workers to authenticated;

--  Escritura: el gestor sigue pudiendo rellenar NIF y NSS (los escribe,
--  aunque para leerlos use la RPC de abajo). Lo que NO puede nadie desde
--  el cliente es tocar el PIN de otro: un gestor que pusiera un pin_hash
--  conocido podría fichar en el kiosco haciéndose pasar por su empleado,
--  y eso quedaría como un fichaje normal de esa persona.
--  El empleado se pone el suyo por set_mi_pin(), que es SECURITY DEFINER.
revoke update on public.workers from anon, authenticated;
grant  update (name, weekly_shifts, active, sort_order, full_name, nif, nss)
  on public.workers to authenticated;

revoke insert on public.workers from anon, authenticated;
grant  insert (business_id, name, weekly_shifts, active, sort_order,
               full_name, nif, nss)
  on public.workers to authenticated;

--  DELETE se queda como estaba: la RLS ya lo limita al gestor del negocio.

--  Y el gestor necesita leer NIF y NSS para el PDF y el CSV legales.
create or replace function public.equipo_datos_legales(p_business_id uuid)
returns table (worker_id uuid, nif text, nss text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_manager(p_business_id) then
    raise exception 'Sin acceso';
  end if;

  return query
    select w.id, w.nif, w.nss
      from public.workers w
     where w.business_id = p_business_id
       and w.active;
end;
$function$;

revoke execute on function public.equipo_datos_legales(uuid) from public, anon;
grant  execute on function public.equipo_datos_legales(uuid) to authenticated;


-- ---------------------------------------------------------------------
--  B) El empleado deja de poder escribir en time_entries
-- ---------------------------------------------------------------------
--  La política solo exigía que el profile_id fuese el suyo. No decía nada
--  de momento, worker_id, origen ni estimado, así que un POST a mano
--  permitía inventarse una entrada de hace tres semanas a la hora que
--  conviniera, e incluso atribuirla a OTRO trabajador poniendo su
--  worker_id. Justo lo contrario de "la hora la pone el servidor".
--
--  No hace falta sustituirla por nada: fichar() es SECURITY DEFINER y se
--  salta la RLS, así que fichar desde la app sigue igual. El kiosco va por
--  fichar_worker(), que tampoco pasa por aquí.

drop policy if exists "fich: empleado ficha lo suyo" on public.time_entries;

--  El gestor conserva insert/update/delete: son las correcciones, y el
--  trigger de auditoría las registra con quién, cuándo, antes y después.
--  Falta la de INSERT del gestor, que se apoyaba en la que acabamos de
--  borrar. Se crea explícita para no dejarle sin poder añadir un fichaje
--  olvidado desde la pantalla de corrección.
drop policy if exists "fich: gestor añade" on public.time_entries;
create policy "fich: gestor añade"
  on public.time_entries for insert
  with check (soy_probador() and exists (
    select 1 from public.memberships m
     where m.business_id = time_entries.business_id
       and m.profile_id = auth.uid() and m.role = 'manager'));


-- ---------------------------------------------------------------------
--  C) Las correcciones solo entran por crear_correccion()
-- ---------------------------------------------------------------------
--  La política de INSERT en requests comprobaba worker_id y status, pero
--  no `type`, ni `entry_id`, ni `fix`. Un POST directo con type='timefix'
--  y el entry_id de un compañero creaba una corrección de aspecto normal;
--  si el gestor la aprobaba, resolve_timefix modificaba el fichaje ajeno.
--
--  crear_correccion() sí valida que el fichaje sea tuyo, y es SECURITY
--  DEFINER, así que sigue funcionando con la política cerrada.

drop policy if exists "solicitudes: el empleado crea las suyas, siempre pendientes" on public.requests;
create policy "solicitudes: el empleado crea las suyas, siempre pendientes"
  on public.requests for insert
  with check (
    worker_id = public.my_worker_id(business_id)
    and status = 'pending'
    and manager_note is null
    and resolved_at is null
    -- Las correcciones de fichaje NO se crean a mano: van por
    -- crear_correccion(), que comprueba que el fichaje sea suyo.
    and type <> 'timefix'
    and entry_id is null
    and fix is null
  );


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  1) Que las columnas sensibles ya no se pueden leer. Como authenticated:
--
-- set local role authenticated;
-- set local request.jwt.claims to '{"sub":"UN_ID_DE_EMPLEADO","role":"authenticated"}';
-- select pin_hash from public.workers limit 1;    -- debe dar: permission denied
-- select id, name from public.workers limit 1;    -- debe funcionar
-- reset role;
--
--  2) Que el empleado no puede insertar fichajes: intentar un POST a
--     /rest/v1/time_entries desde su sesión debe devolver 42501.
--
--  3) En la app, con cuenta de GESTOR: abrir Equipo (nombres, turnos y el
--     diálogo de NIF), exportar un PDF y comprobar que NIF y NSS salen.
--     Con cuenta de EMPLEADO: fichar, abrir Mi registro y proponer una
--     corrección.
--
--  Si algo devuelve "permission denied for column X", es que esa columna
--  falta en alguna lista de grant de arriba: se añade y se reejecuta.
-- =====================================================================
