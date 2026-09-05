# FotoProy 📸🏗️

**Documenta cada paso del proceso de construcción con fotos del proyecto.**

FotoProy es una plataforma móvil (iOS + Android) para **capturar, almacenar, organizar y compartir fotos ilimitadas** de proyectos de construcción en un archivo seguro en línea. Está pensada para todos los perfiles de obra —ingenieros civiles, arquitectos, eléctricos, electrónicos, contratistas, fiscalizadores y clientes— y funciona **incluso en zonas sin cobertura de red** (offline-first).

> Captura desde cualquier dispositivo, organízalas fácilmente sobre un **mapa/plano del proyecto**, agrega anotaciones y comentarios, y comparte el avance con tu equipo para mantener a todos alineados.

---

## Estado del proyecto

| Estado            | Detalle                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| 📋 Especificación | ✅ **v2.1** — decisiones de producto y stack cerradas ([docs/SPEC.md](docs/SPEC.md))                           |
| 🗺️ Planificación  | ✅ **ROADMAP creado** — 5 fases (F0–F4) hasta el MVP ([ROADMAP.md](ROADMAP.md))                                |
| 💻 Código         | ✅ **Fase 1 (M1)** · ⏳ **Fase 2 implementada** — storage + pre-signed URLs + sync offline-first (pendiente validación M2 y despliegue) |

> [!NOTE]
> Proyecto en desarrollo — la Fase 0 (fundación del monorepo) está lista. El estado por fases vive en el [ROADMAP](ROADMAP.md).

---

## Características principales (alcance MVP)

- 📷 **Cámara con estampa**: captura con sello en vivo (fecha/hora, proyecto, usuario y GPS cuando está disponible), en modo ráfaga, con zoom por pellizco, linterna y relación de aspecto.
- 🎥 **Fotos y videos de obra**: graba videos cortos con audio (hasta ~3 min) con el mismo flujo de captura.
- 🖼️ **Galería local offline**: todo lo capturado queda guardado en el dispositivo y se ve en la galería del proyecto aunque no haya red.
- 📍 **Anclaje sobre planos**: sube el mapa/plano de la obra (imagen o PDF multipágina) y **ancla cada foto tocando el punto** del plano donde se tomó (coordenadas relativas por página).
- 📁 **Archivo organizado por proyectos**: proyectos → planos → fotos ancladas, con galería y filtros por usuario/fecha/plano.
- 💬 **Comentarios**: alinea al equipo comentando directamente sobre cada foto.
- 📡 **Offline-first**: captura, ancla y comenta **sin conexión**; todo se sincroniza automáticamente al recuperar red (cola local con reintentos).
- 🔗 **Compartir con clientes**: enlaces de **solo lectura** con expiración configurable (sin necesidad de cuenta).
- 👥 **Roles por organización**: `ADMIN`, `SUPERVISOR` y `TECHNICIAN`.

_Fuera del MVP (backlog post-MVP en el [ROADMAP](ROADMAP.md)): web de gestión, reportes PDF, IA/OCR, facturación SRI, mapas en vivo, integraciones, entre otros._

---

## Stack tecnológico

| Capa                                      | Tecnología                                         |
| ----------------------------------------- | -------------------------------------------------- |
| **Móvil** (iOS + Android, un solo código) | React Native + **Expo** + TypeScript               |
| **Base local (offline)**                  | SQLite (`expo-sqlite`) + Drizzle ORM               |
| **Backend API**                           | **NestJS** (Node + TypeScript)                     |
| **Base de datos**                         | PostgreSQL 16 + PostGIS                            |
| **ORM backend**                           | Prisma                                             |
| **Almacenamiento**                        | Cloudflare R2 (subida directa con pre-signed URLs) |
| **Auth**                                  | JWT (email + contraseña)                           |
| **Monorepo**                              | pnpm workspaces                                    |

_El esquema de base de datos detallado en la SPEC es informativo; la fuente de verdad es el schema Prisma en [`packages/database`](packages/database/prisma/schema.prisma)._

---

## Estructura del repositorio

```
fotoproy/
├─ apps/
│  ├─ mobile/            # Expo 57 + RN + TS (iOS + Android) — F1 cámara/BD local · F2 sync offline
│  └─ api/               # NestJS 12 (ESM) + Prisma — API REST
├─ packages/
│  ├─ database/          # Schema Prisma (fuente de verdad) + migraciones SQL
│  └─ shared/            # zod schemas + tipos compartidos (app ⇄ API)
├─ docs/
│  ├─ SPEC.md            # Especificación técnica y de producto (v2.1)
│  └─ archive/           # Versiones anteriores de la especificación
├─ docker-compose.yml    # Postgres 16 + PostGIS local (puerto 55432)
├─ ROADMAP.md            # Plan de implementación completo
├─ AGENTS.md             # Reglas y flujos para agentes de código
└─ README.md             # Este archivo
```

---

## Documentación

| Documento                      | Descripción                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [docs/SPEC.md](docs/SPEC.md)   | Especificación técnica y de producto **v2.1**: visión, alcance del MVP, stack, arquitectura, modelo de datos y decisiones cerradas. |
| [ROADMAP.md](ROADMAP.md)       | Plan de implementación: fases F0–F4 con tareas, criterios de terminado, hitos, riesgos y backlog post-MVP.                          |
| [AGENTS.md](AGENTS.md)         | Reglas y flujos de trabajo para agentes de código: idiomas, convenciones, comandos y trampas.                                       |
| [docs/archive/](docs/archive/) | Historial de versiones (SPEC v1.0 original, foco eléctrico LATAM).                                                                  |

---

## Cómo empezar (desarrollo local)

```bash
# Requisitos: Node 26 (ver .nvmrc), pnpm, Docker

pnpm install              # instala todos los workspaces (genera Prisma Client)
docker compose up -d db   # Postgres 16 + PostGIS → localhost:55432
pnpm db:migrate           # aplica las migraciones Prisma
pnpm dev:api              # API NestJS (watch) → http://localhost:4100

# Verificar que todo está vivo:
curl http://localhost:4100/health
# → {"status":"ok","db":"up",...}
```

Comandos útiles: `pnpm build` (compila todo en orden) · `pnpm lint` · `pnpm format` · `pnpm db:studio` (explorar BD) · `pnpm db:down`.

> 📌 **Puertos locales:** la BD usa el **55432** y la API el **4100** para no chocar con otros servicios de esta máquina (5432/5433/3000 están ocupados).

---

## Licencia

Privado — uso interno del equipo de desarrollo. _(Definir modelo de negocio/licencia en fase posterior.)_
