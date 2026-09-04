# Publicar CRHIS Cabina

La app es **100% de escritorio**. Se publica:

1. Instaladores (`.dmg` Mac, `.exe` Windows) en **GitHub Releases**.
2. Portada (`site/`) en **GitHub Pages**.

Repo: https://github.com/Crhisgv07/Dj-Crhis

## GitHub Pages

En el repo: **Settings → Pages → Source: GitHub Actions**.
Cada push a `main` publica https://crhisgv07.github.io/Dj-Crhis/

## Release de producción

```bash
# versión en package.json, commit, tag y push
git tag v1.0.0
git push origin v1.0.0
```

El workflow `.github/workflows/release.yml` construye macOS (arm64 + Intel) y Windows x64, y sube los archivos al Release.

- Instaladores: https://github.com/Crhisgv07/Dj-Crhis/releases/latest
- Portada: https://crhisgv07.github.io/Dj-Crhis/

## Firma de código (opcional)

Sin firmar, macOS y Windows muestran avisos la primera vez. Para quitarlos hace falta certificado Apple Developer / Authenticode. Detalle en `SECURITY.md`.
