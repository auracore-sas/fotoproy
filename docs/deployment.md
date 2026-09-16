# FotoProy — despliegue en producción (F2.4)

> Runbook para llevar el backend de FotoProy a un servidor real y que los
> **enlaces de solo lectura** funcionen desde fuera de la LAN (el pendiente
> crítico de negocio del roadmap).
>
> Estado: **infraestructura lista y verificada** (imagen Docker, Compose de
> producción, Caddy con TLS, script de despliegue, migraciones al arrancar).
> Falta ejecutarla con el dominio y las credenciales R2 reales — ver §2.

---

## 1. Qué se despliega

| Pieza            | Decisión                                                        | Notas                                                                                                      |
| ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| API (NestJS)     | Contenedor Docker (`Dockerfile`, raíz del repo)                 | Puerto interno `4100`, escucha en `0.0.0.0`.                                                               |
| TLS / proxy      | Según el host: **Dokploy+Traefik** · Caddy · TLS del PaaS       | Dokploy y los PaaS lo gestionan solos; en VPS desnudo lo hace `deploy/caddy/Caddyfile`.                    |
| PostgreSQL 16    | El que ya tengas (Dokploy, Neon, RDS…) o el contenedor opcional | PostGIS **no** hace falta: las coordenadas son `Decimal` (decisión F0.4).                                  |
| Archivos (fotos) | Cloudflare R2 (S3 API)                                          | El bucket queda **privado**; la app sube con pre-signed URLs y la web pública pasa por el proxy de la API. |
| Migraciones      | `prisma migrate deploy`                                         | Automáticas al arrancar con `RUN_MIGRATIONS_ON_START=true`, o manuales con `scripts/deploy.sh`.            |
| App móvil        | Expo / EAS (F4.6)                                               | `EXPO_PUBLIC_API_URL` se **hornea en el build**: apuntar a producción exige build nuevo.                   |

El móvil **no** se despliega aquí: solo la API. Sin el despliegue, los enlaces
`http://192.168.x.x:4100/s/<token>` solo abren dentro de la red de la oficina.

---

## 2. Lo que necesito de ti

Nada de esto está en el repo (son cuentas, credenciales y decisiones tuyas).

### 2.1 Decisiones

| #   | Decisión              | Estado                                                                                        |
| --- | --------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Dónde corre la API    | ✅ **Dokploy** en servidor propio (opción A, §3). Alternativas: VPS desnudo (§4) o PaaS (§5). |
| 2   | Dónde vive PostgreSQL | ✅ **PostgreSQL 16 ya existente en Dokploy**.                                                 |
| 3   | Dominio y DNS         | ⏳ Falta: subdominio tipo `api.tudominio.com` apuntando al servidor (DNS en Cloudflare).      |

### 2.2 Credenciales y accesos

| #   | Qué                                                           | Dónde se saca                                                    | Estado   |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| 4   | **Cloudflare R2**: bucket + API token (_Object Read & Write_) | Cloudflare → R2 → Manage API tokens                              | ⏳ Falta |
| 5   | **Acceso al servidor Dokploy**                                | Ya disponible (panel Dokploy)                                    | ✅       |
| 6   | **Expo/EAS + tiendas** (solo F4.6)                            | expo.dev · Apple Developer 99 USD/año · Google Play 25 USD único | ⏳ Falta |

### 2.3 Valores que puedo generar yo

- `JWT_SECRET` → `openssl rand -hex 32`
- `PUBLIC_BASE_URL` y `CORS_ORIGIN` → el dominio elegido
- `DATABASE_URL` → la URL **interna** que muestra Dokploy en tu servicio Postgres

**No me pegues secretos en el chat.** Se escriben en el panel de Dokploy o en
`apps/api/.env` del servidor (permisos `600`, fuera de Git).

---

## 3. Opción A — Dokploy (tu servidor, vía elegida)

Dokploy construye la imagen desde el Dockerfile del repositorio y publica el
contenedor detrás de **Traefik**, que resuelve el dominio y el certificado TLS
de Let's Encrypt. No se usa `docker-compose.prod.yml` ni el contenedor de Caddy.

> El repositorio remoto es `git@github.com:auracore-sas/fotoproy.git` (rama
> `main`). En esta máquina el remoto usa el alias SSH `github.com-auracore-sas`
> porque la clave por defecto pertenece a otra cuenta.

### 3.1 Crear la aplicación

1. Dokploy → proyecto de FotoProy → **Create Application**.
2. **Source**: Git. Conecta GitHub (Settings → Git → GitHub App) y elige
   `auracore-sas/fotoproy`, rama **`main`**. Alternativa sin integración: pegar
   la URL del repositorio y usar una **Deploy Key** con permiso de lectura.
3. **Build Type**: `Dockerfile` (ruta `Dockerfile`, contexto raíz).
4. **Port**: `4100`.
5. Activa el autodeploy si quieres que cada `git push` a `main` despliegue.

### 3.2 Variables de entorno

En la pestaña **Environment** de la aplicación. Plantilla completa:
`apps/api/.env.production.example`.

```bash
NODE_ENV=production
PORT=4100

# URL INTERNA del PostgreSQL que ya tienes en Dokploy
# (servicio de base de datos → Connection URL / Internal)
DATABASE_URL=postgresql://usuario:password@host-interno:5432/basededatos?schema=public

# openssl rand -hex 32
JWT_SECRET=<secreto-de-64-hex>
JWT_EXPIRES_IN=7d

# Dominio público de la API (el mismo que pongas en la pestaña Domains)
PUBLIC_BASE_URL=https://api.tudominio.com
CORS_ORIGIN=https://api.tudominio.com

# Cloudflare R2
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=<r2-access-key-id>
STORAGE_SECRET_ACCESS_KEY=<r2-secret-access-key>
STORAGE_BUCKET=fotoproy
STORAGE_FORCE_PATH_STYLE=false
STORAGE_SIGNED_URL_TTL=3600
STORAGE_GENERATE_THUMBS=true
STORAGE_STAMP_PHOTOS=true

# Aplica las migraciones Prisma al arrancar el contenedor (idempotente).
RUN_MIGRATIONS_ON_START=true
```

Tras cambiar variables hay que **redesplegar**: Dokploy no las lee en caliente.

### 3.3 Dominio

1. Crea el registro **A** `api.tudominio.com` → IP del servidor (espera la
   propagación antes de seguir).
2. Dokploy → aplicación → **Domains** → Add Domain: host `api.tudominio.com`,
   puerto `4100`, HTTPS activado (Let's Encrypt).
3. Dokploy añade las etiquetas de Traefik y conecta el contenedor a su red.
   Configurar el dominio **antes** del primer despliegue evita el problema
   típico de un contenedor que no alcanza la base de datos interna.

### 3.4 Desplegar

1. Pulsa **Deploy**. El arranque ejecuta `prisma migrate deploy` (por
   `RUN_MIGRATIONS_ON_START=true`) y después la API.
2. Los logs deben mostrar `[entrypoint] Migrations up to date.` y
   `Nest application successfully started`.
3. Cuando el esquema ya esté aplicado puedes poner
   `RUN_MIGRATIONS_ON_START=false` para arrancar más rápido, pero entonces las
   migraciones hay que aplicarlas a mano en cada release (Dokploy → Terminal:
   `pnpm --filter @fotoproy/database db:deploy`).

### 3.5 Verificar

1. `curl https://api.tudominio.com/health` → `{"status":"ok","db":"up",...}`
2. En la app: crear proyecto, subir una foto (debe ir a R2) y verla en la galería.
3. Crear un enlace compartido (_Compartir avance_) y abrirlo **desde datos
   móviles, fuera de la WiFi de la oficina**. Ese es el DoD de F2.4.

Si el contenedor no alcanza la base de datos interna, revisa en este orden:
dominio configurado (red de Traefik), host interno correcto en `DATABASE_URL` y
que ambos servicios estén en el mismo proyecto de Dokploy.

---

## 4. Opción B — VPS desnudo (Docker + Caddy)

Cuando el servidor no tiene Dokploy ni otro proxy. Es la vía que cubren
`docker-compose.prod.yml`, `deploy/caddy/Caddyfile` y `scripts/deploy.sh`.

### 4.1 Provisionar el servidor

1. VPS con **Ubuntu 24.04 LTS**, mínimo **2 vCPU / 4 GB RAM / 40 GB SSD**
   (la imagen compila TypeScript y usa `sharp`; con 2 GB el build va justo).
2. Docker Engine + Compose plugin.
3. Usuario sin privilegios con SSH por clave **y `PermitRootLogin no`**.
4. Firewall (`ufw`): permitir **22, 80, 443** y nada más.

### 4.2 DNS y R2

Registro **A** `api.tudominio.com` → IP del servidor. En R2: bucket nuevo
(privado) y un token con _Object Read & Write_; la API aplica la CORS del bucket
sola en el arranque.

### 4.3 Primer despliegue

```bash
git clone git@github.com:auracore-sas/fotoproy.git fotoproy && cd fotoproy

cat > .env <<'EOF'
DOMAIN=api.tudominio.com
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
| Backup de la base    | Desde Dokploy (Backups del servicio de base de datos) o `pg_dump` del contenedor                    |
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
2. `EXPO_PUBLIC_API_URL=https://api.tudominio.com eas build --profile production`
3. Subir la versión en `apps/mobile/app.json` y el build number.
4. TestFlight (iOS) + Play Console Internal Testing (Android); `eas update` para
   los siguientes cambios de JavaScript.

La app seguirá funcionando **offline** igual que ahora: el modo avión, la cola
de sincronización y los planos offline no dependen del despliegue.

---

## 9. Coste estimado

| Pieza                         | Coste                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| Servidor con Dokploy          | Ya en uso                                                   |
| Dominio                       | ~10–15 USD/año                                              |
| Cloudflare R2                 | 10 GB gratis; después ~0,015 USD/GB/mes + egreso (muy bajo) |
| PostgreSQL                    | Ya en Dokploy                                               |
| Apple Developer + Google Play | 99 USD/año + 25 USD único (solo para distribuir la app)     |

---

## 10. Qué queda de F2.4

- [x] Imagen Docker de la API (con migraciones opcionales al arrancar), Compose
      de producción, Caddy con TLS, plantilla de variables, `scripts/deploy.sh`
      y este runbook.
- [x] Repositorio remoto en GitHub (`auracore-sas/fotoproy`) con `main` y tags.
- [ ] Dominio (subdominio + DNS) y bucket/token R2 reales.
- [ ] Aplicación creada en Dokploy, variables cargadas y despliegue verificado:
      `/health` público + enlace de solo lectura abierto desde fuera de la LAN.
- [ ] CI de despliegue (opcional): hoy el release es `git push` + Deploy.
