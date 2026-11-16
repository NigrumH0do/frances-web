# Configuración de producción de Frances Classroom v2

Esta carpeta guarda la configuración que se copia al servidor. El despliegue
completo (imágenes, compose, Caddy y variables de entorno) está en
[`infra/README.md`](../infra/README.md).

## Archivos

| Archivo | Qué es |
|---|---|
| `frances.toml` | Configuración (`Settings`): cursos, tarjetas, audio y traductor. Sin secretos. Lo que no aparece usa los valores de [`frances.example.toml`](../frances.example.toml). |
| `voices.yaml` | Ajustes sobre las 17 voces por defecto (13 builtin + 4 sintéticas). `voices: []` = sin cambios. |
| `README.md` | Este documento. |

`frances.toml` y `voices.yaml` se copian al volumen de datos antes de arrancar:

```bash
sudo install -m 644 -o 10001 -g 10001 deploy/frances.toml /srv/frances/data/frances.toml
sudo install -m 644 -o 10001 -g 10001 deploy/voices.yaml /srv/frances/data/voices.yaml
```

## Secretos

Los secretos viven **solo** en `/srv/frances/.env` (permisos `600`, dueño
`root`) y en `/srv/frances/caddy.env` para lo que lee Caddy. Nunca se escriben
en el repo ni en los logs. La lista completa y los valores de ejemplo están en
[`infra/env.example`](../infra/env.example),
[`infra/caddy.env.example`](../infra/caddy.env.example) e
[`infra/README.md`](../infra/README.md).

## Despliegue y actualización

El comando único y la preparación del servidor están en
[`infra/README.md`](../infra/README.md):

```bash
cd /srv/frances/app/infra
docker compose up -d --build
```

Los datos del curso viven solo en `/srv/frances/data`; el repo público sigue
solo con fixtures sintéticos. La aceptación del go-live y el checklist humano
están en
[`docs/superpowers/plans/2026-11-02-12-golive.md`](../docs/superpowers/plans/2026-11-02-12-golive.md).
