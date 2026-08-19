-- =====================================================================
--  051 · Guardar qué guías ha visto cada quien
-- =====================================================================
--  La guía del gestor se apunta en businesses.config.onboarding, que ya es
--  jsonb y no necesita nada nuevo.
--
--  La del empleado necesita esta columna: un trabajador no puede escribir
--  en businesses, y guardarlo en el navegador significaría repetirle la
--  guía cada vez que cambia de móvil o borra datos. Va en su perfil.
--
--  Las políticas de profiles ya son las correctas: cada uno lee y escribe
--  la suya (`id = auth.uid()`), así que no hay que tocar RLS.
-- =====================================================================

alter table public.profiles
  add column if not exists onboarding jsonb not null default '{}'::jsonb;

comment on column public.profiles.onboarding is
  'Qué guías ha visto esta persona: {"empleado": "2026-08-19"}. Para no repetírselas al cambiar de dispositivo.';


-- =====================================================================
--  COMPROBAR
-- =====================================================================
-- select id, onboarding from public.profiles limit 5;
--
--  Y que un usuario puede escribir la suya (debería funcionar):
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims to '{"sub":"TU_USER_ID","role":"authenticated"}';
-- update public.profiles set onboarding = '{"empleado":"2026-08-19"}'::jsonb
--  where id = auth.uid();
-- rollback;
-- =====================================================================
