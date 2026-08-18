# Baseline del esquema — estado real a 2026-08-18

Reconstrucción del esquema vivo en Supabase, obtenida con
[../tools/volcar_esquema.sql](../tools/volcar_esquema.sql). Sustituye a las
migraciones 1–32, que nunca se versionaron. A partir de aquí, `sql/033…` en
adelante se aplica encima de esto.

**Sirve para levantar el esquema desde cero en un proyecto Supabase nuevo** —
que es justo lo que hace falta para aprovisionar un segundo negocio o un piloto.

## Orden de ejecución

| | Archivo | Qué hace |
|---|---|---|
| 1 | `01_tablas.sql` | Extensiones y `create table`, sin claves ajenas |
| 2 | `02_restricciones.sql` | Claves primarias/ajenas, checks, únicos e índices |
| 3 | `03_funciones.sql` | Todas las funciones y RPC |
| 4 | `04_triggers.sql` | Triggers |
| 5 | `05_rls.sql` | RLS y políticas |
| 6 | `06_cron_realtime.sql` | pg_cron y publicación de Realtime |

Las claves ajenas van separadas de las tablas a propósito: `requests.entry_id`
apunta a `time_entries` y `time_entries.request_id` apunta a `requests`. Es una
referencia circular y no hay orden de creación que la resuelva en línea.

## Qué NO está aquí

- **El trigger sobre `auth.users`.** La función `handle_new_user()` sí está en
  `03_funciones.sql`, pero su trigger vive en el esquema `auth`, que el volcado
  (limitado a `public`) no recoge. Sin él, un usuario nuevo no obtiene fila en
  `profiles` y la app no arranca para él. Está anotado en `04_triggers.sql`:
  **hay que verificarlo a mano en un proyecto nuevo.**
- **`rls_auto_enable()`**, que es de Supabase, no de la aplicación.
- **Los `grant` / `revoke` sobre funciones.** El volcado da la definición, no la
  ACL. Ver el aviso de seguridad de abajo: importa más de lo que parece.
- **Secretos.** Ver abajo.

## Aviso de seguridad: `trg_enviar_push`

En la base de datos real, esa función lleva **escrito en su cuerpo** el bearer
token de la Edge Function de push y la URL del proyecto. Aquí van redactados a
propósito: este archivo va a git, y el repositorio se publica por GitHub Pages.

Antes de usar este baseline en producción hay que:

1. Rotar el token (cambiarlo en la Edge Function y en la función).
2. Guardarlo fuera del código —lo natural es una fila en una tabla de
   configuración solo accesible por `service_role`, o un ajuste de base de datos—
   y que `trg_enviar_push` lo lea de ahí.
3. No volver a pegarlo en un archivo versionado.

**Ya hay arreglo, en la migración 39**, que crea `app_config` y hace que la
función lea el secreto de ahí. Este baseline refleja el estado ANTERIOR (así
tiene que ser: las migraciones 33+ se aplican encima). En un proyecto nuevo,
ejecuta el baseline y después las migraciones, y el secreto nunca llega a estar
en el código.

La migración 39 arregla además lo de fondo: la Edge Function **nunca comprobaba
ese token**, así que `enviar-push` era un endpoint público sin autenticar. Ahora
valida la cabecera. Ver `edge/enviar-push/index.ts`.
