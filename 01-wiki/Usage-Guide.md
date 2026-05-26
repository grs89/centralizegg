# 🕹️ Manual de Uso Local y Configuración Avanzada

Esta guía describe cómo interactuar con el dashboard premium de **Centralizegg**, las herramientas avanzadas integradas y la configuración de sus funcionalidades de telemetría e inteligencia artificial.

---

## 🖥️ Navegación General y Dashboard Principal

Al ingresar a la interfaz en `http://localhost:8080`, se presenta el **Summary Dashboard**, un panel de salud global interactivo:
- **Salud Global**: Muestra el total de hosts activos y caídos por cada tipo de infraestructura (Docker, KVM, pfSense, Proxmox, Kubernetes, NAS, Ceph).
- **Alertas Recientes**: Listado centralizado de alertas críticas (servidores caídos, picos de CPU o pérdida de paquetes en cortafuegos).
- **Notificación Audible**: Centralizegg reproduce un sonido de alerta ("ping") automático cuando el sistema detecta que un servidor ha pasado a estado `offline`.

---

## 🔍 Búsqueda Global ("Search Everything")

Ubicada en la cabecera del dashboard, la barra de búsqueda unificada indexa dinámicamente KVM hosts, VMs, contenedores Docker/Podman y volúmenes NAS:
- **Comportamiento Inteligente**: Puedes buscar por IP, por nombre de máquina o por sistema operativo.
- **Acceso Directo**: Al hacer clic en un resultado de la lista desplegable de sugerencias, la interfaz web realiza de inmediato el cambio de herramienta en el menú de la izquierda y despliega los detalles del host buscado de forma automática.

---

## 🌐 Mapa Mundial de Tráfico

Ubicado en el dashboard de Historial, esta visualización geográfica animada muestra en tiempo real las conexiones de red entrantes y salientes de tus servidores:
- **Vuelos Bezier**: Líneas curvas dinámicas que indican el trayecto del tráfico con un pulso animado (Rojo: Entrante, Verde: Saliente). La velocidad del pulso es directamente proporcional a la velocidad de tráfico real.
- **Heatmap de Densidad**: Genera manchas visuales de color en las áreas de mayor concurrencia de tráfico de tus servidores.
- **Filtros Interactivos**: Botones de filtrado para mostrar únicamente conexiones entrantes (`In`), salientes (`Out`) o todas (`All`).
- **Resolución GeoIP**: La resolución de IPs se delega de forma interna mediante un endpoint proxy backend (`/api/geoip/{ip}`) que hace llamadas seguras a `ip-api.com` para evitar errores de contenido mixto en el navegador y proteger las credenciales locales.

---

## 🎛️ Consola Web Interactiva & Gestión de Snapshots (KVM)

En la sección de KVM, al seleccionar un host y una máquina virtual:
- **Consola Web Integrada**: Puedes pulsar sobre el botón "Consola Web" para desplegar una ventana terminal en vivo con WebSockets y XTerm.js, dándote control completo sobre la CLI de tu VM sin agentes adicionales.
- **Gestión de Instantáneas (Snapshots)**: Centralizegg permite crear, listar, restaurar y eliminar snapshots de forma directa:
  - Para crear un snapshot, pulsa el botón "Crear Snapshot", introduce un nombre identificativo y una descripción.
  - Para revertir, selecciona la instantánea en el menú lateral de la VM y haz clic en "Revertir".
  - *Requisito*: Las instantáneas requieren que el disco virtual de la VM esté en formato `qcow2`.

---

## 🤖 Configuración Avanzada de Nala IA

Nala IA es el chatbot inteligente integrado en la esquina inferior del dashboard:
1. Abra el panel flotante de **Nala IA**.
2. Haz clic en el engranaje (⚙️) de configuración.
3. Configura las siguientes variables:
   - **Gemini API Key**: Tu clave personal de API para habilitar las consultas de IA.
   - **System Prompt**: Redacta las directrices de comportamiento para el asistente de IA.
   - **Model Selection**: Elige el modelo a utilizar (por defecto `gemini-3.5-flash` o `gemini-3.5-pro`).
4. Al guardar, esta configuración se almacena de forma persistente en PostgreSQL, compartiéndose entre todos los clientes del dashboard.
5. **Inyección de Contexto Automatizada**: Al realizar una consulta, la aplicación recopila transparentemente estadísticas actuales de hardware y logs de la base de datos y los inyecta en el prompt del sistema para que Nala te dé diagnósticos específicos de tu infraestructura en lugar de respuestas genéricas.
