# FotoProy — despliegue en producción (F2.4)

> Runbook para llevar el backend de FotoProy a un servidor real y que los
> **enlaces de solo lectura** funcionen desde fuera de la LAN (el pendiente
> crítico de negocio del roadmap).
>
> Estado: **infraestructura lista y verificada** (imagen Docker, Compose de
> producción, Caddy con TLS, script de despliegue, migraciones al arrancar,
> endpoint interno/público de storage). Falta cargar las variables en Dokploy y
> desplegar — ver §3.

---

## 1. Qué se despliega

| Pieza            | Decisión                                        | Notas                                                                                        |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| API (NestJS)     | Contenedor Docker (`Dockerfile`, raíz del repo) | Puerto interno `4100`, escucha en `0.0.0.0`. **Stateless**: no escribe nada en disco.        |
| TLS / proxy      | **Dokploy + Traefik** (ya instalado)            | Dokploy añade las etiquetas de Traefik y emite el certificado Let's Encrypt.                 |
| PostgreSQL 16    | El servicio que **ya corre en Dokploy**         | PostGIS **no** hace falta: las coordenadas son `Decimal` (decisión F0.4).                    |
| Archivos (fotos) | El **MinIO que ya corre en Dokploy** (S3 API)   | El bucket queda privado; la API sube/baja con pre-signed URLs y la web pública va por proxy. |
| Migraciones      | `prisma migrate deploy`                         | Automáticas al arrancar con `RUN_MIGRATIONS_ON_START=true`.                                  |
| App móvil        | Expo / EAS (F4.6)                               | `EXPO_PUBLIC_API_URL` se **hornea en el build**: apuntar a producción exige build nuevo.     |

El móvil **no** se despliega aquí: solo la API. Sin el despliegue, los enlaces
`http://192.168.x.x:4100/s/<token>` solo abren dentro de la red de la oficina.

### Datos en el servidor (`/srv/fotoproy`)

**La aplicación de la API no necesita ningún volumen**: no guarda archivos en
disco (las fotos van a MinIO, los thumbnails se generan en memoria y se suben).
Los datos reales viven en los volúmenes de los servicios **MinIO** y
**PostgreSQL** que gestiona Dokploy, y ahí es donde tiene sentido apuntar a
`/srv/fotoproy` si quieres tenerlos bajo esa ruta (se configura en cada servicio
de base de datos/almacenamiento del panel, no en la aplicación de la API).

---

## 2. Lo que necesito de ti

### 2.1 Decisiones

| #   | Decisión              | Estado                                                                                        |
| --- | --------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Dónde corre la API    | ✅ **Dokploy** en servidor propio (§3).                                                       |
| 2   | Dónde vive PostgreSQL | ✅ Servicio **PostgreSQL 16 ya existente** en Dokploy.                                        |
| 3   | Dónde vive el storage | ✅ **MinIO ya existente** en Dokploy: `minio:9000` interno, datos en `/srv/minio/data`.       |
| 4   | Dominio de la API     | ✅ **`fotoproy.apx5.com`** (etiquetas de Traefik en el compose).                              |
| 5   | Dominio del MinIO     | ✅ API S3 **`minio-api.apx5.com`** (puerto 9000); la consola vive en `minio.apx5.com` (9001). |

### 2.2 Credenciales y accesos

| #   | Qué                                | Cómo se obtiene                                                                           | Estado   |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| 7   | **MinIO**: Access Key / Secret Key | Consola `minio.apx5.com` → Identity → Users (o `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) | ⏳ Falta |
| 8   | **PostgreSQL**: URL interna        | Panel de Dokploy → servicio PostgreSQL → _Internal Connection URL_                        | ⏳ Falta |
| 9   | **JWT_SECRET**                     | `openssl rand -hex 32` (lo genero yo)                                                     | ⏳ Falta |
| 10  | **Expo/EAS + tiendas** (solo F4.6) | expo.dev · Apple Developer 99 USD/año · Google Play 25 USD único                          | ⏳ Falta |

### 2.3 Valores que puedo generar yo

- `JWT_SECRET` → `openssl rand -hex 32`
- `PUBLIC_BASE_URL` y `CORS_ORIGIN` → `https://fotoproy.apx5.com`

**No me pegues secretos en el chat.** Se escriben en el panel de Dokploy
(Environment) o en `apps/api/.env` del servidor (`chmod 600`, fuera de Git).

---

## 3. Despliegue en Dokploy (vía elegida)

Dokploy construye la imagen desde el `Dockerfile` del repositorio y publica el
contenedor detrás de **Traefik**. Tu MinIO y tu PostgreSQL **ya viven en
`dokploy-network`**, así que la API se despliega como **Compose application**
con `docker-compose.dokploy.yml`: ese archivo declara la red como `external` y
mete la API en la misma red, de modo que el alias del MinIO y el host del
PostgreSQL resuelven. Un despliegue de tipo _Application_ (solo Dockerfile)
crea su propia red aislada y no alcanza esos servicios.

> Remoto: `git@github.com:auracore-sas/fotoproy.git`, rama `main`. En esta
> máquina el remoto usa el alias SSH `github.com-auracore-sas` porque la clave
> por defecto pertenece a otra cuenta de GitHub.

### 3.1 Crear la Compose application

1. Dokploy → proyecto de FotoProy → **Create Compose**.
2. **Provider**: Git (o GitHub App) → `auracore-sas/fotoproy`, rama **`main`**.
3. **Compose Path**: `./docker-compose.dokploy.yml`.
4. **No** añadas un dominio en la pestaña _Domains_: el compose ya trae las
   etiquetas de Traefik para `fotoproy.apx5.com`, igual que tu stack de MinIO.
   (Si prefieres usar la UI, borra las etiquetas `traefik.*` del compose y añade
   el dominio con puerto `4100`.)
5. Activa el autodeploy si quieres que cada `git push` a `main` despliegue.

### 3.2 Variables de entorno

Pestaña **Environment** de la Compose application. Plantilla:
`apps/api/.env.production.example`.

```bash
NODE_ENV=production
PORT=4100

# URL INTERNA del PostgreSQL de Dokploy (servicio → Internal Connection URL).
# Usa base de datos y usuario dedicados: Prisma crea sus tablas en `public`.
DATABASE_URL=postgresql://usuario:password@postgres-interno:5432/fotoproy?schema=public

# openssl rand -hex 32
JWT_SECRET=<secreto-de-64-hex>
JWT_EXPIRES_IN=7d

PUBLIC_BASE_URL=https://fotoproy.apx5.com
CORS_ORIGIN=https://fotoproy.apx5.com

# MinIO: interno para la API, público (API S3) para firmar las URLs del teléfono
# STORAGE_ENDPOINT ya está fijado en docker-compose.dokploy.yml
# (http://minio:9000, alias sin guion bajo). Cámbialo en ese archivo si tu
# alias de MinIO es distinto.
STORAGE_PUBLIC_ENDPOINT=https://minio-api.apx5.com
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=<minio-access-key>
STORAGE_SECRET_ACCESS_KEY=<minio-secret-key>
STORAGE_BUCKET=fotoproy
STORAGE_FORCE_PATH_STYLE=true
STORAGE_SIGNED_URL_TTL=3600
STORAGE_GENERATE_THUMBS=true
STORAGE_STAMP_PHOTOS=true

# Aplica las migraciones Prisma al arrancar (idempotente)
RUN_MIGRATIONS_ON_START=true
```

Tras cambiar variables hay que **redesplegar**: Dokploy no las lee en caliente.

> **Cómo llegan las variables al contenedor.** Dokploy escribe la pestaña
> _Environment_ en un `.env` que solo se usa para **interpolar** los `${...}` de
> `docker-compose.dokploy.yml` (`docker compose --env-file` no inyecta nada por
> sí mismo). Todo lo que la API necesita está mapeado explícitamente bajo
> `environment:` en ese archivo, así que ese compose es la fuente de verdad de
> qué recibe el contenedor. Para comprobar el valor real dentro del contenedor:
>
> ```bash
> docker exec fotoproy-api printenv STORAGE_ENDPOINT
> ```

### 3.3 MinIO (el stack que ya tienes)

Tu compose de MinIO publica dos hosts de Traefik: la **consola** en
`minio.apx5.com` (puerto 9001) y el **API S3** en `minio-api.apx5.com` (puerto
9000), y el contenedor responde en `dokploy-network` con los alias
`minio_storage`, `minio` y `plane-minio`. **Usa `minio`** en
`STORAGE_ENDPOINT`: MinIO valida el header `Host` y rechaza con
`400 InvalidRequest (invalid hostname)` cualquier hostname con **guion bajo**
(`minio_storage`), aunque resuelva bien por DNS. Eso se traduce en:

| Rol                 | Valor                                                | Por qué                                                                                                                                  |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| API → MinIO         | `STORAGE_ENDPOINT=http://minio:9000`                 | Tráfico interno por la red de Docker (fijado en el compose). **Alias sin guion bajo**: MinIO rechaza los `Host` inválidos.               |
| Teléfono → MinIO    | `STORAGE_PUBLIC_ENDPOINT=https://minio-api.apx5.com` | El **API S3**, no la consola: una pre-signed URL solo vale para el host con el que se firmó y este es el que el teléfono puede alcanzar. |
| Consola (navegador) | `https://minio.apx5.com`                             | Solo para administrar el MinIO; no se usa en la configuración de la API.                                                                 |

- **Bucket**: `fotoproy`. La API lo crea al arrancar si las credenciales pueden
  crear buckets (el usuario root sí). Con un usuario dedicado, créalo antes en
  la consola.
- **Credenciales**: lo rápido es usar `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.
  Lo recomendable es un usuario dedicado con una política limitada a ese bucket
  (consola → Identity → Policies → Create → Users → Attach):
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
        "Resource": ["arn:aws:s3:::fotoproy"]
      },
      {
        "Effect": "Allow",
        "Action": [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts"
        ],
        "Resource": ["arn:aws:s3:::fotoproy/*"]
      }
    ]
  }
  ```
- **Path style**: MinIO exige `STORAGE_FORCE_PATH_STYLE=true`, así que las URLs
  firmadas tienen la forma `https://minio-api.apx5.com/fotoproy/photos/...`.
- **CORS**: MinIO no implementa la API de CORS del bucket (la API lo registra
  como _debug_ y sigue). No hace falta: las apps nativas ignoran CORS y la web
  pública sirve los medios por el proxy de la API (`/s/:token/media/...`).
- **Datos**: tu volumen ya está en `/srv/minio/data`; la API no necesita
  ningún volumen propio (es stateless).
- Si el teléfono no puede subir, revisa en este orden: (1)
  `STORAGE_PUBLIC_ENDPOINT` apunta al API S3 y no a la consola, (2) el DNS de
  `minio-api.apx5.com` resuelve y responde por HTTPS, (3) la URL firmada abre
  en un navegador con `curl -I`.

#### Cloudflare delante del API S3

`minio-api.apx5.com` está **proxied** por Cloudflare (nube naranja). Verificado:
un GET firmado responde 200 y el mismo objeto **sin firma devuelve 403
AccessDenied**, así que Cloudflare no sirve los objetos privados desde caché.
Pero el plan gratuito limita la **subida a 100 MB**: los vídeos de más de ese
tamaño fallarán con 413 aunque el límite de la app sea 3 minutos. Opciones:

1. Poner ese host en **DNS only** (nube gris): las subidas van directas al
   servidor y desaparece el límite. Es lo recomendado para un API S3.
2. Mantener el proxy y asumir el tope de 100 MB por archivo (limitar la
   duración/bitrate del vídeo en la app).

### 3.4 PostgreSQL

Usa la **Internal Connection URL** del servicio de Dokploy (mismo
`dokploy-network`). Crea una base de datos dedicada (`fotoproy`) con su usuario:
Prisma crea sus tablas en el esquema `public` y no conviene compartirlas con
otra aplicación. Las migraciones las aplica el contenedor al arrancar.

### 3.5 Desplegar

1. **Deploy**. El arranque ejecuta `prisma migrate deploy` y después la API.
2. En los logs deben aparecer `[entrypoint] Migrations up to date.`,
   `Signed URLs use https://minio-api.apx5.com ...` y
   `Nest application successfully started`.
3. Cuando el esquema ya esté aplicado puedes poner
   `RUN_MIGRATIONS_ON_START=false` para arrancar más rápido; entonces las
   migraciones hay que aplicarlas a mano en cada release (Terminal de Dokploy:
   `pnpm --filter @fotoproy/database db:deploy`).

### 3.6 Verificar

1. `curl https://fotoproy.apx5.com/health` → `{"status":"ok","db":"up","storage":"up",...}`.
   El campo `storage` dice si la API alcanza el bucket desde dentro del
   contenedor: `up` (todo bien) · `missing` (alcanza, pero el bucket no existe
   todavía) · `down` (no alcanza `STORAGE_ENDPOINT`). **Solo la base de datos
   hace fallar el endpoint** a propósito: un storage caído no se arregla
   reiniciando el contenedor.
2. En la app: crear proyecto, subir una foto (debe ir a MinIO) y verla en la
   galería.
3. Crear un enlace compartido (_Compartir avance_) y abrirlo **desde datos
   móviles, fuera de la WiFi de la oficina**. Ese es el DoD de F2.4.

#### Verificación automática (recomendada después de cada despliegue)

`pnpm check:prod` recorre el flujo completo contra el entorno indicado: crea una
organización de prueba (nombre `Deploy check <timestamp>`), un proyecto, sube una
foto por la **URL firmada** y comprueba la estampa, el thumbnail y la página web
pública. Deja los identificadores en `production-check.json`.

```bash
API=https://fotoproy.apx5.com pnpm check:prod

# Al terminar, borra todo lo que creó (proyecto en cascada + objetos del bucket):
API=https://fotoproy.apx5.com FILE=production-check.json \
  STORAGE_ENDPOINT=https://minio-api.apx5.com STORAGE_BUCKET=fotoproy \
  STORAGE_ACCESS_KEY_ID=<key> STORAGE_SECRET_ACCESS_KEY=<secret> \
  pnpm check:prod:cleanup
```

> ⚠️ **Escribe datos reales** (una organización y un usuario de prueba). El
> script de limpieza borra el proyecto y los objetos, pero la organización y el
> usuario quedan; bórralos con:
>
> ```sql
> DELETE FROM organizations WHERE "legalName" LIKE 'Deploy check %';
> ```

Diagnóstico rápido: si la API no arranca o no conecta, revisa (a) que el
container esté en `dokploy-network` (el compose lo declara), (b) la URL interna
de PostgreSQL, (c) los logs de `docker logs fotoproy-api`.

Si `/health` devuelve `storage: "down"`, lee el mensaje del log de arranque
(`Cannot create bucket "fotoproy" at http://…`):

| Mensaje                                        | Causa y arreglo                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Invalid Request (invalid hostname)`           | **El alias del MinIO lleva guion bajo** (`minio_storage`). Usa `STORAGE_ENDPOINT=http://minio:9000`. |
| `getaddrinfo EAI_AGAIN` / `ENOTFOUND`          | El contenedor no está en `dokploy-network` (revisa la red de ambos servicios) o el alias no existe.  |
| `ECONNREFUSED` / timeout                       | El nombre resuelve pero nada escucha: puerto equivocado (MinIO S3 = 9000, consola = 9001).           |
| `SignatureDoesNotMatch` / `InvalidAccessKeyId` | Credenciales mal copiadas (espacio o salto de línea al pegarlas en Dokploy).                         |

Como respaldo inmediato, apuntar `STORAGE_ENDPOINT` al endpoint **público**
(`https://minio-api.apx5.com`) funciona siempre porque sale por Traefik; solo
cuesta un salto de red extra.

---

## 4. Opción B — VPS desnudo (Docker + Caddy)

Cuando el servidor no tiene Dokploy ni otro proxy. Es la vía que cubren
`docker-compose.prod.yml`, `deploy/caddy/Caddyfile` y `scripts/deploy.sh`.

1. VPS con **Ubuntu 24.04 LTS**, mínimo **2 vCPU / 4 GB RAM / 40 GB SSD**
   (la imagen compila TypeScript y usa `sharp`; con 2 GB el build va justo).
2. Docker Engine + Compose plugin, usuario sin privilegios con SSH por clave,
   `PermitRootLogin no` y `ufw` permitiendo solo **22, 80, 443**.
3. Registro **A** `fotoproy.apx5.com` → IP del servidor.
4. Desplegar:

```bash
git clone git@github.com:auracore-sas/fotoproy.git fotoproy && cd fotoproy

cat > .env <<'EOF'
DOMAIN=fotoproy.apx5.com
ACME_EMAIL=tu-correo@dominio.com
POSTGRES_PASSWORD=<contraseña larga>
EOF
chmod 600 .env

cp apps/api/.env.production.example apps/api/.env   # editar valores reales
chmod 600 apps/api/.env

bash scripts/deploy.sh --selfhosted-db   # build + migraciones + arranque + health check
```

Sin base de datos en el propio VPS: apuntar `DATABASE_URL` al proveedor y
ejecutar `bash scripts/deploy.sh` **sin** `--selfhosted-db`.

---

## 5. Opción C — PaaS (Fly.io / Railway / Render)

Se reutiliza el mismo `Dockerfile` y las mismas variables de la §3.2. Cambia:

- El proveedor gestiona el TLS: **no** se usa `docker-compose.prod.yml`.
- La base de datos la ofrece el propio PaaS (o Neon). Ajustar `DATABASE_URL`.
- `RUN_MIGRATIONS_ON_START=true` cubre las migraciones sin paso extra.
- `PUBLIC_BASE_URL` = el hostname que asigne el proveedor.

---

## 6. Operación diaria

| Tarea                | Comando                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Publicar una versión | `git push origin main` (autodeploy) o **Deploy** en Dokploy                                         |
| Ver logs             | Dokploy → aplicación → Logs · o `docker compose -f docker-compose.prod.yml logs -f api`             |
| Aplicar migraciones  | Automático con `RUN_MIGRATIONS_ON_START=true`; manual: `pnpm --filter @fotoproy/database db:deploy` |
| Backup de la base    | Desde Dokploy (Backups del servicio PostgreSQL) o `pg_dump` dentro del contenedor                   |
| Rollback de código   | `git revert <commit> && git push` (o desplegar un tag anterior desde Dokploy)                       |

Reglas:

- **Nunca** `prisma migrate dev` en producción: siempre `db:deploy`.
- Las migraciones de este proyecto son aditivas; un rollback de código no
  revierte el esquema. Probar la app contra la base migrada antes de dar por
  bueno el release.
- Rotar `JWT_SECRET` invalida todas las sesiones: hacerlo solo con aviso.

---

## 7. Seguridad mínima antes de exponer la API

Ya viene hecho: HTTPS obligatorio, bucket privado, URLs firmadas con caducidad,
token de enlace hasheado en la base, `no-store` en las páginas públicas, CORS
restringido, contenedor sin privilegios.

**Pendiente de F4.5** (recomendado antes de difundir el enlace a clientes):

- [ ] **Rate limiting** en los endpoints públicos (`/s/:token` y el proxy de
      medios): hoy no hay límite y los enlaces son accesibles sin autenticación.
- [ ] Límite de tamaño de subida y validación estricta zod en todos los endpoints.
- [ ] Borrado de metadatos EXIF en el original antes de publicar.
- [ ] Revisión de secretos (que ningún `.env` haya entrado a Git).
- [ ] **Rotar los secretos que se compartieron en texto plano** (contraseña de
      PostgreSQL, `JWT_SECRET` y credenciales de MinIO).
- [ ] **Usuario dedicado de MinIO** en lugar del root (`admin`): el usuario root
      da acceso a **todos** los buckets del servidor, incluidos los de otros
      proyectos (`plane-uploads`, `aurafac`, `nocodb`…). Política con alcance
      solo a `fotoproy` en §3.3.

---

## 8. App móvil contra producción (F4.6)

`EXPO_PUBLIC_API_URL` se compila dentro del bundle: cambiar la URL exige un
build nuevo, no basta con recargar.

1. Publicar la API primero y verificar `/health` por HTTPS.
2. `EXPO_PUBLIC_API_URL=https://fotoproy.apx5.com eas build --profile production`
3. Subir la versión en `apps/mobile/app.json` y el build number.
4. TestFlight (iOS) + Play Console Internal Testing (Android); `eas update` para
   los siguientes cambios de JavaScript.

La app seguirá funcionando **offline** igual que ahora: el modo avión, la cola
de sincronización y los planos offline no dependen del despliegue.

---

## 9. Coste estimado

| Pieza                         | Coste                                                   |
| ----------------------------- | ------------------------------------------------------- |
| Servidor con Dokploy          | Ya en uso                                               |
| Dominio (`apx5.com`)          | Ya en uso                                               |
| PostgreSQL + MinIO            | Ya en Dokploy                                           |
| Apple Developer + Google Play | 99 USD/año + 25 USD único (solo para distribuir la app) |

---

## 10. Qué queda de F2.4

- [x] Imagen Docker de la API (migraciones opcionales al arrancar), Compose de
      producción, Caddy con TLS, plantilla de variables, `scripts/deploy.sh` y
      este runbook.
- [x] Repositorio remoto en GitHub (`auracore-sas/fotoproy`) con `main` y tags.
- [x] Soporte de **endpoint interno + público** de storage (MinIO de Dokploy).
- [x] MinIO identificado: `minio:9000` interno y API S3 público en
      `minio-api.apx5.com`; `docker-compose.dokploy.yml` para la Compose
      application.
- [x] Claves de MinIO y URL interna del PostgreSQL cargadas en Dokploy: el
      contenedor conecta a la base (`db: up`) y firma/recibe objetos en
      `minio-api.apx5.com`. Pendiente de mejora: usuario dedicado de MinIO en
      lugar del root.
- [x] **Despliegue verificado (2026-09-16)**: `https://fotoproy.apx5.com/health`
      responde `{"status":"ok","db":"up","storage":"up"}`, el arranque
      registra `Bucket "fotoproy" ready at http://minio:9000` y
      `Signed URLs use https://minio-api.apx5.com`, el camino firmado (PUT/GET)
      responde 200 y la página pública con token inválido devuelve la página
      404 correcta (HTML) o JSON según `Accept`.
- [x] **Prueba end-to-end contra producción (2026-09-16)**: organización,
      proyecto, subida firmada (48 KB), foto, estampa quemada, thumbnail y
      enlace de solo lectura abierto en un navegador real desde fuera de la red
      — con los datos de prueba borrados al terminar (`pnpm check:prod` +
      `pnpm check:prod:cleanup`).
- [ ] Falta la subida desde el **teléfono** contra producción (build de F4.6).
- [ ] CI de despliegue (opcional): hoy el release es `git push` + Deploy.
