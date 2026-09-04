# Seguridad de CRHIS Cabina

La app es de escritorio, **100% local**: no abre conexiones de red, no envía
telemetría, no requiere cuenta ni activación. Nada sale de tu equipo.

## Endurecimiento aplicado (código)

| Medida | Qué hace |
|---|---|
| **Electron Fuses** | Requieren electron-builder 26+. En 1.0.0 el binario se publica con contextIsolation, sin Node en el renderer y ASAR. |
| **Validación de integridad del ASAR** | El paquete `app.asar` lleva hash; si alguien lo modifica, la app no arranca (macOS). |
| **`contextIsolation` + `sandbox`** | Ni la ventana principal ni la de video pueden tocar Node ni `require`. Toda comunicación pasa por un `preload` que expone sólo lo justo. |
| **`nodeIntegration: false`** en todas las ventanas | El renderer no tiene acceso al sistema de archivos ni a procesos. |
| **Content-Security-Policy** | En producción: `default-src 'self'`, sin `eval`, sin recursos remotos, `object-src 'none'`, `frame-src 'none'`. |
| **Guardas de navegación** | `will-navigate` fuera de la app se bloquea; `window.open` se deniega (los enlaces `https` abren en el navegador del SO); `<webview>` deshabilitado. |
| **Permisos** | Sólo se concede MIDI. Cámara, micrófono del navegador, geolocalización, notificaciones, etc. se deniegan. |
| **Sin DevTools ni menú** en producción | `devTools: false` y menú de aplicación desactivado. |
| **Instancia única** | Sólo una cabina a la vez. |
| **DevDeps mínimas** | Cadena de dependencias corta (React, Vite, Electron) para reducir superficie de supply-chain. |

## Lo que falta hacer tú (firma de código)

El endurecimiento anterior evita manipulación *casual*. Para que macOS y Windows
reconozcan la app como legítima y no muestren avisos, hay que **firmarla**:

### macOS — firma + notarización
1. Cuenta Apple Developer (99 USD/año) → certificado *Developer ID Application*.
2. En los *secrets* del repo:
   - `CSC_LINK` = el `.p12` en base64
   - `CSC_KEY_PASSWORD`
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
3. `electron-builder` firma con *hardened runtime* y notariza automáticamente en
   el workflow. El `.dmg` pasa Gatekeeper sin avisos.

### Windows — firma Authenticode
1. Certificado de firma de código OV (o EV, que además evita SmartScreen desde
   el día 1). Proveedores: DigiCert, Sectigo, SSL.com…
2. En los *secrets*: `CSC_LINK` (el `.pfx` en base64) y `CSC_KEY_PASSWORD`.
3. `electron-builder` firma el `.exe` y el instalador NSIS.

## Realidad

Ninguna app de escritorio en JavaScript (ni Serato, ni VirtualDJ, que también
se piratean) es imposible de descompilar. El objetivo aquí es que **no sea
trivial**: sin puertas traseras de Node, con integridad verificada, sin red y —
una vez firmada — con la cadena de confianza del SO. Para DRM real haría falta
un módulo nativo de licencias, que se puede añadir después si hace falta.
