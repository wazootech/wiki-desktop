const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#f5f7fb" />
  <title>Wazoo Wiki — Editor</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #f5f7fb;
      --panel: #ffffff;
      --panel-muted: #f8f9fc;
      --line: #e4e8f0;
      --text: #1b2434;
      --muted: #748096;
      --brand: #5b4de8;
      --brand-dark: #473bc7;
      --brand-soft: #efedff;
      --success: #17845b;
      --shadow: 0 18px 45px rgba(33, 43, 72, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-width: 320px;
      min-height: 100vh;
      background: var(--canvas);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button, textarea { font: inherit; }
    button { cursor: pointer; }

    .shell {
      width: min(1180px, calc(100% - 48px));
      margin: 0 auto;
      padding: 28px 0 34px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 26px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 11px;
      color: white;
      background: linear-gradient(135deg, #776bff, #4c3ed0);
      box-shadow: 0 7px 16px rgba(91, 77, 232, 0.24);
      font-size: 19px;
      font-weight: 800;
    }

    .brand-name { font-size: 16px; font-weight: 760; letter-spacing: -0.01em; }
    .brand-subtitle { margin-top: 2px; color: var(--muted); font-size: 12px; }

    .top-actions { display: flex; align-items: center; gap: 10px; }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 38px;
      padding: 0 15px;
      border: 1px solid transparent;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 700;
      transition: background .16s ease, border-color .16s ease, transform .16s ease;
    }

    .button:active { transform: translateY(1px); }
    .button:focus-visible, textarea:focus-visible { outline: 3px solid rgba(91, 77, 232, .24); outline-offset: 2px; }
    .button-secondary { border-color: var(--line); color: #3c465a; background: var(--panel); }
    .button-secondary:hover { border-color: #cdd3df; background: #fbfcff; }
    .button-primary { color: white; background: var(--brand); box-shadow: 0 6px 14px rgba(91, 77, 232, .2); }
    .button-primary:hover { background: var(--brand-dark); }
    .button-primary:disabled { cursor: not-allowed; opacity: .55; box-shadow: none; }

    .editor-card {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 15px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .filebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 74px;
      padding: 15px 20px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }

    .file-info { min-width: 0; }
    .file-label { margin-bottom: 5px; color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
    .file-name { overflow: hidden; color: var(--text); font-size: 15px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
    .file-name.is-placeholder { color: var(--muted); font-weight: 600; }

    .save-state { display: inline-flex; align-items: center; gap: 6px; margin-left: 10px; color: var(--muted); font-size: 12px; font-weight: 550; vertical-align: middle; }
    .save-state::before { width: 6px; height: 6px; border-radius: 50%; background: #b9c1cf; content: ""; }
    .save-state.is-dirty::before { background: #eb9f27; }
    .save-state.is-saved { color: var(--success); }
    .save-state.is-saved::before { background: var(--success); }

    .workspace { padding: 20px; background: var(--panel-muted); }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 470px;
      border: 1px dashed #cfd5e2;
      border-radius: 10px;
      background: #fff;
      text-align: center;
    }

    .empty-inner { max-width: 390px; padding: 36px 20px; }
    .empty-icon { display: grid; place-items: center; width: 52px; height: 52px; margin: 0 auto 18px; border-radius: 14px; color: var(--brand); background: var(--brand-soft); font-size: 24px; }
    .empty-state h1 { margin: 0 0 9px; font-size: 20px; letter-spacing: -.025em; }
    .empty-state p { margin: 0 0 22px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .hint { margin-top: 12px; color: #9aa4b6; font-size: 11px; }
    kbd { padding: 2px 5px; border: 1px solid #dfe3eb; border-radius: 4px; color: #6c7689; background: #f6f7fa; font-size: 10px; }

    .editor-wrap { display: none; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
    .editor-wrap.is-visible { display: block; }
    textarea {
      display: block;
      width: 100%;
      min-height: 470px;
      resize: vertical;
      padding: 22px 24px;
      border: 0;
      outline: 0;
      color: #273247;
      background: #fff;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.75;
      tab-size: 2;
    }
    textarea::selection { color: #fff; background: #8e86ee; }

    .statusbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 20px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      background: #fff;
      font-size: 11px;
    }
    .statusbar span { white-space: nowrap; }
    .statusbar strong { color: #59657a; font-weight: 700; }
    .shortcut { margin-left: auto; }
    .toast { position: fixed; right: 24px; bottom: 24px; z-index: 2; max-width: min(360px, calc(100vw - 48px)); padding: 12px 15px; border: 1px solid var(--line); border-radius: 9px; color: #364156; background: white; box-shadow: var(--shadow); font-size: 13px; opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity .2s ease, transform .2s ease; }
    .toast.is-visible { opacity: 1; transform: translateY(0); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

    @media (max-width: 620px) {
      .shell { width: min(100% - 24px, 1180px); padding-top: 18px; }
      .topbar { align-items: flex-start; flex-direction: column; gap: 15px; margin-bottom: 17px; }
      .top-actions, .top-actions .button { width: 100%; }
      .top-actions .button { flex: 1; }
      .filebar { align-items: flex-start; flex-direction: column; padding: 15px; }
      .filebar .button { width: 100%; }
      .workspace { padding: 12px; }
      .empty-state, textarea { min-height: 430px; }
      .statusbar { align-items: flex-start; flex-wrap: wrap; padding: 10px 14px; }
      .shortcut { width: 100%; margin-left: 0; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">W</div>
        <div>
          <div class="brand-name">Wazoo Wiki</div>
          <div class="brand-subtitle">Desktop file editor</div>
        </div>
      </div>
      <div class="top-actions">
        <button class="button button-secondary" id="openButton" type="button"><span aria-hidden="true">↥</span> Open file</button>
        <button class="button button-primary" id="saveButton" type="button" disabled><span aria-hidden="true">↓</span> Save</button>
      </div>
    </header>

    <section class="editor-card" aria-label="Text file editor">
      <div class="filebar">
        <div class="file-info">
          <div class="file-label">Currently editing</div>
          <div class="file-name is-placeholder" id="fileName">No file selected <span class="save-state" id="saveState">Ready</span></div>
        </div>
        <button class="button button-secondary" id="saveAsButton" type="button" disabled>Save as…</button>
      </div>

      <div class="workspace">
        <div class="empty-state" id="emptyState">
          <div class="empty-inner">
            <div class="empty-icon" aria-hidden="true">✎</div>
            <h1>Open a text file to begin</h1>
            <p>Edit plain text, Markdown, code, and other text-based files right here in the desktop app.</p>
            <button class="button button-primary" id="emptyOpenButton" type="button">Choose a file</button>
            <div class="hint">You can also use <kbd>Ctrl</kbd> <span aria-hidden="true">/</span> <kbd>⌘</kbd> <kbd>O</kbd></div>
          </div>
        </div>
        <div class="editor-wrap" id="editorWrap">
          <label class="sr-only" for="editor">File contents</label>
          <textarea id="editor" spellcheck="false" wrap="off" aria-label="File contents"></textarea>
        </div>
      </div>

      <footer class="statusbar">
        <span id="characterCount">0 characters</span>
        <span id="lineCount">0 lines</span>
        <span id="cursorPosition">Ln 1, Col 1</span>
        <span class="shortcut">Save with <kbd>Ctrl</kbd><span aria-hidden="true">/</span><kbd>⌘</kbd> <kbd>S</kbd></span>
      </footer>
    </section>
  </main>
  <input class="sr-only" id="fileInput" type="file" accept=".txt,.md,.markdown,.text,.csv,.json,.xml,.html,.htm,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.toml,.ini,.conf,text/plain,text/markdown,application/json" />
  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script>
    (() => {
      const editor = document.getElementById('editor');
      const fileInput = document.getElementById('fileInput');
      const openButton = document.getElementById('openButton');
      const emptyOpenButton = document.getElementById('emptyOpenButton');
      const saveButton = document.getElementById('saveButton');
      const saveAsButton = document.getElementById('saveAsButton');
      const emptyState = document.getElementById('emptyState');
      const editorWrap = document.getElementById('editorWrap');
      const fileName = document.getElementById('fileName');
      const saveState = document.getElementById('saveState');
      const characterCount = document.getElementById('characterCount');
      const lineCount = document.getElementById('lineCount');
      const cursorPosition = document.getElementById('cursorPosition');
      const toast = document.getElementById('toast');
      let currentFileName = '';
      let currentFileHandle = null;
      let savedContents = '';
      let toastTimer;

      const fileTypes = [{
        description: 'Text files',
        accept: {
          'text/plain': ['.txt', '.text', '.md', '.markdown', '.csv', '.log', '.ini', '.conf', '.toml', '.yml', '.yaml'],
          'application/json': ['.json'],
          'text/html': ['.html', '.htm'],
          'text/css': ['.css'],
          'text/javascript': ['.js', '.jsx', '.ts', '.tsx']
        }
      }];

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
      }

      function setFileName(name) {
        fileName.firstChild.nodeValue = (name || 'No file selected') + ' ';
        fileName.classList.toggle('is-placeholder', !name);
        saveState.textContent = name ? 'Saved' : 'Ready';
      }

      function isDirty() { return editor.value !== savedContents; }

      function updateStatus() {
        const contents = editor.value;
        const lines = contents ? contents.split('\n').length : 0;
        characterCount.textContent = contents.length.toLocaleString() + (contents.length === 1 ? ' character' : ' characters');
        lineCount.textContent = lines.toLocaleString() + (lines === 1 ? ' line' : ' lines');
        const beforeCursor = contents.slice(0, editor.selectionStart);
        const currentLine = beforeCursor.split('\n');
        cursorPosition.textContent = 'Ln ' + currentLine.length + ', Col ' + (currentLine[currentLine.length - 1].length + 1);
        const dirty = isDirty();
        saveButton.disabled = !currentFileName;
        saveAsButton.disabled = !currentFileName;
        saveState.textContent = dirty ? 'Unsaved changes' : 'Saved';
        saveState.classList.toggle('is-dirty', dirty);
        saveState.classList.toggle('is-saved', !dirty && Boolean(currentFileName));
      }

      function showEditor(name, contents, handle) {
        currentFileName = name || 'Untitled.txt';
        currentFileHandle = handle || null;
        savedContents = contents;
        editor.value = contents;
        setFileName(currentFileName);
        emptyState.style.display = 'none';
        editorWrap.classList.add('is-visible');
        updateStatus();
        editor.focus();
        editor.setSelectionRange(0, 0);
      }

      async function chooseFile() {
        if (window.showOpenFilePicker) {
          try {
            const handles = await window.showOpenFilePicker({ multiple: false, types: fileTypes });
            const handle = handles[0];
            const file = await handle.getFile();
            showEditor(file.name, await file.text(), handle);
            showToast('Opened ' + file.name);
          } catch (error) {
            if (error && error.name !== 'AbortError') showToast('Could not open that file.');
          }
          return;
        }
        fileInput.click();
      }

      async function openSelectedFile(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        showEditor(file.name, await file.text(), null);
        showToast('Opened ' + file.name);
        fileInput.value = '';
      }

      function downloadContents(name) {
        const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name || 'untitled.txt';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      async function saveFile(saveAs) {
        if (!currentFileName) return;
        try {
          let handle = currentFileHandle;
          if (saveAs || !handle) {
            if (window.showSaveFilePicker) {
              handle = await window.showSaveFilePicker({ suggestedName: currentFileName, types: fileTypes });
              currentFileHandle = handle;
              currentFileName = handle.name || currentFileName;
              setFileName(currentFileName);
            } else {
              downloadContents(currentFileName);
              savedContents = editor.value;
              updateStatus();
              showToast('Downloaded ' + currentFileName);
              return;
            }
          }
          const writable = await handle.createWritable();
          await writable.write(editor.value);
          await writable.close();
          savedContents = editor.value;
          updateStatus();
          showToast('Saved ' + currentFileName);
        } catch (error) {
          if (error && error.name !== 'AbortError') showToast('Could not save that file.');
        }
      }

      openButton.addEventListener('click', chooseFile);
      emptyOpenButton.addEventListener('click', chooseFile);
      fileInput.addEventListener('change', openSelectedFile);
      saveButton.addEventListener('click', () => saveFile(false));
      saveAsButton.addEventListener('click', () => saveFile(true));
      editor.addEventListener('input', updateStatus);
      editor.addEventListener('keyup', updateStatus);
      editor.addEventListener('click', updateStatus);
      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          editor.setRangeText('  ', start, end, 'end');
          updateStatus();
        }
      });
      document.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
          event.preventDefault();
          chooseFile();
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          saveFile(false);
        }
      });
      window.addEventListener('beforeunload', (event) => {
        if (isDirty()) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    })();
  </script>
</body>
</html>`;

Deno.serve(() =>
  new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
);
