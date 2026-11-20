# ADR-022: Pool multicuenta de Azure Speech y Translator

**Estado:** Aceptado (2026-11-19)
**Tarea:** CHG-24

## Contexto

La app depende de Azure Speech (evaluación de pronunciación STT en el navegador y TTS F0 de respaldo) y Azure Translator F0. Una sola cuenta en `.env` agota su cuota gratuita mensual si aumenta el volumen de práctica. El administrador necesita agregar, probar, rotar y combinar varias cuentas desde `/admin/azure`.

## Decisión

1. **Almacenamiento cifrado en SQLite (`0006_azure_pool.sql`):**
   - `azure_accounts` guarda las claves cifradas con `cryptography.fernet` usando `FRANCES_SECRETS_KEY` (`azure/crypto.py`), exponiendo en la API únicamente `key_hint` (`••••XXXX`).
   - Toda clave descifrada o leída del entorno se registra con `log.register_runtime_secret()` para redacción automática en logs y mensajes de error.
   - `azure_usage_monthly` registra consumo mensual por cuenta y medidor (`stt_seconds`, `tts_chars`, `translator_chars`).
2. **Estrategia y failover inmediato:**
   - Estrategias configurables en `app_settings` (`azure_pool_strategy`): `priority` (por defecto) o `least_used` (menor porcentaje de cuota mensual usado).
   - Ante HTTP 429 (enfriamiento 15 min), 401/403 (24 h) o error de red/5xx (5 min), el sistema marca `cooldown_until` y salta de inmediato a la siguiente cuenta activa tanto en `/api/speech/token`, como en `PooledAzureTtsEngine` y `PooledAzureTranslator`.
   - Las variables `AZURE_SPEECH_*` y `AZURE_TRANSLATOR_*` permanecen como respaldo virtual si no hay cuentas en DB o si las de DB agotan cupo/enfriamiento.
3. **Medición de STT desde el navegador:**
   - `SpeechToken` incluye opcionalmente `account_id` y `account_label`; tras terminar cada toma de pronunciación, el cliente notifica `POST /api/speech/usage`.

## Consecuencias

- Sin `FRANCES_SECRETS_KEY` el despliegue sigue operando con variables `.env`, y `POST /api/admin/azure/accounts` devuelve `503 secrets_key_missing` de forma explícita.
- CSP de Caddy (`wss://*.stt.speech.microsoft.com`) permite conectar con cuentas en múltiples regiones Azure sin reconfigurar el proxy.
