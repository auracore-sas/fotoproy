# FotoProy — Guía de desarrollo (levantar la app localmente)

> Público: quien desarrolla o prueba FotoProy en su máquina.
> Requisitos previos: **Node 26** (`.nvmrc`), **pnpm 11**, **Docker** con el daemon corriendo, y el repo clonado con `pnpm install` ya ejecutado.

---

## 1. Arranque rápido (día a día)

Desde la raíz del repo, **una sola terminal**:

```bash
pnpm dev:up
```

Ese script hace todo el backend por ti:

1. Levanta los contenedores Docker: **Postgres 16 + PostGIS** (`:55432`) y **MinIO** (`:9000` API / `:9001` consola), y espera a que estén sanos.
2. Detecta la **IP LAN de tu PC** y la escribe automáticamente en los `.env` de desarrollo:
   - `apps/mobile/.env` → `EXPO_PUBLIC_API_URL=http://<tu-ip>:4100`
   - `apps/api/.env` → `STORAGE_ENDPOINT=http://<tu-ip>:9000`
     (si cambiaste de red, solo vuelve a correr `pnpm dev:up`.)
3. Arranca la **API NestJS** en segundo plano (`:4100`, log en `/tmp/fotoproy-api.log`) si no está ya corriendo.
4. Imprime el resumen con los pasos siguientes.

Luego, en una **segunda terminal**, lanza Metro para el celular:

```bash
pnpm dev:mobile     # = cd apps/mobile && pnpm start
```

Escanea el **QR** con **Expo Go** (celular en el mismo WiFi). Listo.

Detener la API de dev:

```bash
pnpm dev:stop       # detiene la API; los contenedores quedan arriba
```

---

## 2. Instalación desde cero (solo la primera vez)

```bash
pnpm install              # instala workspaces + genera Prisma Client
docker compose up -d      # Postgres + MinIO
pnpm db:migrate           # aplica migraciones Prisma (usa packages/database/.env)
pnpm dev:up               # backend arriba + envs con tu IP
pnpm dev:mobile           # terminal 2: Metro/Expo Go
```

> ⚠️ Gotcha de Prisma: si `pnpm install` falla en el `postinstall` de `packages/database`
> (binario aún no generado), usa `pnpm add <pkg> --ignore-scripts` y luego genera a mano:
> `cd packages/database && ./node_modules/.bin/prisma generate`.

---

## 3. Arquitectura local (qué corre en cada puerto)

| Servicio                       | Puerto          | Para qué                                                                                       |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------- |
| Postgres 16 + PostGIS (docker) | **55432**       | Base de datos principal (Prisma)                                                               |
| MinIO (docker)                 | **9000** / 9001 | Storage S3-compatible (objetos de fotos/videos) — mismo código que Cloudflare R2 en producción |
| API NestJS                     | **4100**        | `pnpm dev:api` (watch) · `GET /health`                                                         |
| Metro (Expo)                   | **8081**        | Bundle JS para Expo Go (`pnpm dev:mobile`)                                                     |

Consola web de MinIO: `http://localhost:9001` (usuario/contraseña dev: `fotoproy` / `fotoproy-secret` — ver `docker-compose.yml`). El bucket `fotoproy` y su política CORS se crean solos al arrancar la API.

> No uses los puertos 3000 / 5432 / 5433: están ocupados por otros servicios de la máquina de desarrollo.

---

## 4. Probar en el celular (Expo Go)

1. **PC y celular en el mismo WiFi.**
2. Instala **Expo Go** (Play Store / App Store).
3. `pnpm dev:up` (terminal 1) + `pnpm dev:mobile` (terminal 2).
4. Escanea el **QR** que imprime Metro (en Android: Expo Go → _Scan QR code_).
5. Si Expo Go no conecta: abre en el navegador del celular `http://<tu-ip>:4100/health` (debe responder `{"status":"ok","db":"up",…}`). Revisa el firewall del PC para los puertos **4100** y **9000**.

> No uses `a` / `i` (o `--ios`): abren simuladores. Para probar en físico usa solo el QR.

### Demo M2: modo avión → captura → sync

1. Con internet: entra a un proyecto (así se llena la caché local) y captura una foto normal para verificar.
2. Activa **modo avión** → captura 2–3 fotos → en la galería aparecen con badge **⏫** y la barra dice cuántos faltan.
3. Entra/sal del proyecto: verás el aviso azul "Sin conexión: mostrando datos guardados" (la app sigue funcionando).
4. Quita **modo avión** → las fotos se suben solas (FIFO) y el aviso desaparece.
5. Verifica en el servidor sin duplicados: `curl http://localhost:4100/photos?projectId=<ID> -H "Authorization: Bearer <TOKEN>"` o `pnpm db:studio`.

---

## 5. Comandos útiles

```bash
pnpm dev:up          # backend completo + envs con tu IP (día a día)
pnpm dev:stop        # detiene la API dev
pnpm dev:mobile      # Metro para Expo Go (terminal 2)
pnpm dev:api         # API en primer plano con logs (alternativa a dev:up)
pnpm db:up / db:down # solo contenedores
pnpm db:studio       # explorar la BD (Prisma Studio)
pnpm typecheck       # tsc --noEmit en todos los paquetes
pnpm lint            # ESLint (debe quedar en 0)
pnpm build           # compila todo en orden topológico
pnpm format          # Prettier (correr antes de commit)

# Descargar una foto almacenada (original + thumbnail) con URL firmada:
pnpm photo:download <photoId> [carpetaSalida]
```

Logs de la API en background: `tail -f /tmp/fotoproy-api.log`

---

## 6. Solución de problemas frecuentes

| Síntoma                                                | Causa probable                                                    | Solución                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| "No se puede conectar con el servidor" al abrir la app | La API no está corriendo (se apagó con el PC)                     | `pnpm dev:up` y recarga Expo Go (sacude → _Reload_)                                                           |
| Expo Go no encuentra la app                            | Cambió tu IP o firewall                                           | `pnpm dev:up` (reescribe los `.env` con la IP actual), verifica `http://<tu-ip>:4100/health` desde el celular |
| Las fotos no suben desde el celular                    | `STORAGE_ENDPOINT` apunta a `localhost`                           | Vuelve a correr `pnpm dev:up` (lo deja en `http://<tu-ip>:9000`) y reinicia la app                            |
| Error de migración local (SQLite) al abrir la app      | Versión vieja del bundle                                          | Recarga Expo Go; las migraciones locales son versionadas (`PRAGMA user_version`)                              |
| El aviso "Sin conexión" no desaparece                  | Servidor inalcanzable con internet activo                         | La app reintenta cada ~5 s; si persiste, revisa que la API siga viva (`pnpm dev:up`)                          |
| MinIO muestra warning de CORS al arrancar la API       | Esperado: MinIO no implementa el API S3 de CORS (R2/S3 reales sí) | Ignorar; es solo un log `DEBUG`                                                                               |

---

## 7. Reglas que aplican siempre (resumen)

- **Código y BD en inglés**; documentación (`docs/`, README, ROADMAP) y textos de UI en español.
- Fotos/pines/comentarios son **append-only** con UUID v4 de cliente (idempotencia offline).
- Toda query de la API filtra por `organizationId` (org-scoping).
- Migraciones: crear **nueva** migración, nunca editar las aplicadas (Prisma y SQLite local).
- No commitear `.env` (solo `.env.example`).
- Detalles completos en [AGENTS.md](../AGENTS.md).
