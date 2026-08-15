const { app, screen } = require('electron');
app.whenReady().then(() => {
  const d = screen.getPrimaryDisplay();
  console.log(JSON.stringify({ scaleFactor: d.scaleFactor, bounds: d.bounds, size: d.size, workArea: d.workArea }, null, 2));
  app.quit();
});
