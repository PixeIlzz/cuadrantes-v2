-- =====================================================================
--  041 · Cerrar los permisos de las funciones
-- =====================================================================
--  Hallazgo (revisión del 2026-08-19 con sql/tools/revisar_permisos.sql):
--  casi todas las funciones tenían `=X/postgres` en su ACL, o sea EXECUTE
--  para PUBLIC. Y como casi todas son SECURITY DEFINER, corrían con
--  permisos del propietario para quien las llamase, CON O SIN SESIÓN.
--
--  Lo más serio era avisar_gestores(): no comprueba quién llama, inserta
--  una notificación con título y cuerpo arbitrarios en el negocio que le
--  pases, y como insertar una notificación dispara trg_enviar_push, eso
--  sale como push real al móvil del gestor. Cualquiera, sin cuenta.
--
--  REQUIERE LA 40 EJECUTADA: aquí se hace revoke sobre
--  cerrar_jornadas_olvidadas(), que la crea la migración 40. Si no está,
--  esta falla con "function does not exist".
--
--  ESTRATEGIA: cerrar en bloque y reabrir solo lo justo. Enumerar las
--  cincuenta a mano es donde se cuela el olvido.
--
--  No rompe nada en marcha:
--   · `authenticated` y `service_role` conservan sus concesiones propias.
--   · Los triggers no necesitan EXECUTE al dispararse: el permiso se
--     comprueba al CREAR el trigger, no cada vez que salta.
--   · Los jobs de pg_cron corren como quien los programó (postgres, que
--     es el propietario), así que siguen pudiendo llamar a las suyas.
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. Cerrar todo a PUBLIC y a anon
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;


-- ---------------------------------------------------------------------
--  2. Reabrir a anon SOLO lo que de verdad se usa sin sesión
-- ---------------------------------------------------------------------
--  El kiosco es una tablet deslogueada: su credencial es el device_token,
--  que las tres funciones validan antes de hacer nada.
grant execute on function public.reclamar_token(text)  to anon, authenticated;
grant execute on function public.kiosco_equipo(text)   to anon, authenticated;
grant execute on function public.kiosco_estado(text)   to anon, authenticated;

--  Y el alta: quien va a registrarse todavía no tiene sesión, y necesita
--  ver de quién es el código que le han dado. Solo devuelve un nombre, y
--  solo si el código está vivo y sin usar.
grant execute on function public.invite_owner(text)    to anon, authenticated;


-- ---------------------------------------------------------------------
--  3. Cerrar también a `authenticated` las que son internas
-- ---------------------------------------------------------------------
--  Ninguna la llama el cliente: las usan otras funciones SECURITY DEFINER
--  (que corren como el propietario y por tanto siguen pudiendo) o el cron.

--  Notificaciones: son las que permitían mandar push arbitrario.
revoke execute on function public.avisar_gestores(uuid,text,text,text,text) from authenticated;
revoke execute on function public.crear_notif(uuid,uuid,text,text,text,text) from authenticated;
revoke execute on function public.quiere_notif(uuid,text)                    from authenticated;

--  Fichaje: cálculo interno. turno_previsto y tiene_turno_hoy filtraban el
--  horario de cualquier trabajador de cualquier negocio a quien supiera dos
--  UUID. Para el cliente queda mi_turno_previsto(), abajo.
revoke execute on function public.turno_previsto(uuid,uuid,date)      from authenticated;
revoke execute on function public.tiene_turno_hoy(uuid,uuid,date)     from authenticated;
revoke execute on function public.dia_laboral(uuid,uuid,timestamptz)  from authenticated;

--  Tareas programadas: las llama el cron, nadie más.
revoke execute on function public.recordatorios_fichaje()        from authenticated;
revoke execute on function public.cerrar_jornadas_olvidadas()    from authenticated;

--  Funciones de trigger. PostgREST no las expone (devuelven `trigger`),
--  pero se cierran igual por higiene.
revoke execute on function public.handle_new_user()               from authenticated;
revoke execute on function public.trg_auditar_fichaje()           from authenticated;
revoke execute on function public.trg_bloquear_solicitud()        from authenticated;
revoke execute on function public.trg_enviar_push()               from authenticated;
revoke execute on function public.trg_notif_announcement()        from authenticated;
revoke execute on function public.trg_notif_request_new()         from authenticated;
revoke execute on function public.trg_notif_request_resolved()    from authenticated;
revoke execute on function public.trg_notif_week_visible()        from authenticated;

--  Ya no la usa nadie desde la 38; se retirará del todo más adelante.
revoke execute on function public.fichajes_por_jornada(uuid,date,date) from authenticated;


-- ---------------------------------------------------------------------
--  4. Lo que el cliente sí necesita de turno_previsto
-- ---------------------------------------------------------------------
--  Devuelve el turno de HOY del que pregunta, resolviendo su propia ficha
--  por auth.uid() dentro del negocio indicado. Nunca acepta un worker_id
--  ajeno, que era justo el agujero.
--
--  Por qué un envoltorio y no un control dentro de turno_previsto: esa la
--  llaman jornada_hoy, kiosco_estado, dia_laboral, registro_arbol,
--  recordatorios_fichaje y cerrar_jornadas_olvidadas. Varias corren sin
--  auth.uid() —el cron— o para un usuario anónimo —el kiosco—, así que un
--  control ahí dentro las rompería todas.
--
--  El gestor no lo necesita: jornada_hoy() y kiosco_estado() ya le
--  devuelven los tramos de cada persona, y las dos comprueban permisos.

create or replace function public.mi_turno_previsto(p_business_id uuid, p_dia date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_worker uuid;
begin
  select w.id into v_worker
    from public.workers w
   where w.business_id = p_business_id
     and w.profile_id = auth.uid()
     and w.active
   limit 1;

  -- Sin ficha en ese negocio no hay turno que enseñar. Se devuelve vacío
  -- en vez de un error: el cliente lo pinta como "sin turno" y ya está.
  if v_worker is null then return '[]'::jsonb; end if;

  return public.turno_previsto(p_business_id, v_worker, p_dia);
end;
$function$;

revoke execute on function public.mi_turno_previsto(uuid, date) from public, anon;
grant  execute on function public.mi_turno_previsto(uuid, date) to authenticated;


-- =====================================================================
--  COMPROBAR
-- =====================================================================
--  Ninguna debe salir ya con `=X/postgres`. Volver a lanzar
--  sql/tools/revisar_permisos.sql, o en corto:
--
-- select p.proname, array_to_string(p.proacl, '  |  ') as permisos
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prokind = 'f'
--    and (p.proacl is null or array_to_string(p.proacl,',') like '=X/%')
--  order by p.proname;
--
--  Debe devolver CERO filas. Si sale alguna, es que se creó después.
--
--  Después de esto, probar en la app: publicar una semana (avisos), fichar
--  en el kiosco, abrir Mi registro, y emparejar un kiosco si se puede.
--  Si algo devuelve "permission denied for function", falta un grant: se
--  añade aquí y se vuelve a ejecutar.


-- =====================================================================
--  OJO CON LAS FUNCIONES FUTURAS
-- =====================================================================
--  Supabase deja unos DEFAULT PRIVILEGES que conceden EXECUTE a anon y a
--  authenticated en cada función nueva del esquema public. Sumado al
--  defecto de Postgres (PUBLIC), toda función que se cree a partir de hoy
--  vuelve a nacer abierta.
--
--  No se tocan los default privileges a propósito: cambiarlos haría que
--  las RPC nuevas dejasen de verse desde el cliente sin avisar, y eso se
--  diagnostica fatal meses después.
--
--  La regla es la de siempre en este repo: TODA migración que cree una
--  función termina con su revoke y su grant explícitos, como hacen la 38,
--  la 40 y esta. Si no los lleva, nace abierta a internet.
-- =====================================================================
