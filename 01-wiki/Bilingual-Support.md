# 🌍 Soporte de Internacionalización (i18n)

Esta guía describe cómo se estructuran y gestionan los idiomas y las traducciones en el frontend interactivo de **Centralizegg** y el flujo de trabajo para añadir nuevos literales.

---

## 🏗️ Arquitectura de Traducciones

La localización de Centralizegg se realiza de forma estricta en el lado del cliente (frontend) para optimizar el rendimiento y evitar llamadas API adicionales para textos planos.

El sistema soporta por defecto tres idiomas:
- 🇨🇴 **Español** (`es`)
- 🇺🇸 **English** (`en`)
- 🇧🇷 **Português** (`pt`)

Las cadenas de traducción están centralizadas en los diccionarios de variables de JS en el frontend.

---

## 🛠️ Flujo de Trabajo para Añadir una Nueva Traducción

Si estás agregando un nuevo elemento en la interfaz (por ejemplo, una pestaña de configuración para "Windows Servers") y necesitas hacerlo multilingüe, sigue estos pasos:

### Paso 1: Localizar la Variable de Idiomas
En el archivo `web_centralizegg/static/app.js` (o en el módulo de i18n correspondiente), ubica los objetos JavaScript que representan los diccionarios de idiomas. Cada idioma tiene un diccionario correspondiente:
- `translationsES` para Español.
- `translationsEN` para Inglés.
- `translationsPT` para Portugués.

### Paso 2: Insertar la Nueva Clave de Traducción
Añade la clave del texto con sus traducciones en los tres diccionarios de forma sincronizada:

En **Español** (`translationsES`):
```javascript
const translationsES = {
    // ...
    windows_config: "Configuración de Servidores Windows",
    windows_title: "Nodos Windows Activos"
};
```

En **Inglés** (`translationsEN`):
```javascript
const translationsEN = {
    // ...
    windows_config: "Windows Servers Configuration",
    windows_title: "Active Windows Nodes"
};
```

En **Portugués** (`translationsPT`):
```javascript
const translationsPT = {
    // ...
    windows_config: "Configuração de Servidores Windows",
    windows_title: "Nós Windows Ativos"
};
```

### Paso 3: Renderizar en la Interfaz de Usuario
Cuando desees mostrar este literal en la interfaz web, utiliza la función o el mapeo dinámico de i18n global. Por ejemplo, en JS:
```javascript
const currentLang = state.currentLanguage || 'es';
const text = getTranslation(currentLang, 'windows_title');
```
O si estás inyectando HTML mediante literales de plantilla:
```javascript
const html = `
    <div class="panel-header">
        ${getTranslation(state.currentLanguage, 'windows_title')}
    </div>
`;
```
