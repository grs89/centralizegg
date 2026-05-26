# 🛠️ Guía de Instalación y Despliegue Detallada

Esta guía documenta la configuración del entorno de desarrollo y producción para **Centralizegg**, detallando los prerrequisitos, variables de entorno, configuración de claves de seguridad SSH y la resolución de problemas durante el despliegue.

---

## 🏗️ Requisitos de Sistema

Antes de iniciar la instalación, asegúrese de cumplir con los siguientes requisitos:

| Componente | Requisito Mínimo | Propósito |
| :--- | :--- | :--- |
| **Docker Engine** | 20.10.x o superior | Motor de contenedorización del backend y la base de datos. |
| **Docker Compose** | v2.x o superior | Orquestación local multicontenedor. |
| **Memoria RAM** | 2 GB libres | Consumo del backend Go, base de datos PostgreSQL e hilos de recolección. |
| **Acceso SSH** | Clave RSA/Ed25519 | Acceso sin contraseña a los hosts remotos de infraestructura. |

---

## 🚀 Despliegue Local con Docker Compose

El proyecto está diseñado para levantarse con un comando único utilizando Docker Compose. Este flujo descarga/compila la aplicación Go y monta un servidor PostgreSQL persistente con sus tablas iniciales.

### Paso 1: Configurar Variables de Entorno
Copie el archivo de ejemplo para crear su entorno local de configuración:
```bash
cp .env.example .env
```

### Paso 2: Configurar las Claves SSH (Muy Importante)
El colector de Centralizegg utiliza una clave SSH privada montada en el contenedor para conectarse sin contraseña a los hipervisores KVM, firewalls pfSense y almacenamiento NAS.

1. Asegúrese de que su clave privada se encuentre en `~/.ssh/id_rsa` en el host físico.
2. Los permisos de este archivo en su máquina deben ser estrictos. Ejecute en el terminal:
   ```bash
   chmod 600 ~/.ssh/id_rsa
   ```
   > [!WARNING]
   > Si los permisos de la clave privada son demasiado abiertos (ej. `777` o `644`), la librería interna de Go SSH rechazará usar la clave por motivos de seguridad, provocando errores de autenticación continuos.

### Paso 3: Levantar los Contenedores
Ejecute el comando de construcción y arranque en segundo plano:
```bash
docker-compose up -d --build
```

### Paso 4: Validar el Estado de los Servicios
Verifique que tanto la base de datos PostgreSQL como la aplicación Go estén saludables:
```bash
docker-compose ps
```

Puedes ver las trazas en tiempo real del backend usando:
```bash
docker-compose logs -f centralizegg_app
```

---

## 🖧 Configuración de Red e Interfaces

El servicio de Centralizegg escucha por defecto en el puerto **8080** del contenedor, el cual se expone al host físico mediante la configuración del archivo `docker-compose.yml`:

```yaml
ports:
  - "8080:8080"
```

Si necesitas cambiar el puerto de visualización de la UI, puedes editar el puerto del host (el primer término del mapeo):
```yaml
ports:
  - "9090:8080"  # Ahora la UI estará en http://localhost:9090
```

---

## ❌ Resolución de Problemas (Troubleshooting)

### 1. Error de Conexión en Base de Datos: `Could not connect to DB`
- **Causa**: El servicio `db` de PostgreSQL aún no ha completado su proceso de inicialización de sockets, pero la app Go intentó conectarse de inmediato.
- **Solución**: El backend Go tiene un bucle de reintento automático de conexión. Si no se resuelve tras 30 segundos, verifica los logs de la base de datos:
  ```bash
  docker-compose logs centralizegg__trn_db
  ```

### 2. Error en SSH: `ssh: handshake failed: ssh: unable to authenticate`
- **Causa**: La clave privada no está en la ruta adecuada del host, no está autorizada en el destino, o la contraseña es inválida.
- **Solución**:
  - Asegúrese de que la clave pública correspondiente a su archivo `id_rsa` esté añadida en el archivo `/root/.ssh/authorized_keys` del servidor remoto al que desea conectarse.
  - Valide la conexión manual desde su host físico: `ssh usuario@ip-servidor`.
