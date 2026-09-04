# Publicar CRHIS Cabina (mac + windows) y la página oficial

La app es **100% de escritorio**: no hay servidor, ni cuentas, ni streaming.
Lo único que se publica es:

1. Los **instaladores** (`.dmg` para macOS, `.exe` para Windows) en **GitHub Releases**.
2. La **página de descarga** (`site/`) en **GitHub Pages**.

## 1. Preparar el repositorio

```bash
cd "dj crhis"
git init && git add . && git commit -m "CRHIS Cabina"
gh repo create Dj-Crhis --public --source=. --push
```

El repo ya está en **https://github.com/Crhisgv07/Dj-Crhis**.

En GitHub → **Settings → Pages → Source: GitHub Actions**.
Cada push a `main` publica la portada; cada tag `v*` publica instaladores.

## 2. Construir los instaladores

### Local (necesitas cada SO para su instalador)

```bash
npm install
npm run dist:mac     # en un Mac  -> release/CRHIS-Cabina-<ver>-mac-arm64.dmg + -mac-x64.dmg
npm run dist:win     # en Windows -> release/CRHIS-Cabina-<ver>-win-x64.exe
```

### Automático (recomendado) — `.github/workflows/release.yml`

Un push de tag construye mac **y** windows en paralelo, sube los binarios al
Release y actualiza la página:

```bash
npm version 0.1.0            # actualiza package.json
git push --follow-tags       # dispara el workflow con el tag v0.1.0
```

Al terminar:

- Instaladores: https://github.com/Crhisgv07/Dj-Crhis/releases/latest
- Portada: https://crhisgv07.github.io/Dj-Crhis/

## 3. Firma de código (opcional, para quitar los avisos)

Sin firmar, macOS pide *Ajustes → Privacidad y seguridad → Abrir de todas formas*
y Windows muestra SmartScreen. Para evitarlo:

- **macOS**: cuenta de Apple Developer (99 USD/año). Añade a los `secrets` del
  repo `CSC_LINK` (el .p12 en base64), `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; electron-builder firma y
  notariza solo.
- **Windows**: certificado de firma (OV/EV). Añade `CSC_LINK` y `CSC_KEY_PASSWORD`.

## 4. Dominio propio

En `site/` crea un archivo `CNAME` con tu dominio (p. ej. `crhis.app`) y
configúralo en el DNS apuntando a GitHub Pages. La página no cambia.

## Formatos soportados por la app

Audio: MP3, WAV, FLAC, AAC/M4A, OGG, AIFF, WMA · Video: MP4, M4V, MOV, WebM, MKV
