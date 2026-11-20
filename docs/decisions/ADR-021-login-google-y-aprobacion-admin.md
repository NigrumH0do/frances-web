# ADR-021: Login web con Google OIDC (PKCE) y aprobación por administrador

**Estado:** Aceptado (2026-11-19)
**Tarea:** CHG-23

## Contexto

Además del acceso local por invitación y contraseña, se requiere permitir que cualquier estudiante inicie sesión con su cuenta de Google personal o institucional sin emitir invitaciones manuales previas, pero manteniendo control de acceso por parte del administrador.

## Decisión

1. **Política abierta de dominio + aprobación (`pending` -> `active`):**
   - Cualquier cuenta de Google con correo verificado puede completar `/api/auth/google/start` -> `/api/auth/google/callback` (Authorization Code Flow + PKCE S256).
   - Las cuentas nuevas registradas por Google ingresan con `status = 'pending'`, `auth_provider = 'google'`, `password_hash = '!oauth-only'` y sin sesión hasta que un administrador las apruebe en `POST /api/admin/users/{id}/approve`.
   - Excepción de arranque: los correos configurados en `FRANCES_ADMIN_EMAILS` (lista separada por comas en el entorno del servidor, nunca hardcodeada en el repositorio) se activan automáticamente con `role = 'admin'` y `status = 'active'`.
2. **Enlace seguro con cuentas existentes:**
   - Si ya existe una cuenta local con el mismo correo verificado, el callback enlaza `google_sub` y actualiza `auth_provider = 'both'`, conservando su estado de activación/deshabilitación.
3. **Revocación instantánea:**
   - `set_disabled(..., disabled=True)` marca `status = 'disabled'` y revoca todas las sesiones activas; `lookup_session`, `authenticate` y el callback de Google rechazan cuentas `pending` o `disabled`.
4. **Esquema `0005_google_auth.sql`:**
   - Añade `status`, `auth_provider`, `google_sub` (índice único parcial) y `avatar_url` a `users`, además de la tabla `oauth_states` para validar `state` + `code_verifier` de un solo uso con expiración de 10 minutos.

## Consecuencias

- La identidad OIDC se valida siempre en el backend (`google-auth` + secreto del cliente en `/srv/frances/.env`) y la sesión resultante usa las mismas cookies `__Host-*` + CSRF que el login local.
- Ningún correo real ni credencial vive en el repositorio.
