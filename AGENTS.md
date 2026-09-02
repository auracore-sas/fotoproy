# AGENTS.md — Guía para agentes de código en FotoProy

> **Propósito:** reglas claras y flujos de trabajo para que cualquier agente de código (pi, Claude, Cursor, Copilot…) trabaje de forma consistente en este repositorio, sesión tras sesión.
> **Idioma de este archivo:** español (documentación del equipo). **El código va en inglés** (ver §2).
> **Siempre empezar por:** leer este archivo, [docs/SPEC.md](docs/SPEC.md) (producto) y [ROADMAP.md](ROADMAP.md) (plan/estado).

---

## 1. Contexto del proyecto

**FotoProy** = documentación fotográfica de proyectos de construcción: capturar, almacenar, organizar (fotos ancladas sobre planos/mapas) y compartir (enlaces de solo lectura) fotos ilimitadas de obra, **offline-first**, móvil iOS + Android con un solo código, multi-perfil (civiles, arquitectos, eléctricos, etc.), mercado LATAM.

| Documento                    | Rol                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md) | Especificación de producto/técnica **v2.1** (decisiones cerradas en §10).                                                    |
| [ROADMAP.md](ROADMAP.md)     | Plan de implementación: tareas por fase (F0–F4) con checkboxes, DoD, hitos, riesgos, changelog. **Es el tracker de estado.** |
| [README.md](README.md)       | Inicio rápido + comandos.                                                                                                    |
| [AGENTS.md](AGENTS.md)       | Este archivo: reglas y flujos.                                                                                               |

**Estado actual:** Fase 0 ✅ (M0: monorepo + API `/health`). **Siguiente: Fase 1** (auth JWT, roles, membresías, CRUD proyectos + base de la app Expo). Ver ROADMAP para detalle.

---

## 2. Regla de idioma (obligatoria)

| Dónde                                                                            | Idioma                                                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Código: identificadores, comentarios, logs, mensajes de la API, strings internos | **Inglés**                                                                               |
| Base de datos: tablas, columnas, enums, comentarios del schema                   | **Inglés**                                                                               |
| Estructura: carpetas y nombres de archivo                                        | **Inglés**                                                                               |
| Mensajes de validación zod                                                       | **Inglés** (ya definidos en `@fotoproy/shared`)                                          |
| Documentación: `docs/`, `README.md`, `ROADMAP.md`, `AGENTS.md`                   | **Español**                                                                              |
| Textos visibles de la UI (público LATAM)                                         | **Español**, vía capa i18n (a implementar en F1+) — nunca hardcodear copy en componentes |

---

## 3. Stack efectivo (2026 — ¡no asumir versiones viejas!)

| Capa              | Decisión                                                             | Gotchas                                                                                                                  |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Runtime           | **Node 26** (`.nvmrc`) + **pnpm 11** (`packageManager` en raíz)      | —                                                                                                                        |
| Lenguaje          | **TypeScript 6.0.3** en todo el monorepo                             | **NO usar TS 7.x**: eliminó `moduleResolution: node10` y Nest CLI requiere la API de compilador que recién vuelve en 7.1 |
| Resolución        | Base: `module`/`moduleResolution: node16`                            | `packages/*` emiten CJS; `apps/api` es **ESM** (`"type": "module"`) → **imports relativos con extensión `.js`**          |
| Backend           | **NestJS 12** (ESM) + class-validator/class-transformer instalados   | ValidationPipe global ya configurado                                                                                     |
| ORM/BD            | **Prisma 6.19.3** + PostgreSQL 16/PostGIS (docker)                   | **NO `prisma@latest`** (apunta a 8-rc; v7 exige driver adapters + `prisma.config.ts`). Migrar a 7 = tarea dedicada       |
| Contratos         | **zod en `@fotoproy/shared`** (schemas + tipos derivados)            | Fuente única de contratos app ⇄ API                                                                                      |
| Paquetes internos | `@fotoproy/shared`, `@fotoproy/database` con protocolo `workspace:*` | —                                                                                                                        |

**Puertos locales fijos:** BD docker = **55432**, API dev = **4100** (5432/5433/3000 están ocupados por otros servicios de la máquina — NO usarlos).

---

## 4. Estructura del monorepo

```
fotoproy/
├─ apps/
│  ├─ api/        # NestJS 12 (ESM): API REST — consume @fotoproy/shared y @fotoproy/database
│  └─ mobile/     # 🔜 F1 — Expo + React Native + TS (iOS + Android)
├─ packages/
│  ├─ shared/     # zod schemas + tipos (contrato) — sin dependencias internas
│  └─ database/   # schema.prisma (fuente de verdad BD) + migraciones + re-export del cliente
├─ docs/          # SPEC (v2.1) + archive/ (historial)
├─ docker-compose.yml  # Postgres 16 + PostGIS → localhost:55432
├─ AGENTS.md / README.md / ROADMAP.md
└─ package.json   # workspace raíz + scripts
```

**Regla de dependencias:** `shared` y `database` no dependen de `apps`; `api` (y futura `mobile`) dependen de `shared` y `database` vía `workspace:*`. La API consume Prisma **solo** a través de `@fotoproy/database` (nunca `@prisma/client` directo).

---

## 5. Convenciones de código y datos

1. **Todo en inglés** (§2).
2. **Org-scoping obligatorio**: cada query de la API filtra por `organizationId` del usuario autenticado. Es requisito de seguridad, no opcional (riesgo crítico en ROADMAP).
3. **UUID v4 de cliente + idempotencia**: toda entidad creada en el móvil nace con su propio UUID (`photo.id`, `pin.id`, etc.) → los endpoints aceptan el id del cliente para reintentos sin duplicados.
4. **Append-only**: fotos/pines/comentarios son inmutables (se crean, no se editan). Cero conflictos de escritura offline.
5. **Timestamps**: ISO 8601 UTC. `capturedAt` lo sella el cliente (puede ir desfasado offline); `syncedAt`/`createdAt` los sella el servidor.
6. **BD (Prisma)**: columnas `camelCase`, tablas plural `snake_case` vía `@@map`, enums `Role`/`PlanKind`. El schema Prisma es la fuente de verdad (el DDL de la SPEC es solo informativo).
7. **Cambios de schema**: crear **nueva migración** (`prisma migrate dev --name <corto>`) — nunca editar migraciones ya aplicadas.
8. **Commits**: Conventional Commits en **inglés**, atómicos (`feat:`, `fix:`, `chore:`, `docs:`…). Rama por feature desde `main`.
9. **Docs viven con el código**: al cambiar alcance/estado, actualizar `ROADMAP.md` (checkboxes, DoD, changelog en español) y `SPEC.md` si aplica.

---

## 6. Comandos y flujos de trabajo

### Setup (una vez)

```bash
pnpm install              # instala workspaces + genera Prisma Client
docker compose up -d db   # Postgres 16 + PostGIS en localhost:55432
pnpm db:migrate           # aplica migraciones Prisma (usa packages/database/.env)
```

### Ciclo diario

```bash
pnpm dev:api              # API NestJS en watch → http://localhost:4100
curl http://localhost:4100/health   # {"status":"ok","db":"up",...}
pnpm build                # compila todo en orden topológico
pnpm typecheck            # tsc --noEmit en todos los paquetes
pnpm lint                 # ESLint (debe quedar en 0)
pnpm format               # Prettier (correr antes de commit)
pnpm db:studio            # explorar BD
pnpm db:down              # detener BD docker
```

### Añadir dependencias (siempre dentro del paquete correcto)

```bash
pnpm --filter @fotoproy/api add <pkg>            # dep de runtime
pnpm --filter @fotoproy/shared add -D <pkg>      # dep dev
pnpm --filter @fotoproy/api add @fotoproy/shared@workspace:*   # dep interna
pnpm -w add -D <pkg>                             # dep de la raíz (herramientas)
```

### ⚠️ Gotcha de Prisma (importante)

El `postinstall` de `packages/database` corre `prisma generate` y **falla si el binario aún no existe** (p. ej. al instalar `@prisma/client` antes que `prisma`). Si un install falla por esto:

```bash
pnpm add <pkg> --ignore-scripts        # instala sin postinstall
cd packages/database && ./node_modules/.bin/prisma generate   # genera manualmente
```

### Migraciones

```bash
cd packages/database
./node_modules/.bin/prisma migrate dev --name <nombre_corto>
```

(usa `packages/database/.env`; si hay otro Postgres local corriendo, el puerto correcto es 55432).

---

## 7. Flujo sugerido para resolver una tarea

1. **Localizar la tarea** en `ROADMAP.md` (ID tipo `F1.3`) y leer su DoD + la sección relacionada de `SPEC.md`.
2. **Crear rama** `feat/<descripcion-corta>` desde `main`.
3. **Implementar** siguiendo §5 (contratos en `shared` primero si toca API/móvil).
4. **Verificar**: `pnpm lint` (0), `pnpm typecheck`, `pnpm build`, pruebas manuales (curl / flujo real).
5. **Formatear** (`pnpm format`) y **actualizar ROADMAP** (checkbox [x], notas si hay decisiones, changelog).
6. **Commit** conventional en inglés; si aplica, push + PR.

**Definition of Done (DoD):** lint 0 · typecheck OK · build OK · tarea marcada en ROADMAP · docs afectadas actualizadas · commit atómico en inglés.

---

## 8. Fase 1 (próxima) — qué viene y cómo arrancar

Ver tareas F1.1–F1.10 del ROADMAP. Resumen:

- **API**: módulo `auth` (register crea org + ADMIN, login, me, JWT), guard de roles + alta de miembros, CRUD `projects`.
- **Móvil**: crear `apps/mobile` con `create-expo-app` (TS) — recordar que el workspace ya incluye `apps/*`; añadir sesión (expo-secure-store), pantallas login/registro, cámara (expo-camera), SQLite local (expo-sqlite + Drizzle) con `sync_queue`.
- Mientras no exista `apps/mobile`, `pnpm build`/`typecheck` no lo incluyen (no romper por eso).

---

## 9. Checklist de trampas (leer antes de codificar)

- [ ] NO instalar `typescript@7` ni `prisma@latest` / `@prisma/client@7+` (usar TS 6.0.3 y Prisma 6.19.3).
- [ ] NO usar los puertos 3000 / 5432 / 5433 (ocupados por otros proyectos/servicios).
- [ ] NO commitear `.env` (solo `.env.example`, en inglés).
- [ ] NO escribir español en código/comentarios/schema; sí en docs y copy UI.
- [ ] En `apps/api` (ESM), los imports relativos llevan `.js`.
- [ ] No editar migraciones ya aplicadas; crear migración nueva.
- [ ] Toda query de la API filtra por `organizationId` (org-scoping).
- [ ] En F1+, features nativas (PDF, etc.) requieren **dev client / EAS build**, no Expo Go — planificar con el spike F3.0.
