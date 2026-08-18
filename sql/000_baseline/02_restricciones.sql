-- =====================================================================
--  BASELINE 02 · Claves, checks e índices
-- =====================================================================
--  Va después del 01 porque requests.entry_id ↔ time_entries.request_id
--  es una referencia circular: las tablas tienen que existir las dos.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Claves primarias y únicos
-- ---------------------------------------------------------------------
alter table public.profiles              add constraint profiles_pkey PRIMARY KEY (id);
alter table public.businesses            add constraint businesses_pkey PRIMARY KEY (id);
alter table public.memberships           add constraint memberships_pkey PRIMARY KEY (id);
alter table public.memberships           add constraint memberships_business_id_profile_id_key UNIQUE (business_id, profile_id);
alter table public.workers               add constraint workers_pkey PRIMARY KEY (id);
alter table public.workers               add constraint workers_business_id_profile_id_key UNIQUE (business_id, profile_id);
alter table public.invites               add constraint invites_pkey PRIMARY KEY (code);
alter table public.weeks                 add constraint weeks_pkey PRIMARY KEY (id);
alter table public.weeks                 add constraint weeks_business_id_start_date_key UNIQUE (business_id, start_date);
alter table public.assignments           add constraint assignments_pkey PRIMARY KEY (id);
alter table public.vacations             add constraint vacations_pkey PRIMARY KEY (id);
alter table public.requests              add constraint requests_pkey PRIMARY KEY (id);
alter table public.announcements         add constraint announcements_pkey PRIMARY KEY (id);
alter table public.tasks                 add constraint tasks_pkey PRIMARY KEY (id);
alter table public.task_completions      add constraint task_completions_pkey PRIMARY KEY (id);
alter table public.task_completions      add constraint task_completions_task_id_done_date_key UNIQUE (task_id, done_date);
alter table public.notifications         add constraint notifications_pkey PRIMARY KEY (id);
alter table public.notification_prefs    add constraint notification_prefs_pkey PRIMARY KEY (profile_id);
alter table public.push_subscriptions    add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.push_subscriptions    add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table public.kioscos               add constraint kioscos_pkey PRIMARY KEY (id);
alter table public.kioscos               add constraint kioscos_device_token_key UNIQUE (device_token);
alter table public.kioscos               add constraint kioscos_pairing_nonce_key UNIQUE (pairing_nonce);
alter table public.time_entries          add constraint time_entries_pkey PRIMARY KEY (id);
alter table public.time_entry_audit      add constraint time_entry_audit_pkey PRIMARY KEY (id);
alter table public.fichaje_recordatorios add constraint fichaje_recordatorios_pkey PRIMARY KEY (entry_id);
alter table public.fichaje_avisos_entrada add constraint fichaje_avisos_entrada_pkey PRIMARY KEY (worker_id, dia);

-- ---------------------------------------------------------------------
--  Claves ajenas
-- ---------------------------------------------------------------------
alter table public.profiles     add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.memberships  add constraint memberships_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.memberships  add constraint memberships_profile_id_fkey  FOREIGN KEY (profile_id)  REFERENCES profiles(id)   ON DELETE CASCADE;

alter table public.workers      add constraint workers_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.workers      add constraint workers_profile_id_fkey  FOREIGN KEY (profile_id)  REFERENCES profiles(id)   ON DELETE SET NULL;

alter table public.invites      add constraint invites_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.invites      add constraint invites_worker_id_fkey   FOREIGN KEY (worker_id)   REFERENCES workers(id)    ON DELETE CASCADE;
alter table public.invites      add constraint invites_used_by_fkey     FOREIGN KEY (used_by)     REFERENCES profiles(id)   ON DELETE SET NULL;

alter table public.weeks        add constraint weeks_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table public.assignments  add constraint assignments_week_id_fkey   FOREIGN KEY (week_id)   REFERENCES weeks(id)   ON DELETE CASCADE;
alter table public.assignments  add constraint assignments_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE;

alter table public.vacations    add constraint vacations_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.vacations    add constraint vacations_worker_id_fkey   FOREIGN KEY (worker_id)   REFERENCES workers(id)    ON DELETE CASCADE;
alter table public.vacations    add constraint vacations_request_fk       FOREIGN KEY (request_id)  REFERENCES requests(id)   ON DELETE SET NULL;

alter table public.requests     add constraint requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id)   ON DELETE CASCADE;
alter table public.requests     add constraint requests_worker_id_fkey   FOREIGN KEY (worker_id)   REFERENCES workers(id)      ON DELETE CASCADE;
alter table public.requests     add constraint requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES profiles(id)     ON DELETE SET NULL;
alter table public.requests     add constraint requests_entry_id_fkey    FOREIGN KEY (entry_id)    REFERENCES time_entries(id) ON DELETE SET NULL;

alter table public.announcements add constraint announcements_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.announcements add constraint announcements_created_by_fkey  FOREIGN KEY (created_by)  REFERENCES profiles(id)   ON DELETE SET NULL;

alter table public.tasks            add constraint tasks_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.tasks            add constraint tasks_created_by_fkey  FOREIGN KEY (created_by)  REFERENCES profiles(id)   ON DELETE SET NULL;
alter table public.task_completions add constraint task_completions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.task_completions add constraint task_completions_task_id_fkey     FOREIGN KEY (task_id)     REFERENCES tasks(id)      ON DELETE CASCADE;
alter table public.task_completions add constraint task_completions_done_by_fkey     FOREIGN KEY (done_by)     REFERENCES profiles(id)   ON DELETE SET NULL;

alter table public.notifications      add constraint notifications_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.notifications      add constraint notifications_profile_id_fkey  FOREIGN KEY (profile_id)  REFERENCES profiles(id)   ON DELETE CASCADE;
alter table public.notification_prefs add constraint notification_prefs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

alter table public.kioscos      add constraint kioscos_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

alter table public.time_entries add constraint time_entries_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public.time_entries add constraint time_entries_worker_id_fkey   FOREIGN KEY (worker_id)   REFERENCES workers(id)    ON DELETE CASCADE;
alter table public.time_entries add constraint time_entries_profile_id_fkey  FOREIGN KEY (profile_id)  REFERENCES profiles(id)   ON DELETE CASCADE;
alter table public.time_entries add constraint time_entries_kiosco_id_fkey   FOREIGN KEY (kiosco_id)   REFERENCES kioscos(id)    ON DELETE SET NULL;
alter table public.time_entries add constraint time_entries_request_id_fkey  FOREIGN KEY (request_id)  REFERENCES requests(id)   ON DELETE SET NULL;

alter table public.fichaje_recordatorios  add constraint fichaje_recordatorios_entry_id_fkey  FOREIGN KEY (entry_id)  REFERENCES time_entries(id) ON DELETE CASCADE;
alter table public.fichaje_avisos_entrada add constraint fichaje_avisos_entrada_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES workers(id)      ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  Checks
-- ---------------------------------------------------------------------
alter table public.memberships  add constraint memberships_role_check CHECK ((role = ANY (ARRAY['manager'::text, 'employee'::text])));
alter table public.workers      add constraint workers_weekly_shifts_check CHECK ((weekly_shifts >= 0));
alter table public.weeks        add constraint weeks_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'published'::text])));
alter table public.weeks        add constraint weeks_visibility_ck CHECK ((visibility = ANY (ARRAY['auto'::text, 'shown'::text, 'hidden'::text])));
-- O es un turno de toda la plantilla, o es de una persona concreta. Nunca ambos.
alter table public.assignments  add constraint assignment_target_ck CHECK (((is_all AND (worker_id IS NULL)) OR ((NOT is_all) AND (worker_id IS NOT NULL))));
alter table public.vacations    add constraint vacation_range_ck CHECK ((end_date >= start_date));
alter table public.vacations    add constraint vacations_source_check CHECK ((source = ANY (ARRAY['manager'::text, 'request'::text])));
alter table public.requests     add constraint requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text])));
alter table public.requests     add constraint requests_type_chk CHECK ((type = ANY (ARRAY['vacation'::text, 'change'::text, 'other'::text, 'timefix'::text])));
alter table public.tasks        add constraint tasks_repeat_type_check CHECK ((repeat_type = ANY (ARRAY['once'::text, 'daily'::text, 'weekly'::text])));
alter table public.time_entries add constraint time_entries_tipo_check CHECK ((tipo = ANY (ARRAY['entrada'::text, 'salida'::text])));
alter table public.time_entries add constraint time_entries_origen_check CHECK ((origen = ANY (ARRAY['empleado'::text, 'auto'::text, 'gestor'::text, 'kiosco'::text])));

-- ---------------------------------------------------------------------
--  Índices (los de PK/UNIQUE los crea Postgres solo)
-- ---------------------------------------------------------------------
create index if not exists memberships_profile_id_idx on public.memberships using btree (profile_id);
create index if not exists workers_business_id_idx    on public.workers     using btree (business_id);
create index if not exists weeks_business_id_start_date_idx on public.weeks using btree (business_id, start_date DESC);
create index if not exists assignments_week_id_idx    on public.assignments using btree (week_id);
create index if not exists assignments_worker_id_idx  on public.assignments using btree (worker_id);
create index if not exists vacations_worker_id_start_date_idx on public.vacations using btree (worker_id, start_date);
create index if not exists requests_business_id_status_idx on public.requests using btree (business_id, status);
create index if not exists announcements_biz_idx      on public.announcements using btree (business_id, active, created_at DESC);
create index if not exists tasks_biz_idx              on public.tasks using btree (business_id, active);
create index if not exists task_comp_idx              on public.task_completions using btree (business_id, done_date DESC);
create index if not exists notif_user_idx             on public.notifications using btree (profile_id, read_at, created_at DESC);
create index if not exists push_sub_user_idx          on public.push_subscriptions using btree (profile_id);
create index if not exists kioscos_business_idx       on public.kioscos using btree (business_id);
create index if not exists te_worker_dia_idx          on public.time_entries using btree (worker_id, momento);
create index if not exists te_business_idx            on public.time_entries using btree (business_id, momento);
create index if not exists tea_business_idx           on public.time_entry_audit using btree (business_id, momento DESC);
