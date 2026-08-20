# Levantar StaffPoint en un proyecto Supabase vacío

Sirve para dos cosas que en el fondo son la misma:

- **Montar el entorno de staging**, donde probar las migraciones antes de
  tocar los datos reales de la plantilla.
- **Recuperarse de un desastre**: si se pierde el proyecto de producción,
  esto es lo que hay que ejecutar antes de volcar el último respaldo.

Ejecutar esto es además **la única forma de saber que `sql/000_baseline/`
funciona**. Se construyó a partir de un volcado de producción y nunca se ha
corrido contra un Postgres vacío. Si tiene un fallo, es mucho mejor
encontrarlo aquí que el día que haga falta de verdad.

---

## 1. Crear el proyecto

Supabase → **New project**, plan gratuito. Región Frankfurt, la misma que
producción.

Apunta el *project ref* (lo que va antes de `.supabase.co`): hace falta más
abajo.

> El plan gratuito pausa el proyecto tras una semana sin actividad. Para
> staging da igual: se despierta solo al entrar.

---

## 2. Extensiones

El SQL Editor de un proyecto nuevo ya trae `pgcrypto`. Las otras dos hay que
activarlas en **Database → Extensions**, o dejar que las cree el paso 3:

- `pgcrypto` — hash del PIN y generación de tokens
- `pg_cron` — recordatorios, cierre automático y respaldo
- `pg_net` — llamadas a las Edge Functions desde la base de datos

---

## 3. El esquema base

En el SQL Editor, **uno a uno y en este orden**. Cada archivo entero:

1. `sql/000_baseline/01_tablas.sql`
2. `sql/000_baseline/02_restricciones.sql`
3. `sql/000_baseline/03_funciones.sql`
4. `sql/000_baseline/04_triggers.sql`
5. `sql/000_baseline/05_rls.sql`
6. `sql/000_baseline/06_cron_realtime.sql`

El orden importa: las claves ajenas van separadas de las tablas porque
`requests.entry_id` y `time_entries.request_id` se apuntan la una a la otra.

---

## 4. El trigger de `auth.users` — el que falta

**Este es el paso que más fácil se olvida y el que rompe todo.** El volcado
solo cubría el esquema `public`, así que el trigger que crea la fila de
`profiles` cuando alguien se registra no está en el baseline.

Sin él, quien cree una cuenta no tendrá perfil y **la app no arrancará para
esa persona**.

Primero mira cómo está en producción, para copiarlo igual:

```sql
select pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'auth' and not t.tgisinternal;
```

Y aplícalo en el proyecto nuevo. Si por lo que sea no lo puedes leer, el
estándar es:

```sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Compruébalo registrando una cuenta y mirando que aparece en `profiles`.

---

## 5. Las migraciones

Otra vez en orden, de la 33 a la última:

```
033_fix_fichajes_por_jornada   034_workers_datos_personales
035_correcciones_fichaje       036_notificaciones_correcciones
037_trigger_bloqueo_exime      038_registro_arbol
039_secreto_push               040_cierre_automatico
041_permisos_funciones         042_aislamiento_datos
043_fichar_multinegocio        044_fichaje_por_negocio
045_alta_controlada            046_panel_plataforma
047_soporte_y_consola          048_archivar_eliminar_pin
049_exportar_negocio           050_respaldo_automatico
051_onboarding                 052_negocio_demo
053_borrar_demos               054_cierre_tope_duro
```

Dos avisos:

- La **41** cierra los permisos en bloque. Si algo falla después con
  `permission denied for function`, mira ahí.
- La **45** hace que crear un negocio exija código de alta, y **te deja
  fuera hasta que te hagas administrador** (paso 6).

---

## 6. Hacerte administrador

Regístrate en la app apuntando a este proyecto (o crea el usuario desde
**Authentication → Users**), y luego:

```sql
update public.profiles
   set es_admin = true
 where id in (
   select id from auth.users
    where email in ('tu@correo.com', 'el-otro@correo.com')
 );
```

Con eso ya puedes emitir códigos de alta y crear empresas:

```sql
select public.crear_codigo_alta('Pruebas', 365);
```

---

## 7. Comprobar que quedó bien

**Que no falta ninguna función** (compara con producción):

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f';
```

**Que no hay nada abierto a `public`** — debe dar cero filas:

```sql
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and (p.proacl is null or array_to_string(p.proacl,',') like '=X/%');
```

**Que la RLS está puesta en todas las tablas** — debe dar cero:

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

**Y los dos jobs de cron:**

```sql
select jobname, schedule, active from cron.job order by jobid;
```

---

## 8. Lo que NO hay que copiar a staging

- **`app_config`**: las claves del push y del respaldo. Si las copias, el
  staging mandaría notificaciones reales a los móviles de la plantilla y
  escribiría en el repositorio de respaldos de producción. Déjalo vacío: sin
  esas filas, ambas cosas no hacen nada, que es justo lo que quieres.
- **Las Edge Functions**, por lo mismo. Solo si vas a probar algo de push.
- **Datos reales.** Para poblarlo, usa el botón de **negocio de demostración**
  de la consola: crea equipo, cuadrante y fichajes inventados en un clic.

---

## 9. Cómo se usa a partir de aquí

La regla es simple: **cada migración nueva se ejecuta primero aquí.** Si pasa
sin errores y la app sigue funcionando, entonces va a producción.

Para probar también el cliente contra staging habría que apuntar
`js/supabase.js` a este proyecto, y eso hoy está escrito a fuego. Cuando haga
falta lo resolvemos; para validar SQL —que es el 90% del riesgo— no hace
falta tocar nada.
