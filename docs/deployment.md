# FotoProy — despliegue en producción (F2.4)

> Runbook para llevar el backend de FotoProy a un servidor real y que los
> **enlaces de solo lectura** funcionen desde fuera de la LAN (el pendiente
> crítico de negocio del roadmap).
>
> Estado: **infraestructura lista en el repo** (imagen Docker, Compose de
> producción, Caddy con TLS, script de despliegue). Falta ejecutarlo con las
> credenciales y el dominio reales — ver §2.

---

## 1. Qué se despliega

| Pieza            | Decisión por defecto                            | Notas                                                                                                      |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| API (NestJS)     | Contenedor Docker (`Dockerfile`, raíz del repo) | Puerto interno `4100`, escucha en `0.0.0.0`.                                                               |
| TLS / proxy      | Caddy 2 (`deploy/caddy/Caddyfile`)              | Certificado de Let's Encrypt automático y renovación. Es el único contenedor con 80/443.                   |
| PostgreSQL 16    | Contenedor en el mismo host **o** gestionado    | PostGIS **no** hace falta: las coordenadas son `Decimal` (decisión F0.4).                                  |
| Archivos (fotos) | Cloudflare R2 (S3 API)                          | El bucket queda **privado**; la app sube con pre-signed URLs y la web pública pasa por el proxy de la API. |
| App móvil        | Expo / EAS (F4.6)                               | `EXPO_PUBLIC_API_URL` se **hornea en el build**: apuntar a producción exige build nuevo.                   |

El móvil **no** se despliega aquí: solo la API. Sin el despliegue, los enlaces
`http://192.168.x.x:4100/s/<token>` solo abren dentro de la red de la oficina.

---

## 2. Lo que necesito de ti

Nada de esto está en el repo (son cuentas, credenciales y decisiones tuyas).

### 2.1 Decisiones (3)

| #   | Decisión              | Opciones                                           | Recomendación                                                                                                                |
| --- | --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dónde corre la API    | VPS con Docker · Fly.io · Railway · Render         | **VPS con Docker** (opción A): control total, la más barata, `sharp` y Prisma sin sorpresas.                                 |
| 2   | Dónde vive PostgreSQL | Contenedor en el mismo VPS · Neon · Supabase · RDS | **Contenedor en el mismo VPS** al inicio (menos piezas, un solo backup). Neon si prefieres cero mantenimiento.               |
| 3   | Dominio y DNS         | ¿Ya tienes dominio? ¿El DNS está en Cloudflare?    | Un subdominio tipo `api.tudominio.com` apuntando al servidor. Cloudflare para el DNS (gratis y es el mismo proveedor de R2). |

### 2.2 Credenciales y accesos (3)

| #   | Qué                                                   | Dónde se saca                                                                      | Formato que necesito                                              |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 4   | **Cloudflare R2**: cuenta, bucket y API token         | Cloudflare → R2 → _Manage API tokens_ (permiso **Object Read & Write** del bucket) | `ACCOUNT_ID`, Access Key ID, Secret Access Key, nombre del bucket |
| 5   | **Acceso al servidor** (si VPS)                       | Proveedor (Hetzner / DigitalOcean / Contabo / Vultr)                               | IP pública, usuario SSH y clave; o el token del PaaS              |
| 6   | **Expo/EAS + tiendas** (solo F4.6, no bloquea la API) | expo.dev · Apple Developer (99 USD/año) · Google Play (25 USD único)               | Cuentas y tokens                                                  |

### 2.3 Valores que puedo generar yo

Estos los genero o los calculo en el servidor; no necesito que me los mandes:

- `JWT_SECRET` → `openssl rand -hex 32`
- `DATABASE_URL`, `POSTGRES_PASSWORD` → los fija el servidor
- `PUBLIC_BASE_URL=https://api.tudominio.com`
- `CORS_ORIGIN=https://api.tudominio.com`

**No me pegues secretos en el chat.** Se escriben directamente en
`apps/api/.env` del servidor (permisos `600`, fuera de Git).

---

## 3. Opción A — VPS con Docker (recomendada)

### 3.1 Provisionar el servidor

1. VPS con **Ubuntu 24.04 LTS**, mínimo **2 vCPU / 4 GB RAM / 40 GB SSD**
   (la imagen compila TypeScript y usa `sharp`; con 2 GB el build va justo).
2. Instalar Docker Engine + Compose plugin.
3. Usuario sin privilegios con SSH por clave **y `PermitRootLogin no`**.
4. Firewall (`ufw`): permitir **22, 80, 443** y nada más. El puerto 4100
   queda publicado solo en loopback (`127.0.0.1`), nunca expuesto a Internet.

### 3.2 DNS

Crear un registro **A** `api.tudominio.com` → IP del servidor.
Esperar la propagación antes de arrancar Caddy (si no, Let's Encrypt falla).

### 3.3 Cloudflare R2

1. R2 → **Create bucket** (por ejemplo `fotoproy`) → **no** activar acceso público.
2. R2 → **API** → **Manage API tokens** → token con **Object Read & Write**
   sobre ese bucket.
3. Anotar: `ACCOUNT_ID`, Access Key ID, Secret Access Key.
4. La API aplica la política CORS del bucket en el arranque (idempotente), así
   que no hay que tocar nada en el panel.

### 3.4 Primer despliegue

En el servidor:

```bash
# 1. Código
git clone <repo> fotoproy && cd fotoproy     # o git pull si ya está

# 2. Configuración del stack (dominio + Let's Encrypt)
cat > .env <<'EOF'
DOMAIN=api.tudominio.com
ACME_EMAIL=tu-correo@dominio.com
POSTGRES_PASSWORD=<una contraseña larga y aleatoria>
EOF
chmod 600 .env

# 3. Configuración de la API
cp apps/api/.env.production.example apps/api/.env
#    editar: DATABASE_URL, JWT_SECRET, CORS_ORIGIN, PUBLIC_BASE_URL, STORAGE_*
chmod 600 apps/api/.env

# 4. Despliegue (build + migraciones + arranque + health check)
bash scripts/deploy.sh --selfhosted-db
```

Sin base de datos en el propio VPS (Neon/Supabase/RDS): apuntar `DATABASE_URL`
al proveedor y ejecutar `bash scripts/deploy.sh` **sin** `--selfhosted-db`.

### 3.5 Verificar

1. `curl https://api.tudominio.com/health` → `{"status":"ok","db":"up",...}`
2. En la app (o por curl), crear un proyecto y una foto → la foto debe subir a
   R2 y verse en la galería.
3. Crear un enlace compartido (pantalla _Compartir avance_) y abrirlo **desde
   datos móviles, fuera de la WiFi de la oficina**. Ese es el DoD de F2.4.
4. Opcional, con base de datos auto-hospedada (crea y borra su propia
   organización de prueba):
   `API_URL=https://api.tudominio.com PG_CONTAINER=fotoproy-db-1 pnpm smoke:shares`

---

## 4. Opción B — PaaS (Fly.io / Railway / Render)

Se reutiliza el mismo `Dockerfile` y las mismas variables de `apps/api/.env`.
Cambia lo siguiente:

- El proveedor gestiona el TLS: **no** se usa `docker-compose.prod.yml` ni el
  contenedor de Caddy.
- La base de datos la ofrece el propio PaaS (o Neon). Ajustar `DATABASE_URL`.
- Las migraciones se ejecutan una vez por release, apuntando a la base de datos
  de producción:

  ```bash
  DATABASE_URL="<prod>" pnpm --filter @fotoproy/database db:deploy
  ```

- `PUBLIC_BASE_URL` = el hostname que asigne el proveedor.

Ventaja: cero mantenimiento del host. Desventaja: menos control y, con
contenedores que se apagan, el arranque de Prisma y `sharp` es más lento en la
primera petición.

---

## 5. Operación diaria

| Tarea                 | Comando                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Desplegar una versión | `bash scripts/deploy.sh` (idempotente)                                                                               |
| Ver logs              | `docker compose -f docker-compose.prod.yml logs -f api`                                                              |
| Aplicar migraciones   | `docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @fotoproy/database db:deploy`                  |
| Backup de la base     | `docker compose -f docker-compose.prod.yml exec db pg_dump -U fotoproy fotoproy \| gzip > backup-$(date +%F).sql.gz` |
| Restaurar             | `gunzip -c backup.sql.gz \| docker compose -f docker-compose.prod.yml exec -T db psql -U fotoproy fotoproy`          |
| Rollback de código    | `git checkout <tag>` y luego `bash scripts/deploy.sh --no-pull`                                                      |
| Parar el stack        | `docker compose -f docker-compose.prod.yml down`                                                                     |

Reglas:

- **Nunca** `prisma migrate dev` en producción: siempre `db:deploy`.
- Las migraciones de este proyecto son aditivas; un rollback de código no
  revierte el esquema. Probar la app contra la base migrada antes de dar por
  bueno el release.
- Programar el backup de la base al menos a diario (`cron`). R2 conserva los
  archivos; versionado de bucket opcional como red de seguridad.
- Rotar `JWT_SECRET` invalida todas las sesiones: hacerlo solo con aviso.

---

## 6. Seguridad mínima antes de exponer la API

Ya viene hecho: HTTPS obligatorio (Caddy), bucket privado, URLs firmadas con
caducidad, token de enlace hasheado en la base, `no-store` en las páginas
públicas, CORS restringido, puerto 4100 no expuesto.

**Pendiente de F4.5** (recomendado antes de difundir el enlace a clientes):

- [ ] **Rate limiting** en los endpoints públicos (`/s/:token` y el proxy de
      medios): hoy no hay límite, y los enlaces son accesibles sin autenticación.
- [ ] Límite de tamaño de subida y validación estricta zod en todos los endpoints.
- [ ] Borrado de metadatos EXIF en el original antes de publicar.
- [ ] Revisión de secretos (que ningún `.env` haya entrado a Git).

---

## 7. App móvil contra producción (F4.6)

`EXPO_PUBLIC_API_URL` se compila dentro del bundle: cambiar la URL exige un
build nuevo, no basta con recargar.

1. Publicar la API primero y verificar `/health` por HTTPS.
2. Build apuntando a producción:
   `EXPO_PUBLIC_API_URL=https://api.tudominio.com eas build --profile production`
3. Subir la versión en `apps/mobile/app.json` y el build number.
4. TestFlight (iOS) + Play Console Internal Testing (Android); `eas update` para
   los siguientes cambios de JavaScript.

La app seguirá funcionando **offline** igual que ahora: el modo avión, la cola
de sincronización y los planos offline no dependen del despliegue.

---

## 8. Coste estimado

| Pieza                         | Coste                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| VPS 4 GB (Hetzner/DO)         | ~5–6 USD/mes                                                |
| Dominio                       | ~10–15 USD/año                                              |
| Cloudflare R2                 | 10 GB gratis; después ~0,015 USD/GB/mes + egreso (muy bajo) |
| PostgreSQL gestionado         | Neon/Supabase tienen plan gratuito suficiente para empezar  |
| Apple Developer + Google Play | 99 USD/año + 25 USD único (solo para distribuir la app)     |

---

## 9. Qué queda de F2.4

- [x] Imagen Docker de la API, Compose de producción, Caddy con TLS, plantilla
      de variables de producción, script de despliegue y este runbook.
- [ ] Servidor, dominio y bucket R2 reales (§2).
- [ ] Despliegue ejecutado y verificado: `/health` público + enlace de solo
      lectura abierto desde fuera de la LAN.
- [ ] CI de despliegue (opcional): hoy el release es `git pull` + `deploy.sh`.
