# 📖 Wiki Interna de Centralizegg

Bienvenidos a la base de conocimiento y documentación técnica oficial de **Centralizegg**. Este portal centraliza las especificaciones, diagramas arquitectónicos y guías operativas necesarias para desarrollar, desplegar y auditar el sistema.

---

## 📂 Índice de Navegación Técnico

Selecciona el módulo técnico que deseas consultar:

### 🚀 Configuración e Instalación
*   [Guía de Instalación Detallada (Installation.md)](Installation.md)
    *   Requisitos de infraestructura, montaje de contenedores Docker y dependencias locales.
*   [Variables de Entorno y Configuración (Variables.md)](Variables.md)
    *   Tabla de parámetros de configuración y claves del sistema de base de datos.

### 🏗️ Arquitectura y Extensión
*   [Arquitectura del Sistema (Architecture.md)](Architecture.md)
    *   Diseño modular de la base de datos PostgreSQL, API REST en Go y la UI en Vanilla JS.
*   [Guías de Extensión de Código (Features.md)](Features.md)
    *   Instrucciones paso a paso para añadir nuevos colectores e integraciones de infraestructura.
*   [Soporte de i18n y Localización (Bilingual-Support.md)](Bilingual-Support.md)
    *   Gestión de archivos de idiomas y traducción del dashboard interactivo.

### 🛡️ Operación y Seguridad
*   [Manual de Uso Local (Usage-Guide.md)](Usage-Guide.md)
    *   Guía de usuario de las métricas, control de VMs KVM, mapas mundiales y consolas SSH interactivas.
*   [Estándares de Seguridad (Security-and-Privacy.md)](Security-and-Privacy.md)
    *   Políticas de codificación segura, escaneo de dependencias (CVE) y doble reporte (Ejecutivo / GitLab).

---

## 🎓 Programa de Inducción (Onboarding)

> [!TIP]
> **¿Eres un desarrollador junior o estás recién incorporado al equipo?**
> Hemos preparado una guía paso a paso y altamente pedagógica diseñada especialmente para ti. Te guiará a través del ciclo de vida del proyecto con analogías sencillas y plantillas listas para usar.
> 
> 👉 **[Comienza aquí en la Guía de Onboarding (Onboarding.md)](Onboarding.md)**

---

## 🛠️ Contribuir a la Wiki
1. Toda la documentación técnica debe escribirse obligatoriamente en **Español** para mantener coherencia en el equipo local.
2. Si incluyes diagramas, utiliza el formato de código nativo de **Mermaid.js** para garantizar que sean editables en el futuro.
3. Si utilizas capturas de pantalla o fragmentos multimedia, guárdalos obligatoriamente en la carpeta `01-wiki/assets/` usando formatos eficientes (`.webp` o `.png`).
