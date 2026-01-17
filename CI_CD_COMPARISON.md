# CI/CD Comparison: GitHub Actions vs GitLab CI

Este proyecto soporta tanto **GitHub Actions** como **GitLab CI** para construir y publicar imágenes Docker automáticamente.

## 📊 Comparación Rápida

| Característica | GitHub Actions | GitLab CI |
|---------------|----------------|-----------|
| **Archivo de configuración** | `.github/workflows/docker-publish.yml` | `.gitlab-ci.yml` |
| **Variables secretas** | Repository Secrets | CI/CD Variables |
| **Documentación** | [.github/DOCKER_HUB_SETUP.md](.github/DOCKER_HUB_SETUP.md) | [.gitlab/DOCKER_HUB_SETUP.md](.gitlab/DOCKER_HUB_SETUP.md) |
| **Trigger** | Tags `v*.*.*` | Tags `v*.*.*` |
| **Ejecución manual** | Workflow dispatch | Manual job |
| **Multi-arquitectura** | ✅ amd64, arm64 | ✅ amd64, arm64 |
| **Caché de Docker** | ✅ Registry cache | ✅ Registry cache |
| **Tags generados** | `v1.2.3`, `v1.2`, `v1`, `latest` | `v1.2.3`, `v1.2`, `v1`, `latest` |

## 🚀 Uso Rápido

### GitHub Actions

```bash
# 1. Configurar secrets en GitHub
# Settings → Secrets → Actions
# - DOCKERHUB_USERNAME
# - DOCKERHUB_TOKEN

# 2. Crear y publicar release
git tag v1.0.0
git push origin v1.0.0

# 3. Ver pipeline
# Actions → Build and Push Docker Image
```

### GitLab CI

```bash
# 1. Configurar variables en GitLab
# Settings → CI/CD → Variables
# - DOCKERHUB_USERNAME
# - DOCKERHUB_TOKEN

# 2. Crear y publicar release
git tag v1.0.0
git push origin v1.0.0

# 3. Ver pipeline
# CI/CD → Pipelines
```

## 🎯 ¿Cuál Usar?

### Usa **GitHub Actions** si:
- ✅ Tu repositorio está en GitHub
- ✅ Prefieres la interfaz de GitHub
- ✅ Usas GitHub Releases

### Usa **GitLab CI** si:
- ✅ Tu repositorio está en GitLab
- ✅ Prefieres la interfaz de GitLab
- ✅ Usas GitLab Releases

### Usa **Ambos** si:
- ✅ Tienes mirrors del repositorio en ambas plataformas
- ✅ Quieres redundancia en el CI/CD
- ✅ Diferentes equipos usan diferentes plataformas

## 📝 Notas

- Ambas configuraciones son **funcionalmente idénticas**
- Ambas construyen para **amd64** y **arm64**
- Ambas publican en **Docker Hub**
- Ambas solo se ejecutan en **tags de versión**
- Ambas generan los **mismos tags de Docker**

## 🔗 Enlaces Útiles

- [GitHub Actions Documentation](.github/DOCKER_HUB_SETUP.md)
- [GitLab CI Documentation](.gitlab/DOCKER_HUB_SETUP.md)
- [Docker Hub](https://hub.docker.com/)

---

© 2026 Centralizegg Contributors
