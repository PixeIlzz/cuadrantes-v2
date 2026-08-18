-- =====================================================================
--  BASELINE 06 · pg_cron y Realtime
-- =====================================================================

-- ---------------------------------------------------------------------
--  Tareas programadas
-- ---------------------------------------------------------------------
select cron.schedule('recordatorios-fichaje', '*/5 * * * *',
                     'select public.recordatorios_fichaje();');

-- NOTA: este es el ÚNICO job programado. No existe cierre automático de
-- jornada, pese a que el esquema lo da por hecho (origen 'auto', columna
-- 'estimado', acción 'cierre_auto' en la auditoría, y el ajuste
-- config.fichaje.cierre_auto). Ver el apartado 8 de CLAUDE.md.


-- ---------------------------------------------------------------------
--  Realtime sobre fichajes
-- ---------------------------------------------------------------------
--  La app se suscribe a time_entries para refrescar sola cuando alguien
--  ficha en el kiosco. La RLS sigue aplicando: cada usuario solo recibe
--  las filas que puede ver.
do $$
begin
  alter publication supabase_realtime add table public.time_entries;
exception when others then
  null;   -- ya estaba añadida
end $$;
