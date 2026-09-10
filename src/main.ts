// Minimal deno desktop app: proves tsx compilation + rendering path.
// Desktop configuration lives in deno.json (see $schema + deno.tasks).
Deno.serve(() =>
  new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>wiki-desktop</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      font-family: system-ui, sans-serif;
      background: var(--background, #ffffff);
      color: var(--text, #000000);
      display: grid;
      place-items: center;
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <div>
    <h1>wiki-desktop</h1>
    <p>Deno desktop boilerplate — tsx compiled and rendered.</p>
  </div>
</body>
</html>`,
    {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  ),
);
