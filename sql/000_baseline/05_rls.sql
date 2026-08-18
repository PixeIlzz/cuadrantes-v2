-- =====================================================================
--  BASELINE 05 · Row Level Security
-- =====================================================================
--  Toda la separación entre negocios se apoya en is_member() e
--  is_manager(), que miran memberships contra auth.uid(). Es la pieza
--  central del multi-tenancy: cualquier tabla nueva con business_id
--  necesita sus políticas, o queda invisible (o peor, visible a todos).
-- =====================================================================

alter table public.announcements          enable row level security;
alter table public.assignments            enable row level security;
alter table public.businesses             enable row level security;
alter table public.fichaje_avisos_entrada enable row level security;
alter table public.fichaje_recordatorios  enable row level security;
alter table public.invites                enable row level security;
alter table public.kioscos                enable row level security;
alter table public.memberships            enable row level security;
alter table public.notification_prefs     enable row level security;
alter table public.notifications          enable row level security;
alter table public.profiles               enable row level security;
alter table public.push_subscriptions     enable row level security;
alter table public.requests               enable row level security;
alter table public.task_completions       enable row level security;
alter table public.tasks                  enable row level security;
alter table public.time_entries           enable row level security;
alter table public.time_entry_audit       enable row level security;
alter table public.vacations              enable row level security;
alter table public.weeks                  enable row level security;
alter table public.workers                enable row level security;

-- fichaje_avisos_entrada y fichaje_recordatorios tienen RLS activa y CERO
-- políticas a propósito: solo las tocan funciones SECURITY DEFINER, así que
-- nadie llega a ellas por la API. No añadir políticas sin motivo.


-- ---------------------------------------------------------------------
--  Cuentas y negocio
-- ---------------------------------------------------------------------
create policy "perfil propio: leer"
  on public.profiles as PERMISSIVE for SELECT to public
  using ((id = auth.uid()));

create policy "perfil propio: editar"
  on public.profiles as PERMISSIVE for UPDATE to public
  using ((id = auth.uid()));

create policy "negocio: leer si soy miembro"
  on public.businesses as PERMISSIVE for SELECT to public
  using (is_member(id));

create policy "negocio: editar si soy gestor"
  on public.businesses as PERMISSIVE for UPDATE to public
  using (is_manager(id)) with check (is_manager(id));

create policy "membresías: ver las mías o las de mi negocio si soy gestor"
  on public.memberships as PERMISSIVE for SELECT to public
  using (((profile_id = auth.uid()) OR is_manager(business_id)));

create policy "membresías: gestiona el gestor"
  on public.memberships as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "equipo: leer si soy miembro"
  on public.workers as PERMISSIVE for SELECT to public
  using (is_member(business_id));

create policy "equipo: escribe el gestor"
  on public.workers as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "invitaciones: solo gestor"
  on public.invites as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));
-- El empleado canjea por redeem_invite(), que es SECURITY DEFINER.


-- ---------------------------------------------------------------------
--  Cuadrante
-- ---------------------------------------------------------------------
create policy "semanas: el gestor lo ve todo"
  on public.weeks as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "semanas: el empleado ve las visibles"
  on public.weeks as PERMISSIVE for SELECT to public
  using ((is_member(business_id)
          AND (visibility <> 'hidden'::text)
          AND ((visibility = 'shown'::text)
               OR ((publish_at IS NOT NULL) AND (publish_at <= now())
                   AND ((start_date + 6) >= CURRENT_DATE)))));

create policy "asignaciones: el gestor lo ve todo"
  on public.assignments as PERMISSIVE for ALL to public
  using ((EXISTS ( SELECT 1 FROM weeks w
                    WHERE ((w.id = assignments.week_id) AND is_manager(w.business_id)))))
  with check ((EXISTS ( SELECT 1 FROM weeks w
                    WHERE ((w.id = assignments.week_id) AND is_manager(w.business_id)))));

create policy "asignaciones: el empleado, las de semanas visibles"
  on public.assignments as PERMISSIVE for SELECT to public
  using ((EXISTS ( SELECT 1 FROM weeks w
    WHERE ((w.id = assignments.week_id) AND is_member(w.business_id)
           AND (w.visibility <> 'hidden'::text)
           AND ((w.visibility = 'shown'::text)
                OR ((w.publish_at IS NOT NULL) AND (w.publish_at <= now())
                    AND ((w.start_date + 6) >= CURRENT_DATE)))))));

create policy "vacaciones: gestiona el gestor"
  on public.vacations as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "vacaciones: el empleado ve las suyas"
  on public.vacations as PERMISSIVE for SELECT to public
  using ((worker_id = my_worker_id(business_id)));

create policy "solicitudes: el gestor las ve y resuelve"
  on public.requests as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "solicitudes: el empleado ve las suyas"
  on public.requests as PERMISSIVE for SELECT to public
  using ((worker_id = my_worker_id(business_id)));

-- El empleado nunca puede crear una solicitud ya resuelta ni con nota del gestor
create policy "solicitudes: el empleado crea las suyas, siempre pendientes"
  on public.requests as PERMISSIVE for INSERT to public
  with check (((worker_id = my_worker_id(business_id))
               AND (status = 'pending'::text)
               AND (manager_note IS NULL)
               AND (resolved_at IS NULL)));


-- ---------------------------------------------------------------------
--  Avisos y tareas
-- ---------------------------------------------------------------------
create policy "avisos: los gestiona el gestor"
  on public.announcements as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "avisos: los lee todo el equipo"
  on public.announcements as PERMISSIVE for SELECT to public
  using ((is_member(business_id) AND active
          AND ((expires_at IS NULL) OR (expires_at >= CURRENT_DATE))));

create policy "tareas: solo el gestor"
  on public.tasks as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));

create policy "completadas: solo el gestor"
  on public.task_completions as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));


-- ---------------------------------------------------------------------
--  Notificaciones y push
-- ---------------------------------------------------------------------
--  Sin política de INSERT a propósito: las notificaciones solo las crea
--  crear_notif() / avisar_gestores(), que son SECURITY DEFINER.
create policy "notif: cada uno ve las suyas"
  on public.notifications as PERMISSIVE for SELECT to public
  using ((profile_id = auth.uid()));

create policy "notif: cada uno marca las suyas"
  on public.notifications as PERMISSIVE for UPDATE to public
  using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

create policy "notif: cada uno borra las suyas"
  on public.notifications as PERMISSIVE for DELETE to public
  using ((profile_id = auth.uid()));

create policy "prefs: cada uno las suyas"
  on public.notification_prefs as PERMISSIVE for ALL to public
  using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));

create policy "push: cada uno gestiona las suyas"
  on public.push_subscriptions as PERMISSIVE for ALL to public
  using ((profile_id = auth.uid())) with check ((profile_id = auth.uid()));


-- ---------------------------------------------------------------------
--  Fichaje  ·  TODO ESTO ESTÁ TRAS EL FLAG DE BETA
-- ---------------------------------------------------------------------
--  Las cinco políticas de abajo exigen soy_probador(). Para sacar el
--  fichaje de beta (pendiente 2 de CLAUDE.md) hay que reemplazarlas por
--  las mismas sin esa condición, y quitar la guarda equivalente que hay
--  dentro de fichar(). Es una migración corta, pero son estos cinco
--  sitios más uno: no se olvide ninguno.

create policy "kioscos: gestor de su negocio"
  on public.kioscos as PERMISSIVE for ALL to public
  using (is_manager(business_id)) with check (is_manager(business_id));
-- El kiosco no entra por RLS: ficha vía Edge Function con service_role.

create policy "fich: empleado ve los suyos"
  on public.time_entries as PERMISSIVE for SELECT to public
  using ((soy_probador() AND ((profile_id = auth.uid()) OR (EXISTS ( SELECT 1
     FROM memberships m
    WHERE ((m.business_id = time_entries.business_id)
           AND (m.profile_id = auth.uid()) AND (m.role = 'manager'::text)))))));

create policy "fich: empleado ficha lo suyo"
  on public.time_entries as PERMISSIVE for INSERT to public
  with check ((soy_probador() AND (profile_id = auth.uid())));

create policy "fich: gestor corrige"
  on public.time_entries as PERMISSIVE for UPDATE to public
  using ((soy_probador() AND (EXISTS ( SELECT 1
     FROM memberships m
    WHERE ((m.business_id = time_entries.business_id)
           AND (m.profile_id = auth.uid()) AND (m.role = 'manager'::text))))));

create policy "fich: gestor borra"
  on public.time_entries as PERMISSIVE for DELETE to public
  using ((soy_probador() AND (EXISTS ( SELECT 1
     FROM memberships m
    WHERE ((m.business_id = time_entries.business_id)
           AND (m.profile_id = auth.uid()) AND (m.role = 'manager'::text))))));

-- La auditoría es de solo lectura: la escribe el trigger, nadie a mano.
create policy "audit: gestor lee"
  on public.time_entry_audit as PERMISSIVE for SELECT to public
  using ((soy_probador() AND (EXISTS ( SELECT 1
     FROM memberships m
    WHERE ((m.business_id = time_entry_audit.business_id)
           AND (m.profile_id = auth.uid()) AND (m.role = 'manager'::text))))));
