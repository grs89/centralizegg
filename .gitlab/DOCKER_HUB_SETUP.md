# GitLab CI - Docker Hub Setup

Este proyecto utiliza GitLab CI/CD para construir y publicar automáticamente imágenes Docker en Docker Hub.

## 📋 Configuración Requerida

### 1. Crear Variables en GitLab

Ve a tu proyecto en GitLab: **Settings** → **CI/CD** → **Variables** → **Add variable**

Crea las siguientes variables:

| Variable Name | Descripción | Valor | Protected | Masked |
|--------------|-------------|-------|-----------|--------|
| `DOCKERHUB_USERNAME` | Tu nombre de usuario de Docker Hub | `tuusuario` | ✅ | ❌ |
| `DOCKERHUB_TOKEN` | Token de acceso de Docker Hub | `dckr_pat_xxxxx...` | ✅ | ✅ |

### 2. Crear Access Token en Docker Hub

1. Ve a [Docker Hub](https://hub.docker.com/)
2. Inicia sesión con tu cuenta
3. Ve a **Account Settings** → **Security** → **New Access Token**
4. Dale un nombre descriptivo (ej: `gitlab-ci-centralizegg`)
5. Selecciona permisos: **Read, Write, Delete**
6. Copia el token generado (solo se muestra una vez)
7. Pégalo en la variable `DOCKERHUB_TOKEN` de GitLab

## 🚀 Uso del Pipeline

El pipeline se ejecuta automáticamente **solo cuando creas un tag de versión**:

### Crear y Publicar una Release

```bash
# 1. Asegúrate de que todos los cambios estén commiteados
git add .
git commit -m "Release v1.0.0"

# 2. Crea el tag con versión semántica
git tag v1.0.0

# 3. Sube el tag a GitLab (esto dispara el pipeline)
git push origin v1.0.0

# Resultado: Se construye y publica automáticamente en Docker Hub
# Genera tags: v1.0.0, v1.0, v1, latest
```

### Ejecución Manual (Opcional)

También puedes ejecutar el pipeline manualmente desde cualquier rama:

1. Ve a **CI/CD** → **Pipelines** → **Run pipeline**
2. Selecciona la rama
3. Expande **build-manual** y haz click en el botón ▶️ (play)

> [!IMPORTANT]
> El pipeline **NO** se ejecuta en push a ramas.
> Solo se dispara al crear tags con formato `v*.*.*` (ej: `v1.0.0`, `v2.1.3`)

## 🏷️ Tags Generados

El pipeline genera automáticamente los siguientes tags cuando creas una release:

| Tag Creado | Tags de Docker Generados | Ejemplo |
|------------|-------------------------|---------|
| `v1.2.3` | `v1.2.3`, `v1.2`, `v1`, `latest` | `centralizegg:v1.2.3` |
| `v2.0.0` | `v2.0.0`, `v2.0`, `v2`, `latest` | `centralizegg:v2.0.0` |
| `v1.5.2` | `v1.5.2`, `v1.5`, `v1`, `latest` | `centralizegg:v1.5.2` |

> [!NOTE]
> El tag `latest` siempre apunta a la última versión publicada.
> Los tags de versión mayor (`v1`, `v2`) permiten actualizaciones automáticas dentro de la misma versión mayor.

## 🏗️ Arquitecturas Soportadas

El pipeline construye imágenes multi-arquitectura:

- ✅ `linux/amd64` (Intel/AMD x86_64)
- ✅ `linux/arm64` (ARM 64-bit, Apple Silicon, Raspberry Pi 4+)

## 📦 Usar la Imagen Publicada

### Docker Compose
```yaml
services:
  app:
    image: tuusuario/centralizegg:latest
    # ... resto de la configuración
```

### Docker Run
```bash
docker pull tuusuario/centralizegg:latest
docker run -d tuusuario/centralizegg:latest
```

### Especificar Versión
```bash
docker pull tuusuario/centralizegg:v1.0.0
```

## 🔍 Verificar el Pipeline

1. Ve a **CI/CD** → **Pipelines** en tu proyecto
2. Selecciona el pipeline más reciente
3. Verifica que el job **build-and-push** sea exitoso (✅)
4. Revisa los logs para ver las imágenes publicadas

## 🐛 Troubleshooting

### Error: "denied: requested access to the resource is denied"
- Verifica que `DOCKERHUB_USERNAME` sea correcto
- Verifica que `DOCKERHUB_TOKEN` sea válido y tenga permisos de escritura
- Asegúrate de que las variables estén marcadas como **Protected**

### Error: "Cannot connect to the Docker daemon"
- Este error es normal si GitLab no tiene Docker-in-Docker habilitado
- Contacta al administrador de GitLab para habilitar runners con Docker

### Error: "buildx: command not found"
- El pipeline instala buildx automáticamente
- Si persiste, verifica que el runner tenga acceso a internet

### La imagen no aparece en Docker Hub
- Verifica que el pipeline haya completado exitosamente
- Asegúrate de que el tag siga el formato `v*.*.*`
- Revisa los logs del job "build-and-push"

## 📝 Diferencias con GitHub Actions

| Característica | GitHub Actions | GitLab CI |
|---------------|----------------|-----------|
| Archivo de configuración | `.github/workflows/docker-publish.yml` | `.gitlab-ci.yml` |
| Variables secretas | Repository Secrets | CI/CD Variables |
| Ejecución manual | Workflow dispatch | Manual job |
| Caché de Docker | Registry cache | Registry cache |
| Multi-arquitectura | Buildx | Buildx |

## 🔒 Seguridad

- ✅ Las variables `DOCKERHUB_TOKEN` deben estar marcadas como **Masked**
- ✅ Las variables deben estar marcadas como **Protected** para evitar uso en ramas no protegidas
- ✅ El token de Docker Hub debe tener solo los permisos necesarios
- ✅ El pipeline solo se ejecuta en tags, no en cada push

---

© 2026 Centralizegg Contributors
