# FotoProy — Enlaces de solo lectura (F4.1)

> **Estado:** especificación aprobada (2026-09-11) — base de implementación de F4.1 y de la vista web F4.2.
> **Referencias:** [SPEC.md](SPEC.md) §3 fila 8 y §10 decisión #3 · [ROADMAP.md](../ROADMAP.md) F4.1/F4.2.

## 1. Objetivo

Permitir que un usuario con rol **ADMIN o SUPERVISOR** comparta el avance de un proyecto con terceros (cliente, dueño de obra, arquitecto externo) mediante un **enlace público de solo lectura**, sin cuenta ni aplicación: el enlace expira solo y puede revocarse en cualquier momento.

Fuera de alcance del MVP: exportar PDF, que el invitado escriba (comentarios del cliente), mapas por tiles en vivo y contraseña en el enlace.

## 2. Decisiones cerradas (2026-09-11)

| #   | Tema        | Decisión                                                                                                                                                                              |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Token       | **Aleatorio de 256 bits** (base64url, 43 caracteres) que se guarda **hasheado** (SHA-256) en la BD. Permite revocar de verdad y evita fugas.                                          |
| 2   | Validez     | Opciones **7 / 30 / 90 / 365 días**; por defecto **30**. El contrato zod ya admite 1–365.                                                                                             |
| 3   | Revocación  | Solo **revocar** (efecto inmediato). Para volver a compartir se crea un enlace **nuevo** (append-only, sin reactivar el anterior).                                                    |
| 4   | Contenido   | MVP: **fotos con estampa** + nombre/descripción del proyecto y metadatos de la foto (fecha de captura, autor, GPS). Planos, pines y comentarios quedan para una ampliación posterior. |
| 5   | Quién crea  | **ADMIN y SUPERVISOR**. Los TECHNICIAN no ven la sección de enlaces.                                                                                                                  |
| 6   | URL pública | Se compone con la env **`PUBLIC_BASE_URL`**; si no está definida, se infiere del request (`X-Forwarded-Proto`/`Host`).                                                                |

## 3. Modelo de datos (Prisma)

Nuevo modelo `Share` (tabla `shares`) — migración `add_shares`:

| Campo            | Tipo        | Notas                                                                    |
| ---------------- | ----------- | ------------------------------------------------------------------------ |
| `id`             | text (PK)   | UUID v4 generado por el servidor.                                        |
| `projectId`      | text (FK)   | Proyecto compartido (`onDelete: Cascade`).                               |
| `organizationId` | text (FK)   | Org del proyecto — org-scoping explícito y auditoría.                    |
| `tokenHash`      | text unique | SHA-256 del token en hexadecimal. El token en claro **nunca** se guarda. |
| `expiresAt`      | datetime    | Fecha de expiración (UTC).                                               |
| `revokedAt`      | datetime?   | `null` mientras el enlace está vigente.                                  |
| `createdById`    | text? (FK)  | Usuario que lo creó (`onDelete: SetNull`).                               |
| `createdAt`      | datetime    | Sello del servidor.                                                      |
| `lastAccessAt`   | datetime?   | Último acceso público (diagnóstico).                                     |
| `accessCount`    | int         | Nº de accesos al enlace (diagnóstico).                                   |

Índices: `@@index([projectId])`, `@@index([organizationId])`, único en `tokenHash`.

Estados derivados (no se almacenan): `ACTIVE` (`revokedAt = null` y `expiresAt > now`), `EXPIRED` (vencido y no revocado) y `REVOKED` (`revokedAt != null`).

## 4. API — endpoints privados (JWT)

| Método   | Ruta                 | Roles             | Cuerpo / respuesta                                                                                                              |
| -------- | -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/shares`            | ADMIN, SUPERVISOR | `createShareInputSchema` (`projectId`, `expiresInDays` 1–365, default 30) → `Share` (incluye `url` y `token` **una sola vez**). |
| `GET`    | `/shares?projectId=` | ADMIN, SUPERVISOR | Lista de enlaces del proyecto con su estado y métricas (sin token).                                                             |
| `DELETE` | `/shares/:id`        | ADMIN, SUPERVISOR | Revoca (idempotente; 404 si no existe o es de otra org).                                                                        |

El `token` en claro solo se devuelve en la creación: el enlace completo (`url`) también. La lista no lo expone (solo su estado).

## 5. API — endpoint público (sin auth)

`GET /s/:token` — devuelve el JSON que consumirá la vista web F4.2:

```jsonc
{
  "project": { "name": "...", "description": "...", "organizationName": "..." },
  "expiresAt": "2026-10-11T00:00:00.000Z",
  "photos": [
    {
      "id": "uuid",
      "kind": "PHOTO",
      "capturedAt": "2026-09-11T01:48:33.214Z",
      "authorName": "Patricio Valarezo",
      "latitude": -0.18,
      "longitude": -78.48,
      "url": "https://…", // URL firmada de vida corta (original)
      "thumbnailUrl": "https://…", // URL firmada del thumbnail
    },
  ],
}
```

Reglas:

- Token inválido o inexistente → **404** (sin distinguir "no existe" de "otra org": evita enumeración).
- Enlace revocado o expirado → **410 Gone** con un código estable (`SHARE_REVOKED` / `SHARE_EXPIRED`) para que la vista web muestre un mensaje claro.
- Solo lectura: no hay endpoints públicos de escritura.
- Cada acceso actualiza `lastAccessAt` y `accessCount` (best-effort, no bloquea la respuesta).
- Las URLs de fotos/thumbnails se firman en cada request (TTL de `STORAGE_SIGNED_URL_TTL`), nunca se cachean en la BD.
- Sin paginación en el MVP (fotos ilimitadas es promesa del producto); si un proyecto llega a miles de fotos se añadirá paginación por cursor.

## 6. Seguridad y límites

- Token de 256 bits → inviable de adivinar; hash en BD → una fuga de la tabla no permite reconstruir enlaces.
- El token determina la organización: **todo** el payload se filtra por `organizationId` del enlace (org-scoping implícito).
- Rate limiting del endpoint público y cabeceras de caché (`no-store`) quedan como refuerzo en F4.5; el enlace se sirve con `Cache-Control: no-store` desde ya.
- La vista web (F4.2) no incluirá el UUID de la organización ni datos de otros proyectos.

## 7. Experiencia en la app (F4.1 móvil)

En el detalle del proyecto (solo ADMIN/SUPERVISOR), acción **“Compartir avance”**:

1. Elegir validez (7 / 30 / 90 / 365 días).
2. Crear el enlace → mostrar la URL y ofrecer compartirla con la hoja nativa del sistema (`Share`).
3. Lista de enlaces del proyecto con estado (activo/vencido/revocado), fecha de expiración y acción **Revocar** (con confirmación).

## 8. Criterios de aceptación (DoD F4.1)

- [ ] Migración `add_shares` aplicada; `pnpm db:migrate` reproducible desde cero.
- [ ] `POST /shares` crea el enlace; `GET /shares?projectId` lista; `DELETE /shares/:id` revoca (idempotente).
- [ ] `GET /s/:token` responde 200 con el payload de solo lectura, 404 con token inválido, 410 vencido/revocado.
- [ ] Un token de otra organización no expone nada.
- [ ] TECHNICIAN recibe 403 al intentar crear/listar/revocar.
- [ ] La app muestra la acción solo a ADMIN/SUPERVISOR y permite compartir/revocar el enlace.
- [ ] `pnpm lint` en 0, `pnpm typecheck` y `pnpm build` OK; ROADMAP y SPEC actualizados.
