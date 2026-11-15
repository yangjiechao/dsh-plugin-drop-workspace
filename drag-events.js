/**
 * External filesystem drag routing. Kept independent of React and DSH so the
 * protected-data-store and event propagation rules can be regression tested.
 * scripts/build-client.js embeds this module in the shipped classic script.
 */

/** Read entries synchronously: the browser may revoke access after drop returns. */
function inspectTransfer(transfer) {
  const folders = [];
  let fileCount = 0;
  for (const item of Array.from(transfer?.items ?? [])) {
    if (item?.kind !== 'file') continue;
    fileCount += 1;
    let entry = null;
    try {
      entry = item.webkitGetAsEntry?.();
    } catch {
      // An unavailable entry is unknown, never proof of an ordinary file.
    }
    if (entry?.isDirectory === true) folders.push(entry);
  }
  return { folders, fileCount: Math.max(fileCount, transfer?.files?.length ?? 0) };
}

/** Do not interfere with text, links, or DSH's own retained-image drags. */
function isExternalFileTransfer(transfer) {
  const types = Array.from(transfer?.types ?? []);
  return types.includes('Files') && !types.includes('application/x-dsh-file');
}

/**
 * Own the invitation for external file drags, not ordinary file drops.
 * Before drop, even Chrome/Safari may hide directory entries. A neutral
 * invitation prevents the built-in attachment overlay from opening and then
 * missing the directory drop that we must consume. At drop, ordinary files
 * continue as the ORIGINAL event, with their File objects untouched.
 *
 * @param target - the browser Window (an event target in unit tests).
 * @param callbacks - preview, folder, rejection and cancellation callbacks.
 * @returns disposal for exactly this installation's listeners.
 */
export function installProjectDropEvents(target, callbacks) {
  let depth = 0;
  let preview = null;

  const publish = (next) => {
    if (preview === next) return;
    preview = next;
    callbacks.onPreview(next);
  };
  const reset = () => {
    depth = 0;
    publish(null);
  };
  const claim = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const showPreview = (transfer) => {
    // Probe again rather than caching a negative result during protected mode.
    const { folders } = inspectTransfer(transfer);
    publish(folders.length > 0 || preview === 'folder' ? 'folder' : 'pending');
  };
  const onDragEnter = (event) => {
    if (!isExternalFileTransfer(event.dataTransfer)) return;
    claim(event);
    depth += 1;
    showPreview(event.dataTransfer);
  };
  const onDragOver = (event) => {
    if (!isExternalFileTransfer(event.dataTransfer)) return;
    claim(event);
    depth = Math.max(1, depth);
    event.dataTransfer.dropEffect = 'copy';
    showPreview(event.dataTransfer);
  };
  const onDragLeave = (event) => {
    // dragleave often has no readable DataTransfer. Use the active drag instead.
    if (preview === null) return;
    claim(event);
    depth = Math.max(0, depth - 1);
    const outside = event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= target.innerWidth || event.clientY >= target.innerHeight;
    if (depth === 0 || (event.relatedTarget == null && outside)) reset();
  };
  const onDrop = (event) => {
    const wasFolder = preview === 'folder';
    reset();
    if (!isExternalFileTransfer(event.dataTransfer)) return;
    const { folders, fileCount } = inspectTransfer(event.dataTransfer);
    if (folders.length === 0) {
      if (wasFolder) {
        claim(event);
        callbacks.onReject('unreadable');
      }
      // No replay or synthetic drop: DSH receives the original ordinary files.
      return;
    }
    claim(event);
    if (folders.length !== 1 || fileCount !== 1) {
      callbacks.onReject('multiple');
    } else if (callbacks.canAcceptFolder && !callbacks.canAcceptFolder()) {
      callbacks.onReject('busy');
    } else {
      callbacks.onFolderDrop(folders[0]);
    }
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    if (callbacks.canCancel && !callbacks.canCancel()) return;
    if (preview === null && !callbacks.hasFlow?.()) return;
    claim(event);
    reset();
    callbacks.onCancel();
  };
  const onVisibilityChange = () => {
    if (target.document?.hidden) reset();
  };

  const listeners = {
    dragenter: onDragEnter,
    dragover: onDragOver,
    dragleave: onDragLeave,
    drop: onDrop,
    dragend: reset,
    blur: reset,
    keydown: onKeyDown,
  };
  for (const [type, listener] of Object.entries(listeners)) {
    target.addEventListener(type, listener, true);
  }
  target.document?.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    for (const [type, listener] of Object.entries(listeners)) {
      target.removeEventListener(type, listener, true);
    }
    target.document?.removeEventListener('visibilitychange', onVisibilityChange);
    depth = 0;
    preview = null;
  };
}
