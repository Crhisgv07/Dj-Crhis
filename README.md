# CRHIS Cabina

Software DJ de escritorio para **Mac** y **Windows**.

## Portada (descargas)

Esta es la página de presentación, como Serato o Virtual DJ: logo, captura y botones **Descargar para Mac** / **Descargar para Windows**.

- Archivo: `index.html` (también `site/index.html` para GitHub Pages)
- En el navegador: abre `index.html` o corre `npm run dev:site` y ve a [http://localhost:5173](http://localhost:5173)
- En línea: https://crhisgv07.github.io/Dj-Crhis/ (activa GitHub Pages: Settings → Pages → GitHub Actions)
- Instaladores: https://github.com/Crhisgv07/Dj-Crhis/releases/latest

Hasta que no haya un release con tag `v0.1.0` (u otro `v*`), los botones abren la página de Releases.

## La cabina (app)

Electron abre `cabina.html`, no la portada. El texto negro **CRHIS** es solo la pantalla de arranque de la app.

```bash
npm install
npm run dev          # cabina en Electron
npm run dev:site     # solo la portada en el navegador
```
