-- =====================================================================
--  VERIFICAR EL AISLAMIENTO ENTRE NEGOCIOS · herramienta, NO migración
-- =====================================================================
--  StaffPoint NO usa una base de datos por cliente: es una sola, con las
--  mismas tablas, y los negocios se separan por la columna business_id y
--  las políticas RLS. Así que "comprobar el aislamiento" no es mirar dos
--  sitios: es ponerse en la piel de un usuario y confirmar que no alcanza
--  ni una fila del otro negocio.
--
--  Eso es justo lo que hace este script: se hace pasar por un usuario
--  concreto con `set local role` + `request.jwt.claims`, exactamente como
--  llega una petición real desde la app, y cuenta lo que ve.
--
--  Todo son SELECT dentro de una transacción que termina en ROLLBACK.
-- =====================================================================


-- ▓▓▓ PASO 1 · Qué usuarios y negocios hay
--  Apunta el id del usuario de CADA negocio: los necesitas abajo.

select u.email,
       p.es_admin,
       m.role,
       b.name  as negocio,
       u.id    as user_id,
       b.id    as business_id
  from auth.users u
  join public.profiles p    on p.id = u.id
  left join public.memberships m on m.profile_id = u.id
  left join public.businesses b  on b.id = m.business_id
 order by b.name, m.role;


-- ▓▓▓ PASO 2 · Lo que ve el usuario A
--  Sustituye USER_ID_A por el id del gestor del primer negocio.
--  Cada cifra debe corresponder SOLO a su negocio.

begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"USER_ID_A","role":"authenticated"}';

select 'negocios'    as tabla, count(*) from public.businesses
union all select 'trabajadores',  count(*) from public.workers
union all select 'semanas',       count(*) from public.weeks
union all select 'asignaciones',  count(*) from public.assignments
union all select 'vacaciones',    count(*) from public.vacations
union all select 'solicitudes',   count(*) from public.requests
union all select 'avisos',        count(*) from public.announcements
union all select 'tareas',        count(*) from public.tasks
union all select 'fichajes',      count(*) from public.time_entries
union all select 'auditoría',     count(*) from public.time_entry_audit
union all select 'kioscos',       count(*) from public.kioscos
union all select 'notificaciones',count(*) from public.notifications
union all select 'membresías',    count(*) from public.memberships;

rollback;


-- ▓▓▓ PASO 3 · Lo mismo con el usuario B
--  Sustituye USER_ID_B por el gestor del OTRO negocio.
--  Las cifras tienen que ser las de SU negocio, no la suma de los dos.

begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"USER_ID_B","role":"authenticated"}';

select 'negocios'    as tabla, count(*) from public.businesses
union all select 'trabajadores',  count(*) from public.workers
union all select 'semanas',       count(*) from public.weeks
union all select 'asignaciones',  count(*) from public.assignments
union all select 'vacaciones',    count(*) from public.vacations
union all select 'solicitudes',   count(*) from public.requests
union all select 'avisos',        count(*) from public.announcements
union all select 'tareas',        count(*) from public.tasks
union all select 'fichajes',      count(*) from public.time_entries
union all select 'auditoría',     count(*) from public.time_entry_audit
union all select 'kioscos',       count(*) from public.kioscos
union all select 'notificaciones',count(*) from public.notifications
union all select 'membresías',    count(*) from public.memberships;

rollback;


-- ▓▓▓ PASO 4 · El intento directo: ir a por el negocio ajeno
--  Aquí no contamos, apuntamos. Sustituye USER_ID_B y BUSINESS_ID_A
--  (el negocio del OTRO). Las tres consultas deben devolver CERO filas.

begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"USER_ID_B","role":"authenticated"}';

select 'trabajadores ajenos' as intento, count(*)
  from public.workers where business_id = 'BUSINESS_ID_A'
union all
select 'fichajes ajenos', count(*)
  from public.time_entries where business_id = 'BUSINESS_ID_A'
union all
select 'negocio ajeno', count(*)
  from public.businesses where id = 'BUSINESS_ID_A';

rollback;


-- ▓▓▓ PASO 5 · Las columnas sensibles (migración 42)
--  Debe fallar con "permission denied for column". Si devuelve datos, la
--  42 no está aplicada y cualquier empleado puede leer los PIN.

begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"USER_ID_A","role":"authenticated"}';

select pin_hash from public.workers limit 1;

rollback;


-- ▓▓▓ PASO 6 · Escritura cruzada
--  Intentar meter un fichaje en el negocio ajeno. Debe fallar por RLS
--  (código 42501) o insertar 0 filas. El rollback deshace cualquier cosa.

begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"USER_ID_B","role":"authenticated"}';

insert into public.time_entries (business_id, worker_id, tipo)
select 'BUSINESS_ID_A', w.id, 'entrada'
  from public.workers w limit 1;

rollback;


-- =====================================================================
--  CÓMO LEER EL RESULTADO
-- =====================================================================
--  · PASO 2 y 3: cada usuario debe ver 1 negocio y solo los datos suyos.
--    Si alguna cifra coincide con el total de las dos empresas, hay fuga.
--  · PASO 4: cero en las tres.
--  · PASO 5: tiene que dar ERROR, no datos.
--  · PASO 6: tiene que dar error o no insertar nada.
--
--  Lo que este script NO cubre, porque no pasa por la base de datos:
--  el kiosco (va por device_token y Edge Function con service_role) y el
--  push (va por el trigger). Esos se prueban en la app.
--
--  Repite esta comprobación cada vez que añadas una tabla con business_id:
--  una tabla nueva sin políticas RLS queda invisible o, peor, visible para
--  todos. Es el fallo más fácil de cometer en este modelo.
-- =====================================================================
