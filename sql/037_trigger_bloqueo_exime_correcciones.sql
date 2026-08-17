-- 037 · El bloqueo por `solicitudes_activas` deja de aplicarse a las correcciones.
--
-- trg_bloquear_solicitud() rechazaba CUALQUIER inserción en requests con el
-- interruptor apagado, sin mirar el tipo. Al ser un trigger salta aunque
-- crear_correccion sea SECURITY DEFINER, así que las correcciones de fichaje
-- nunca llegaban a entrar: el empleado veía «No se pudo enviar: Las solicitudes
-- están desactivadas en este negocio.».
--
-- El interruptor apaga vacaciones y cambios de turno, que son una comodidad.
-- Corregir el propio registro de jornada es un derecho del trabajador y no
-- puede depender de una preferencia del gestor.
--
-- Solo se reemplaza la función: el trigger sigue apuntando a ella y no hace
-- falta recrearlo. El tipo de retorno no cambia, así que basta CREATE OR REPLACE.

create or replace function public.trg_bloquear_solicitud()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_activas boolean;
begin
  -- Las correcciones del registro de jornada nunca se bloquean
  if NEW.type = 'timefix' then
    return NEW;
  end if;

  select coalesce((b.config ->> 'solicitudes_activas')::boolean, true)
    into v_activas
    from public.businesses b
   where b.id = NEW.business_id;

  if v_activas is false then
    raise exception 'Las solicitudes están desactivadas en este negocio.';
  end if;

  return NEW;
end;
$function$;
