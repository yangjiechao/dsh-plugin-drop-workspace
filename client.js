/**
 * Client half of the drag-to-project bundle.
 *
 * The browser cannot read the absolute path of a dropped folder, and asking the
 * host to search for it is the only honest option a plain web page has. This
 * overlay therefore never claims to know the path: it sends the folder name and
 * its top-level entry names to the host, shows the ranked host candidates, and
 * falls back to a typed path or the system directory dialog.
 *
 * It occupies `shell.overlay`, the frame-wide seat above every column, and
 * claims folder drags in the window capture phase so the composer's attachment
 * intake keeps its own file drops.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-drop-workspace',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const Fragment = React.Fragment;
    const { useCallback, useEffect, useRef, useState } = React;

    /** Locale namespace this bundle registers. */
    const NS = 'dropWorkspace';
    /** Host route that ranks candidate directories. */
    const ENDPOINT = '/dsh-drop-workspace/resolve';
    /** How many child names the overlay sends as a content signature. */
    const CHILD_LIMIT = 60;
    /** How long a result toast stays on screen. */
    const TOAST_MS = 4200;

    const EN = {
      'meta.title': 'Drag a Folder to Add a Project',
      'meta.description':
        'Drop a folder anywhere on the page to register it as a project (Workspace) on the host machine.',
      'drop.title': 'Drop to add a project',
      'drop.hint': 'Harness looks this folder up on the host machine',
      'working.title': 'Locating “{name}”…',
      'working.hint': 'Searching your home directory and known project locations',
      'adding.title': 'Adding “{name}” as a project…',
      'choose.title': 'Add “{name}” as a project',
      'choose.hint':
        'A browser drop carries no absolute path, so confirm which folder on this machine you dropped.',
      'choose.empty':
        'No folder with that name turned up in the searched locations. Type its absolute path, or pick it in the system dialog.',
      'choose.match': '{matched} of {total} entries match',
      'choose.pathLabel': 'Absolute path on this machine',
      'choose.pathPlaceholder': '/Users/you/projects/my-project',
      'choose.add': 'Add project',
      'choose.pick': 'Choose in system dialog…',
      'choose.cancel': 'Cancel',
      'toast.added': 'Project added: {title}',
      'error.notAbsolute': 'Enter an absolute path that starts with “/”.',
      'error.notDirectory': 'That path is not an existing folder.',
      'error.tooLarge': 'The drop was too large to inspect.',
      'error.badRequest': 'The host rejected the request.',
      'error.scanFailed': 'The host could not search for that folder.',
      'error.offline': 'Cannot reach the Harness host.',
      'error.requestFailed': 'The host rejected the request.',
    };

    const ZH = {
      'meta.title': '拖拽文件夹新建项目',
      'meta.description': '把文件夹拖到页面任意位置，即可在宿主机上把它添加为项目（工作区）。',
      'drop.title': '松开即可添加为新项目',
      'drop.hint': 'Harness 会在宿主机上查找这个文件夹',
      'working.title': '正在查找“{name}”…',
      'working.hint': '搜索主目录与已知的项目位置',
      'adding.title': '正在添加“{name}”为项目…',
      'choose.title': '把“{name}”添加为项目',
      'choose.hint': '浏览器无法从拖拽中得知绝对路径，请确认你拖入的是本机上的哪个文件夹。',
      'choose.empty': '在搜索范围内没有找到同名文件夹。请直接输入绝对路径，或用系统对话框选择。',
      'choose.match': '{matched}/{total} 个条目匹配',
      'choose.pathLabel': '本机绝对路径',
      'choose.pathPlaceholder': '/Users/you/projects/my-project',
      'choose.add': '添加项目',
      'choose.pick': '用系统对话框选择…',
      'choose.cancel': '取消',
      'toast.added': '已添加项目：{title}',
      'error.notAbsolute': '请输入以“/”开头的绝对路径。',
      'error.notDirectory': '该路径不是已存在的文件夹。',
      'error.tooLarge': '拖入内容过大，无法检查。',
      'error.badRequest': '宿主拒绝了该请求。',
      'error.scanFailed': '宿主无法搜索该文件夹。',
      'error.offline': '无法连接 Harness 宿主。',
      'error.requestFailed': '宿主拒绝了该请求。',
    };

    const CSS = `
.dshdw-layer{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;pointer-events:auto}
.dshdw-backdrop{position:absolute;inset:0;background:var(--dsw-alias-bg-base);opacity:.78}
.dshdw-target{position:relative;box-sizing:border-box;width:min(560px,100%);padding:38px 32px;border:2px dashed var(--dsw-alias-brand-primary);border-radius:16px;background:var(--dsw-alias-bg-overlay);display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;color:var(--dsw-alias-label-primary)}
.dshdw-target svg{color:var(--dsw-alias-brand-primary)}
.dshdw-card{position:relative;box-sizing:border-box;width:min(560px,100%);max-height:min(76vh,660px);overflow:auto;padding:20px 22px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.dshdw-working{align-items:center;text-align:center;gap:10px;padding:32px 24px}
.dshdw-title{font-size:15px;line-height:1.45;font-weight:500}
.dshdw-hint{font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-secondary)}
.dshdw-label{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.dshdw-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0}
.dshdw-cand{display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dshdw-cand:hover{background:var(--dsw-alias-bg-layer-2)}
.dshdw-cand-title{font-size:13.5px;line-height:1.4;font-weight:500}
.dshdw-path{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary);word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dshdw-meta{font-size:11px;line-height:1.4;color:var(--dsw-alias-state-success-primary)}
.dshdw-manual{display:flex;flex-direction:column;gap:6px;margin:0}
.dshdw-row{display:flex;gap:8px;align-items:center}
.dshdw-input{flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none}
.dshdw-input:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.dshdw-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.dshdw-btn{font:inherit;font-size:12.5px;line-height:1.4;padding:7px 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.dshdw-btn:hover:enabled{background:var(--dsw-alias-bg-layer-2)}
.dshdw-btn:disabled{opacity:.5;cursor:default}
.dshdw-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshdw-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dshdw-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.dshdw-spinner{width:22px;height:22px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:dshdw-spin .8s linear infinite}
@keyframes dshdw-spin{to{transform:rotate(360deg)}}
.dshdw-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);box-sizing:border-box;max-width:min(560px,calc(100vw - 48px));padding:10px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:2px;pointer-events:none}
.dshdw-toast-ok{border-left:3px solid var(--dsw-alias-state-success-primary)}
.dshdw-toast-err{border-left:3px solid var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:reduce){.dshdw-spinner{animation:none}}
`;

    const STYLE_ELEMENT = h('style', null, CSS);

    /**
     * Read the first dropped item that is a directory.
     * @param dataTransfer - the drag payload.
     * @returns the directory entry, or null when the drag carries no folder.
     */
    function folderEntryFrom(dataTransfer) {
      if (!dataTransfer || !dataTransfer.items) return null;
      for (const item of Array.from(dataTransfer.items)) {
        if (!item || item.kind !== 'file') continue;
        let entry = null;
        try {
          entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        } catch {
          entry = null;
        }
        if (entry && entry.isDirectory === true) return entry;
      }
      return null;
    }

    /**
     * Whether a drag claims file-like items at all.
     * @param dataTransfer - the drag payload.
     * @returns whether "Files" is among the drag types.
     */
    function hasFiles(dataTransfer) {
      if (!dataTransfer || !dataTransfer.types) return false;
      return Array.from(dataTransfer.types).indexOf('Files') !== -1;
    }

    /**
     * Read one level of a dropped directory for its content signature.
     * @param entry - the dropped directory entry.
     * @param limit - maximum names collected.
     * @returns the entry names, or an empty list when unreadable.
     */
    async function readChildNames(entry, limit) {
      const names = [];
      try {
        const reader = entry.createReader();
        for (let round = 0; round < 6 && names.length < limit; round += 1) {
          const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
          if (!Array.isArray(batch) || batch.length === 0) break;
          for (const child of batch) {
            if (names.length >= limit) break;
            if (child.name !== '.DS_Store') names.push(child.name);
          }
        }
      } catch {
        /* an unreadable folder falls back to name-only matching on the host */
      }
      return names;
    }

    /**
     * Parent directory of one absolute path.
     * @param target - absolute path.
     * @returns the parent, or an empty string at a filesystem root.
     */
    function parentDirectory(target) {
      const cut = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
      return cut > 0 ? target.slice(0, cut) : '';
    }

    /**
     * Parents of the registered Workspaces: the likeliest place to search first.
     * @param snapshot - the Workspaces snapshot.
     * @returns up to twelve distinct parent directories.
     */
    function hintDirectories(snapshot) {
      const hints = [];
      const seen = new Set();
      const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
      for (const item of items) {
        if (!item || typeof item.path !== 'string') continue;
        const parent = parentDirectory(item.path);
        if (parent === '' || seen.has(parent)) continue;
        seen.add(parent);
        hints.push(parent);
        if (hints.length >= 12) break;
      }
      return hints;
    }

    /**
     * Post one resolution request to the host.
     * @param payload - dropped name, entry names, hints, or an explicit path.
     * @returns the parsed host answer.
     */
    async function postResolve(payload) {
      let response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        const failure = new Error('offline');
        failure.code = 'offline';
        throw failure;
      }
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || !data || data.ok !== true) {
        const code = (data && data.error) || 'requestFailed';
        const failure = new Error(code);
        failure.code = code;
        throw failure;
      }
      return data;
    }

    /** Folder glyph for the drop invitation. */
    function FolderDropIcon() {
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: 44, height: 44, 'aria-hidden': true, fill: 'none' },
        h('path', {
          d: 'M6 18a4 4 0 0 1 4-4h14l5 6h21a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z',
          stroke: 'currentColor',
          strokeWidth: 2.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M32 28v14m0 0l-6-6m6 6l6-6',
          stroke: 'currentColor',
          strokeWidth: 2.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /**
     * Free-text absolute path entry inside the chooser.
     * @param props - labels, busy flag, and the submit callback.
     * @returns the form row.
     */
    function ManualPath(props) {
      const [text, setText] = useState('');
      const onSubmit = props.onSubmit;
      return h(
        'form',
        {
          className: 'dshdw-manual',
          onSubmit: (event) => {
            event.preventDefault();
            onSubmit(text);
          },
        },
        h('label', { className: 'dshdw-label', htmlFor: 'dshdw-path-input' }, props.label),
        h(
          'div',
          { className: 'dshdw-row' },
          h('input', {
            id: 'dshdw-path-input',
            className: 'dshdw-input',
            value: text,
            placeholder: props.placeholder,
            spellCheck: false,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            autoComplete: 'off',
            onChange: (event) => setText(event.target.value),
          }),
          h(
            'button',
            {
              type: 'submit',
              className: 'dshdw-btn dshdw-btn-primary',
              disabled: props.busy || text.trim() === '',
            },
            props.action,
          ),
        ),
      );
    }

    /**
     * Build the overlay component bound to one Client context.
     * @param ctx - Client root context.
     * @returns the slot occupant component.
     */
    function createOverlay(ctx) {
      return function DropWorkspaceOverlay() {
        const [phase, setPhase] = useState('idle');
        const [view, setView] = useState(null);
        const [toast, setToast] = useState(null);
        const [localeRevision, setLocaleRevision] = useState(0);
        const dragDepth = useRef(0);
        const folderDrag = useRef('unknown');
        const busy = useRef(false);
        const runId = useRef(0);
        const toastTimer = useRef(null);

        // Re-render on locale switches so every label follows the active locale.
        useEffect(() => {
          return ctx.locale.subscribe(() => setLocaleRevision((value) => value + 1));
        }, []);
        void localeRevision;

        const t = ctx.locale.bind(NS);

        const resetDrag = useCallback(() => {
          dragDepth.current = 0;
          folderDrag.current = 'unknown';
          setPhase((current) => (current === 'drag' ? 'idle' : current));
        }, []);

        /**
         * Decide once per drag session whether the payload carries a folder.
         * @param event - the drag event.
         * @param force - recompute even when this session already decided.
         * @returns whether this drag holds a directory.
         */
        const folderDragOf = useCallback((event, force) => {
          if (!hasFiles(event.dataTransfer)) {
            folderDrag.current = 'unknown';
            return false;
          }
          if (!force && folderDrag.current !== 'unknown') return folderDrag.current === 'yes';
          const isFolder = folderEntryFrom(event.dataTransfer) !== null;
          folderDrag.current = isFolder ? 'yes' : 'no';
          return isFolder;
        }, []);

        const flash = useCallback((kind, title, detail) => {
          if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
          setToast({ kind, title, detail });
          toastTimer.current = window.setTimeout(() => {
            toastTimer.current = null;
            setToast(null);
          }, TOAST_MS);
        }, []);

        useEffect(() => {
          return () => {
            if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
          };
        }, []);

        const cancelFlow = useCallback(() => {
          runId.current += 1;
          dragDepth.current = 0;
          folderDrag.current = 'unknown';
          setView(null);
          setPhase('idle');
        }, []);

        const messageFor = useCallback(
          (failure) => {
            const code = failure && failure.code ? failure.code : 'requestFailed';
            const keys = {
              'not-absolute': 'error.notAbsolute',
              'not-a-directory': 'error.notDirectory',
              'body-too-large': 'error.tooLarge',
              'invalid-json': 'error.badRequest',
              'cross-origin': 'error.badRequest',
              'scan-failed': 'error.scanFailed',
              offline: 'error.offline',
            };
            return t(keys[code] || 'error.requestFailed');
          },
          [t],
        );

        const addPath = useCallback(
          async (targetPath) => {
            if (busy.current) return;
            const run = (runId.current += 1);
            busy.current = true;
            setPhase('adding');
            try {
              const workspace = await ctx.workspaces.create({ path: targetPath });
              if (run !== runId.current) return;
              setView(null);
              setPhase('idle');
              flash('ok', t('toast.added', { title: workspace.title }), workspace.path);
              try {
                ctx.uiWorkspace.startSession(workspace.workspaceId);
              } catch {
                /* registration already succeeded; opening a session is best effort */
              }
            } catch (error) {
              if (run !== runId.current) return;
              setPhase('choose');
              setView((current) => ({
                name: current && current.name ? current.name : '',
                entries: current && current.entries ? current.entries : [],
                candidates: current && current.candidates ? current.candidates : [],
                truncated: false,
                error: error && error.message ? error.message : String(error),
              }));
            } finally {
              busy.current = false;
            }
          },
          [flash, t],
        );

        const handleDrop = useCallback(
          async (entry) => {
            const run = (runId.current += 1);
            setView({ name: entry.name, entries: [], candidates: null, truncated: false, error: null });
            setPhase('working');
            const entries = await readChildNames(entry, CHILD_LIMIT);
            if (run !== runId.current) return;
            const hints = hintDirectories(ctx.workspaces.list.getSnapshot());
            let result;
            try {
              result = await postResolve({ name: entry.name, entries, hints });
            } catch (failure) {
              if (run !== runId.current) return;
              setView({
                name: entry.name,
                entries,
                candidates: [],
                truncated: false,
                error: messageFor(failure),
              });
              setPhase('choose');
              return;
            }
            if (run !== runId.current) return;
            const candidates = Array.isArray(result.candidates) ? result.candidates : [];
            const best = candidates[0];
            if (candidates.length === 1 && best && (entries.length === 0 || best.score >= 0.5)) {
              await addPath(best.path);
              return;
            }
            setView({
              name: entry.name,
              entries,
              candidates,
              truncated: result.truncated === true,
              error: null,
            });
            setPhase('choose');
          },
          [addPath, messageFor],
        );

        const submitManual = useCallback(
          async (rawPath) => {
            const requested = rawPath.trim();
            if (requested === '') return;
            let result;
            try {
              result = await postResolve({ path: requested });
            } catch (failure) {
              setView((current) => (current ? { ...current, error: messageFor(failure) } : current));
              return;
            }
            const candidate = Array.isArray(result.candidates) ? result.candidates[0] : null;
            if (!candidate) {
              setView((current) => (current ? { ...current, error: t('error.notDirectory') } : current));
              return;
            }
            await addPath(candidate.path);
          },
          [addPath, messageFor, t],
        );

        const pickViaDialog = useCallback(async () => {
          let picked = null;
          try {
            picked = await ctx.uiWorkspace.pickDirectory();
          } catch (failure) {
            const detail = failure && failure.message ? failure.message : String(failure);
            setView((current) => (current ? { ...current, error: detail } : current));
            return;
          }
          if (typeof picked === 'string' && picked !== '') await addPath(picked);
        }, [addPath]);

        useEffect(() => {
          const onDragEnter = (event) => {
            if (!folderDragOf(event, true)) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepth.current += 1;
            setPhase((current) => (current === 'idle' || current === 'drag' ? 'drag' : current));
          };
          const onDragOver = (event) => {
            if (!folderDragOf(event, false)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            setPhase((current) => (current === 'idle' ? 'drag' : current));
          };
          const onDragLeave = (event) => {
            if (!folderDragOf(event, false)) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) resetDrag();
          };
          const onDrop = (event) => {
            // Read the entry straight from the drop instead of the cached probe:
            // a browser may only expose entries to the drop event itself.
            const entry = folderEntryFrom(event.dataTransfer);
            folderDrag.current = 'unknown';
            if (entry === null) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepth.current = 0;
            void handleDrop(entry);
          };
          const onDragEnd = () => resetDrag();
          const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            if (dragDepth.current === 0 && view === null) return;
            if (busy.current) return;
            cancelFlow();
          };
          window.addEventListener('dragenter', onDragEnter, true);
          window.addEventListener('dragover', onDragOver, true);
          window.addEventListener('dragleave', onDragLeave, true);
          window.addEventListener('drop', onDrop, true);
          window.addEventListener('dragend', onDragEnd, true);
          window.addEventListener('keydown', onKeyDown, true);
          return () => {
            window.removeEventListener('dragenter', onDragEnter, true);
            window.removeEventListener('dragover', onDragOver, true);
            window.removeEventListener('dragleave', onDragLeave, true);
            window.removeEventListener('drop', onDrop, true);
            window.removeEventListener('dragend', onDragEnd, true);
            window.removeEventListener('keydown', onKeyDown, true);
          };
        }, [cancelFlow, folderDragOf, handleDrop, resetDrag, view]);

        const backdrop = h('div', { className: 'dshdw-backdrop', onClick: phase === 'choose' ? cancelFlow : undefined });

        let layer = null;
        if (phase === 'drag') {
          layer = h(
            'div',
            { className: 'dshdw-layer' },
            backdrop,
            h(
              'div',
              { className: 'dshdw-target' },
              h(FolderDropIcon),
              h('div', { className: 'dshdw-title' }, t('drop.title')),
              h('div', { className: 'dshdw-hint' }, t('drop.hint')),
            ),
          );
        } else if (phase === 'working' || phase === 'adding') {
          layer = h(
            'div',
            { className: 'dshdw-layer' },
            backdrop,
            h(
              'div',
              { className: 'dshdw-card dshdw-working', role: 'status', 'aria-live': 'polite' },
              h('div', { className: 'dshdw-spinner' }),
              h(
                'div',
                { className: 'dshdw-title' },
                t(phase === 'adding' ? 'adding.title' : 'working.title', {
                  name: view && view.name ? view.name : '',
                }),
              ),
              phase === 'working' ? h('div', { className: 'dshdw-hint' }, t('working.hint')) : null,
            ),
          );
        } else if (phase === 'choose' && view) {
          const candidates = Array.isArray(view.candidates) ? view.candidates : [];
          const rows = candidates.map((candidate) =>
            h(
              'button',
              {
                key: candidate.path,
                type: 'button',
                className: 'dshdw-cand',
                onClick: () => void addPath(candidate.path),
              },
              h('span', { className: 'dshdw-cand-title' }, candidate.title || candidate.path),
              h('span', { className: 'dshdw-path' }, candidate.path),
              candidate.total > 0
                ? h(
                    'span',
                    { className: 'dshdw-meta' },
                    t('choose.match', { matched: candidate.matched, total: candidate.total }),
                  )
                : null,
            ),
          );
          layer = h(
            'div',
            { className: 'dshdw-layer' },
            backdrop,
            h(
              'div',
              {
                className: 'dshdw-card',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': t('choose.title', { name: view.name }),
              },
              h('div', { className: 'dshdw-title' }, t('choose.title', { name: view.name })),
              h('div', { className: 'dshdw-hint' }, t('choose.hint')),
              candidates.length === 0
                ? h('div', { className: 'dshdw-hint' }, t('choose.empty', { name: view.name }))
                : h('div', { className: 'dshdw-list' }, rows),
              view.error ? h('div', { className: 'dshdw-error' }, view.error) : null,
              h(ManualPath, {
                label: t('choose.pathLabel'),
                placeholder: t('choose.pathPlaceholder'),
                action: t('choose.add'),
                busy: busy.current,
                onSubmit: (text) => void submitManual(text),
              }),
              h(
                'div',
                { className: 'dshdw-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dshdw-btn', onClick: () => void pickViaDialog() },
                  t('choose.pick'),
                ),
                h('button', { type: 'button', className: 'dshdw-btn', onClick: cancelFlow }, t('choose.cancel')),
              ),
            ),
          );
        }

        const toastView = toast
          ? h(
              'div',
              {
                className: `dshdw-toast ${toast.kind === 'ok' ? 'dshdw-toast-ok' : 'dshdw-toast-err'}`,
                role: 'status',
                'aria-live': 'polite',
              },
              h('span', null, toast.title),
              toast.detail ? h('span', { className: 'dshdw-path' }, toast.detail) : null,
            )
          : null;

        return h(Fragment, null, STYLE_ELEMENT, layer, toastView);
      };
    }

    /**
     * Register the locale dictionaries and the overlay occupant.
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      const Overlay = createOverlay(ctx);
      ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }));
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'drop-workspace', order: 20 }, Overlay),
      );
    }

    return { inject: ['slots', 'locale', 'workspaces', 'uiWorkspace'], apply };
  },
});
