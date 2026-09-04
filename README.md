# CRHIS Cabina

Software DJ de escritorio para **Mac** y **Windows**. Dos decks, mixer, MIDI, biblioteca local. Sin cuenta y sin nube.

## Descargar

- Portada: https://crhisgv07.github.io/Dj-Crhis/
- Release: https://github.com/Crhisgv07/Dj-Crhis/releases/latest
- **Mac Apple Silicon** → `.dmg` `mac-arm64`
- **Mac Intel** → `.dmg` `mac-x64`
- **Windows 10/11** → instalador `.exe` `win-x64`

### Primera apertura (aún no está firmado)

- **Mac:** clic derecho en CRHIS Cabina → Abrir → Abrir. O Ajustes → Privacidad y seguridad → Abrir de todas formas.
- **Windows:** SmartScreen → Más información → Ejecutar de todas formas.

## Desarrollo

```bash
npm install
npm run dev          # cabina en Electron
npm run dev:site     # portada en http://localhost:5173
```

La portada es `index.html`. Electron abre `cabina.html`.

## Publicar

Ver `DEPLOY.md`. Un tag `v1.0.0` dispara GitHub Actions: instaladores de Mac y Windows + GitHub Release.
