# 🛡️ Estándares de Seguridad y Privacidad

Esta guía documenta los estándares de seguridad implementados en **Centralizegg**, las políticas de codificación segura para mitigar vulnerabilidades y el enfoque de doble reporte de seguridad.

---

## 🛠️ Directrices de Codificación Segura

El backend de Go y la interfaz frontend siguen pautas de desarrollo estrictas para prevenir las vulnerabilidades críticas del top 10 de OWASP:

### 1. Mitigación de Inyección SQL
- **Problema**: Las inyecciones SQL permiten a atacantes manipular consultas del sistema para extraer información confidencial o destruir la base de datos.
- **Implementación**: Centralizegg **prohíbe** de forma absoluta la concatenación de variables en strings de consultas de base de datos. Todas las interacciones con PostgreSQL se realizan utilizando **consultas preparadas y parametrizadas** provistas por el driver nativo de base de datos.
- **Ejemplo Correcto**:
  ```go
  query := "SELECT id FROM virtualization.proxmox_hosts WHERE server_id = $1 AND hostname = $2"
  err := d.Conn.QueryRow(query, h.ServerID, h.Hostname).Scan(&id)
  ```

### 2. Privacidad de Credenciales SSH e IA
- El backend nunca almacena contraseñas o claves privadas SSH en texto claro en logs del contenedor o trazas de consola.
- Las variables de entorno con información confidencial de base de datos (`DB_PASS`) y claves de Gemini (`Gemini API Key`) se leen en memoria y se protegen contra la exposición no autorizada.

---

## 🔍 Escaneo de Vulnerabilidades (CVE) con Docker Scout

El sistema cuenta con soporte de escaneo de seguridad avanzado para las imágenes de los contenedores Docker mediante la herramienta de análisis estático **Docker Scout**:
- **Funcionamiento**: Durante el proceso de integración continua y localmente, `docker scout cves` analiza las capas de la imagen del contenedor de Centralizegg.
- **Resultados**: Muestra un desglose completo de vulnerabilidades (Criticas, Altas, Medias y Bajas) encontradas en los paquetes del sistema operativo base del contenedor (generalmente Alpine/Debian) y dependencias de Go, facilitando parchar paquetes obsoletos.

---

## 📊 Enfoque de Doble Reporte de Seguridad

Para garantizar tanto la visibilidad de negocio como la rápida acción de los ingenieros de desarrollo, Centralizegg utiliza una estrategia de **Doble Reporte de Seguridad**:

### A. Reporte Ejecutivo Premium (Dashboard GRS)
- **Propósito**: Reporte con alta estética corporativa, limpio y comprensible enfocado en auditores de seguridad, directores de infraestructura y toma de decisiones comerciales.
- **Contenido**: Gráficos de tendencias de seguridad, porcentaje de cobertura de parches aplicados, estado de auditorías y resúmenes ejecutivos libres de jerga técnica compleja.

### B. Reporte Técnico (GitLab Dashboards)
- **Propósito**: Reporte interactivo técnico e inmediato integrado con las pipelines de GitLab CI/CD.
- **Contenido**: Archivos en formato JSON de vulnerabilidades (SAST/Dependency Scanning) listos para consumir por el panel de seguridad nativo de GitLab. Permite a los desarrolladores ver el archivo y la línea de código exacta que posee el fallo de seguridad y aplicar el parche (*remediation*) con un clic en su flujo diario de Merge Request.
