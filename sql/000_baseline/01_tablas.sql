-- =====================================================================
--  BASELINE 01 · Extensiones y tablas
-- =====================================================================
--  Solo columnas. Las claves ajenas, checks e índices van en el 02,
--  porque requests.entry_id ↔ time_entries.request_id es circular.
-- =====================================================================

create extension if not exists pgcrypto;   -- crypt/gen_salt del PIN, gen_random_bytes
create extension if not exists pg_cron;    -- recordatorios de fichaje
create extension if not exists pg_net;     -- net.http_post del push


-- ---------------------------------------------------------------------
--  Cuentas y negocio
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid not null,                     -- = auth.users.id
  full_name   text,
  created_at  timestamptz not null default now(),
  es_probador boolean not null default false     -- flag de beta
);

create table if not exists public.businesses (
  id         uuid not null default gen_random_uuid(),
  name       text not null,
  config     jsonb not null default '{"days": [{"id": "lun", "label": "Lunes"}, {"id": "mar", "label": "Martes"}, {"id": "mie", "label": "Miércoles"}, {"id": "jue", "label": "Jueves"}, {"id": "vie", "label": "Viernes"}, {"id": "vieN", "label": "Viernes noche", "night": true}, {"id": "sab", "label": "Sábado"}, {"id": "sabN", "label": "Sábado noche", "night": true}, {"id": "dom", "label": "Domingo"}], "roles": [{"id": "cam", "min": 3, "label": "Camareros"}, {"id": "par", "min": 1, "label": "Parrilla"}, {"id": "coc", "min": 2, "label": "Cocineros"}], "publish": {"tz": "Atlantic/Canary", "time": "18:00", "weekday": 0}}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id          uuid not null default gen_random_uuid(),
  business_id uuid not null,
  profile_id  uuid not null,
  role        text not null,                     -- 'manager' | 'employee'
  created_at  timestamptz not null default now()
);

-- name = nombre corto del cuadrante ("Fran")
-- full_name = nombre legal del contrato, el que sale en el PDF y el CSV
create table if not exists public.workers (
  id                  uuid not null default gen_random_uuid(),
  business_id         uuid not null,
  name                text not null,
  weekly_shifts       integer not null default 5,
  active              boolean not null default true,
  profile_id          uuid,                      -- null: ficha sin cuenta de app
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  pin_hash            text,                      -- bcrypt, nunca en claro
  pin_intentos        integer not null default 0,
  pin_bloqueado_hasta timestamptz,
  nif                 text,
  full_name           text,
  nss                 text                       -- nº Seguridad Social
);

create table if not exists public.invites (
  code        text not null,
  business_id uuid not null,
  worker_id   uuid not null,
  expires_at  timestamptz not null default (now() + '30 days'::interval),
  used_at     timestamptz,
  used_by     uuid,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Cuadrante
-- ---------------------------------------------------------------------

-- config_snapshot congela la config del negocio al publicar la semana
create table if not exists public.weeks (
  id                uuid not null default gen_random_uuid(),
  business_id       uuid not null,
  start_date        date not null,               -- lunes
  status            text not null default 'draft',
  publish_at        timestamptz,
  publish_at_manual boolean not null default false,
  notes             jsonb not null default '{}'::jsonb,
  config_snapshot   jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  visibility        text not null default 'auto',
  notified_at       timestamptz                  -- para no repetir el aviso
);

create table if not exists public.assignments (
  id          uuid not null default gen_random_uuid(),
  week_id     uuid not null,
  day_id      text not null,
  position_id text not null,
  worker_id   uuid,                              -- null si is_all
  is_all      boolean not null default false,    -- turno de toda la plantilla
  sort_order  integer not null default 0
);

create table if not exists public.vacations (
  id          uuid not null default gen_random_uuid(),
  business_id uuid not null,
  worker_id   uuid not null,
  start_date  date not null,
  end_date    date not null,
  source      text not null default 'manager',   -- 'manager' | 'request'
  request_id  uuid,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.requests (
  id           uuid not null default gen_random_uuid(),
  business_id  uuid not null,
  worker_id    uuid not null,
  type         text not null,                    -- vacation|change|other|timefix
  status       text not null default 'pending',
  start_date   date,
  end_date     date,
  message      text,
  manager_note text,
  resolved_at  timestamptz,
  resolved_by  uuid,
  created_at   timestamptz not null default now(),
  entry_id     uuid,                             -- fichaje de la corrección
  fix          jsonb                             -- {accion,tipo,momento,momento_fin}
);


-- ---------------------------------------------------------------------
--  Avisos y tareas
-- ---------------------------------------------------------------------

create table if not exists public.announcements (
  id          uuid not null default gen_random_uuid(),
  business_id uuid not null,
  text        text not null,
  pinned      boolean not null default false,
  active      boolean not null default true,
  expires_at  date,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.tasks (
  id          uuid not null default gen_random_uuid(),
  business_id uuid not null,
  title       text not null,
  detail      text,
  repeat_type text not null default 'once',      -- once|daily|weekly
  repeat_days integer[] not null default '{}'::integer[],
  due_date    date,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.task_completions (
  id          uuid not null default gen_random_uuid(),
  task_id     uuid not null,
  business_id uuid not null,
  done_date   date not null,
  done_by     uuid,
  done_at     timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Notificaciones y push
-- ---------------------------------------------------------------------

create table if not exists public.notifications (
  id          uuid not null default gen_random_uuid(),
  business_id uuid not null,
  profile_id  uuid not null,
  type        text not null,
  title       text not null,
  body        text,
  link_tab    text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.notification_prefs (
  profile_id   uuid not null,
  prefs        jsonb not null default '{}'::jsonb,
  push_enabled boolean not null default false,
  updated_at   timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id         uuid not null default gen_random_uuid(),
  profile_id uuid not null,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  Fichaje
-- ---------------------------------------------------------------------

create table if not exists public.kioscos (
  id               uuid not null default gen_random_uuid(),
  business_id      uuid not null,
  nombre           text not null,
  device_token     text not null default encode(gen_random_bytes(24), 'hex'::text),
  activo           boolean not null default true,
  ips_permitidas   text[],                       -- null = sin restricción
  created_at       timestamptz not null default now(),
  pairing_nonce    text,
  pairing_nonce_at timestamptz
);

-- momento lo pone SIEMPRE el servidor (default now()), nunca el dispositivo
create table if not exists public.time_entries (
  id          uuid not null default gen_random_uuid(),
  business_id uuid not null,
  worker_id   uuid not null,
  profile_id  uuid,                              -- null: ficha sin cuenta
  tipo        text not null,                     -- entrada | salida
  momento     timestamptz not null default now(),
  estimado    boolean not null default false,
  origen      text not null default 'empleado',  -- empleado|auto|gestor|kiosco
  nota        text,
  created_at  timestamptz not null default now(),
  kiosco_id   uuid,
  ip          text,
  request_id  uuid                               -- solicitud que originó el cambio
);

-- Sin claves ajenas a propósito: si se borra el fichaje, el rastro se conserva
create table if not exists public.time_entry_audit (
  id          uuid not null default gen_random_uuid(),
  entry_id    uuid,
  business_id uuid not null,
  actor_id    uuid,
  accion      text not null,                     -- crear|editar|borrar|cierre_auto
  antes       jsonb,
  despues     jsonb,
  momento     timestamptz not null default now()
);

-- Control de "ya avisé": una fila por aviso enviado, para no repetirlo
create table if not exists public.fichaje_recordatorios (
  entry_id   uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fichaje_avisos_entrada (
  worker_id  uuid not null,
  dia        date not null,
  created_at timestamptz not null default now()
);
