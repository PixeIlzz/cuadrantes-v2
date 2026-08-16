-- 034 · Datos personales del trabajador para la documentación legal.
--
-- 'name' es el nombre corto del cuadrante (coloquial: "Fran", "Mari").
-- 'full_name' es el nombre y apellidos como figura en el contrato, y es el
-- que sale en el PDF y el CSV del registro de jornada.
-- 'nss' es el número de afiliación a la Seguridad Social, que junto al NIF
-- identifica al trabajador en la documentación laboral.
--
-- Los dos son opcionales: quien no los tenga rellenos sigue exportando con
-- el nombre corto, como hasta ahora.

alter table public.workers
  add column if not exists full_name text,
  add column if not exists nss text;

comment on column public.workers.name      is 'Nombre corto para el cuadrante';
comment on column public.workers.full_name is 'Nombre y apellidos para la documentación legal';
comment on column public.workers.nss       is 'Número de afiliación a la Seguridad Social';
