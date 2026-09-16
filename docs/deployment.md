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

| #   | Decisión              | Estado                                                                         |
| --- | --------------------- | ------------------------------------------------------------------------------ |
| 1   | Dónde corre la API    | ✅ **Dokploy** en servidor propio (§3).                                        |
| 2   | Dónde vive PostgreSQL | ✅ Servicio **PostgreSQL 16 ya existente** en Dokploy.                         |
| 3   | Dónde vive el storage | ✅ Servicio **MinIO ya existente** en Dokploy.                                 |
| 4   | Dominio y DNS         | ✅ **`fotoproy.apx5.com`** para la API. Falta decidir el subdominio del MinIO. |

### 2.2 Credenciales y accesos

| #   | Qué                                                 | Cómo se obtiene                                                        | Estado   |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| 5   | **MinIO**: endpoint interno, usuario/clave y bucket | Panel de Dokploy → servicio MinIO (credenciales y URL interna)         | ⏳ Falta |
| 6   | **PostgreSQL**: URL interna                         | Panel de Dokploy → servicio PostgreSQL → _Internal Connection URL_     | ⏳ Falta |
| 7   | **Dominio del MinIO** (p. ej. `minio.apx5.com`)     | Dokploy → MinIO → Domains (HTTPS). Necesario para que el teléfono suba | ⏳ Falta |
| 8   | **Expo/EAS + tiendas** (solo F4.6)                  | expo.dev · Apple Developer 99 USD/año · Google Play 25 USD único       | ⏳ Falta |

### 2.3 Valores que puedo generar yo

- `JWT_SECRET` → `openssl rand -hex 32`
- `PUBLIC_BASE_URL` y `CORS_ORIGIN` → `https://fotoproy.apx5.com`

**No me pegues secretos en el chat.** Se escriben en el panel de Dokploy
(Environment) o en `apps/api/.env` del servidor (`chmod 600`, fuera de Git).

---

## 3. Despliegue en Dokploy (vía elegida)

Dokploy construye la imagen desde el Dockerfile del repositorio y publica el
contenedor detrás de **Traefik** (dominio + certificado TLS automáticos). No se
usa `docker-compose.prod.yml` ni el contenedor de Caddy en esta vía.

> Remoto: `git@github.com:auracore-sas/fotoproy.git`, rama `main`. En esta
> máquina el remoto usa el alias SSH `github.com-auracore-sas` porque la clave
> por defecto pertenece a otra cuenta de GitHub.

### 3.1 Crear la aplicación

1. Dokploy → proyecto de FotoProy → **Create Application**.
2. **Source**: Git. Conecta GitHub (Settings → Git → GitHub App) y elige
   `auracore-sas/fotoproy`, rama **`main`**. Sin integración: usar una
   **Deploy Key** de solo lectura.
3. **Build Type**: `Dockerfile` (ruta `Dockerfile`, contexto raíz).
4. **Port**: `4100`.
5. Activa el autodeploy si quieres que cada `git push` a `main` despliegue.

### 3.2 Variables de entorno

Pestaña **Environment** de la aplicación. Plantilla: `apps/api/.env.production.example`.

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

# MinIO: interno para la API, público para firmar las URLs que usa el teléfono
STORAGE_ENDPOINT=http://minio-interno:9000
STORAGE_PUBLIC_ENDPOINT=https://minio.apx5.com
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

### 3.3 MinIO (storage de las fotos)

- **Dos endpoints, un solo bucket.** La API habla con el MinIO por su URL
  interna (rápido, sin salir del servidor). El teléfono, en cambio, recibe
  **pre-signed URLs** que se firman contra `STORAGE_PUBLIC_ENDPOINT`: firma y
  host deben coincidir, así que ese endpoint tiene que ser el dominio público.
- **Dale un dominio al MinIO en Dokploy** (`minio.apx5.com`, HTTPS). Sin él, el
  teléfono no puede subir ni ver fotos: `STORAGE_PUBLIC_ENDPOINT` apuntaría a un
  host interno inalcanzable.
- **Bucket**: la API lo crea solo al arrancar (`fotoproy`). Basta con que las
  credenciales tengan permiso de escritura.
- **CORS**: MinIO no implementa la API de CORS del bucket y no hace falta: las
  apps nativas ignoran CORS y la web pública sirve los medios por el proxy de la
  API (`/s/:token/media/...`), nunca directo contra MinIO.
- **Endurecimiento recomendado**: en lugar del usuario root de MinIO, crear un
  usuario dedicado con política sobre el bucket, y no publicar la consola del
  MinIO más allá de lo necesario.
- La consola web de MinIO **no** debe ser el mismo dominio que sirve los
  objetos: usa el dominio de la API S3 (puerto 9000) para
  `STORAGE_PUBLIC_ENDPOINT`.

### 3.4 Dominio de la API

1. Registro **A** `fotoproy.apx5.com` → IP del servidor (espera la propagación).
2. Dokploy → aplicación → **Domains** → Add Domain: host `fotoproy.apx5.com`,
   puerto `4100`, HTTPS activado.
3. Configurar el dominio **antes** del primer despliegue evita el problema
   típico de un contenedor que no alcanza la base de datos interna (Dokploy
   conecta el contenedor a su red de Traefik al añadir el dominio).

### 3.5 Desplegar

1. **Deploy**. El arranque ejecuta `prisma migrate deploy` y después la API.
2. Los logs deben mostrar `[entrypoint] Migrations up to date.`,
   `Signed URLs use https://minio.apx5.com ...` y
   `Nest application successfully started`.
3. Cuando el esquema ya esté aplicado puedes poner
   `RUN_MIGRATIONS_ON_START=false` para arrancar más rápido; entonces las
   migraciones hay que aplicarlas a mano en cada release (Dokploy → Terminal:
   `pnpm --filter @fotoproy/database db:deploy`).

### 3.6 Verificar

1. `curl https://fotoproy.apx5.com/health` → `{"status":"ok","db":"up",...}`
2. En la app: crear proyecto, subir una foto (debe ir a MinIO) y verla en la
   galería.
3. Crear un enlace compartido (_Compartir avance_) y abrirlo **desde datos
   móviles, fuera de la WiFi de la oficina**. Ese es el DoD de F2.4.

Diagnóstico rápido: si el contenedor no alcanza la base de datos interna,
revisa en este orden (a) dominio configurado, (b) host interno correcto en
`DATABASE_URL`, (c) ambos servicios en el mismo proyecto de Dokploy. Si las
fotos no suben desde el teléfono, revisa `STORAGE_PUBLIC_ENDPOINT` y que el
dominio del MinIO resuelva por HTTPS.

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
- [ ] Datos del MinIO (endpoint interno, claves, bucket) y URL interna del
      PostgreSQL cargados en Dokploy.
- [ ] Dominio del MinIO con HTTPS (`minio.apx5.com`) para que el teléfono suba.
- [ ] Despliegue verificado: `/health` público + enlace de solo lectura abierto
      desde fuera de la LAN, y subida de una foto desde el móvil.
- [ ] CI de despliegue (opcional): hoy el release es `git push` + Deploy.
