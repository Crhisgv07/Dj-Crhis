const { app, BrowserWindow } = require("electron");

app.disableHardwareAcceleration();
const url = process.argv[2] || "http://localhost:5173/";

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const errors = [];
  win.webContents.on("console-message", (event) => {
    const message = event.message || String(event);
    if (/Maximum update depth|getSnapshot should be cached|Failed to reload/i.test(message)) {
      errors.push(message);
    }
  });

  await win.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const result = await win.webContents.executeJavaScript(`({
    hasApp: Boolean(document.querySelector(".app")),
    hasDeck: document.querySelectorAll(".deck").length,
    hasMixer: Boolean(document.querySelector(".mixer")),
    hasLibrary: Boolean(document.querySelector(".library")),
    hasError: Boolean(document.querySelector(".boot-error")),
  })`);
  console.log(JSON.stringify({ result, errors }, null, 2));
  app.exit(result.hasApp && result.hasDeck === 2 && !result.hasError && errors.length === 0 ? 0 : 1);
});
