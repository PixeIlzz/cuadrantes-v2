-- =====================================================================
--  BASELINE 04 · Triggers
-- =====================================================================

-- Auditoría inmutable de todo cambio en fichajes
create trigger auditar_fichaje
  after insert or delete or update on public.time_entries
  for each row execute function public.trg_auditar_fichaje();

-- El interruptor solicitudes_activas NO bloquea las correcciones de fichaje
create trigger bloquear_solicitud
  before insert on public.requests
  for each row execute function public.trg_bloquear_solicitud();

create trigger notif_request_new
  after insert on public.requests
  for each row execute function public.trg_notif_request_new();

create trigger notif_request_resolved
  after update on public.requests
  for each row execute function public.trg_notif_request_resolved();

create trigger notif_announcement
  after insert on public.announcements
  for each row execute function public.trg_notif_announcement();

-- La guarda evita el bucle: la propia función escribe notified_at
create trigger notif_week_visible
  after update on public.weeks
  for each row when ((not (old.notified_at is distinct from new.notified_at)))
  execute function public.trg_notif_week_visible();

-- Insertar una notificación dispara el push
create trigger enviar_push
  after insert on public.notifications
  for each row execute function public.trg_enviar_push();


-- =====================================================================
--  FALTA: el trigger sobre auth.users
-- =====================================================================
--  handle_new_user() está en 03_funciones.sql, pero su trigger vive en el
--  esquema 'auth' y el volcado solo cubría 'public', así que no se pudo
--  confirmar su nombre ni sus condiciones exactas.
--
--  Sin él, un usuario que se registra NO obtiene fila en public.profiles y
--  la app no arranca para esa cuenta.
--
--  En un proyecto nuevo: crearlo, y luego COMPROBARLO registrando una
--  cuenta de prueba y verificando que aparece en profiles.
--
--  create trigger on_auth_user_created
--    after insert on auth.users
--    for each row execute function public.handle_new_user();
--
--  Para ver el que hay en el proyecto actual:
--    select pg_get_triggerdef(t.oid)
--      from pg_trigger t join pg_class c on c.oid = t.tgrelid
--      join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'auth' and not t.tgisinternal;
-- =====================================================================
