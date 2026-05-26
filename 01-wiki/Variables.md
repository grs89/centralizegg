# ⚙️ Variables de Entorno y Configuración

Este documento detalla todas las variables de entorno (`.env`) y configuraciones disponibles en **Centralizegg**, su valor por defecto, si son mandatorias y la repercusión técnica que poseen en la infraestructura de la aplicación.

---

## 📋 Listado de Variables de Entorno

| Variable | Valor por Defecto | Obligatorio | Propósito Técnico | Repercusión en Infraestructura |
| :--- | :--- | :---: | :--- | :--- |
| **`DB_HOST`** | `centralizegg__trn_db` | **Sí** | Dirección IP o nombre de host DNS de la base de datos PostgreSQL. | Si es incorrecta, la aplicación Go fallará al iniciar y entrará en bucle de reintento. |
| **`DB_PORT`** | `5432` | No | Puerto de escucha del servicio de PostgreSQL. | Si se cambia en PostgreSQL, debe coincidir aquí para establecer la conexión. |
| **`DB_USER`** | `centralizegg` | **Sí** | Nombre del usuario administrador de la base de datos PostgreSQL. | Se usa en la cadena de conexión para la creación automática de tablas y lectura de métricas. |
| **`DB_PASS`** | `centralizegg_secret`| **Sí** | Contraseña de autenticación del usuario de PostgreSQL. | Clave secreta. **Nunca debe subirse al repositorio Git público.** |
| **`DB_NAME`** | `centralizegg_db` | **Sí** | Nombre de la base de datos relacional del proyecto. | La base de datos se creará de forma automática en el primer arranque si no existe. |
| **`LIBVIRT_SOCK`**| `/var/run/libvirt/libvirt-sock` | No | Ruta al socket Unix del hipervisor local de Libvirt. | Utilizado por la rutina KVM para consultar telemetría de hipervisores locales. |

---

## 🔒 Buenas Prácticas de Seguridad en Configuración

> [!WARNING]
> **No subir archivos `.env` a sistemas Git públicos**:
> El archivo `.env` contiene credenciales sensibles (claves de bases de datos, tokens de IA, etc.). Debe agregarse siempre al archivo `.gitignore` para prevenir fugas de secretos y riesgos de intrusión.
> 
> En su lugar, mantén un archivo **`.env.example`** con valores simulados y vacíos de ejemplo para que los nuevos desarrolladores puedan copiarlo y rellenarlo manualmente.
