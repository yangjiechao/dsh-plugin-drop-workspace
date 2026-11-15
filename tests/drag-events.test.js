import assert from 'node:assert/strict';
import test from 'node:test';
import { installProjectDropEvents } from '../drag-events.js';

/** Unit-level capture/document routing; this is not a browser or UI renderer. */
function harness(options = {}) {
  const listeners = new Map();
  const documentListeners = new Map();
  const previews = [];
  const folders = [];
  const rejected = [];
  const native = [];
  let cancellations = 0;
  const document = {
    hidden: false,
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    removeEventListener(type, fn) {
      if (documentListeners.get(type) === fn) documentListeners.delete(type);
    },
  };
  const target = {
    document, innerWidth: 1200, innerHeight: 800,
    addEventListener(type, fn, capture) {
      assert.equal(capture, true);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn, capture) {
      assert.equal(capture, true);
      listeners.get(type)?.delete(fn);
    },
  };
  const callbacks = {
    onPreview: (value) => previews.push(value),
    onFolderDrop: (entry) => folders.push(entry),
    onReject: (reason) => rejected.push(reason),
    onCancel: () => { cancellations += 1; },
    ...options,
  };
  const install = () => installProjectDropEvents(target, callbacks);
  const dispose = install();
  const originalTarget = {};
  function dispatch(type, dataTransfer, extras = {}) {
    const event = {
      type, dataTransfer, target: originalTarget,
      clientX: 300, clientY: 200, relatedTarget: {},
      defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...extras,
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
    // Match DSH's document listeners: capture stopPropagation keeps them out.
    if (!event.propagationStopped) native.push(event);
    return event;
  }
  return {
    dispatch, previews, folders, rejected, native, dispose, install, listeners,
    target, documentListeners, originalTarget,
    get cancellations() { return cancellations; },
  };
}

const folder = (name = 'project') => ({ isDirectory: true, name });
const fileEntry = (name = 'file.txt') => ({ isFile: true, isDirectory: false, name });
function transfer(entries, { files, types = ['Files'], throws = false } = {}) {
  return {
    types,
    items: entries.map((entry) => ({
      kind: 'file',
      webkitGetAsEntry() {
        if (throws) throw new Error('protected data store');
        return entry;
      },
      getAsFile() { throw new Error('Never reconstruct a file or read it during hover'); },
    })),
    files: files ?? [],
  };
}

function drag(h, hover) {
  h.dispatch('dragenter', hover);
  h.dispatch('dragover', hover);
}

test('protected hover is neutral; a folder readable only at drop is claimed once', () => {
  const h = harness();
  const entry = folder();
  drag(h, transfer([null]));
  assert.deepEqual(h.previews, ['pending']);
  assert.equal(h.native.length, 0, 'built-in overlay never sees hover');
  const drop = h.dispatch('drop', transfer([entry]));
  assert.equal(drop.defaultPrevented, true);
  assert.equal(drop.propagationStopped, true);
  assert.deepEqual(h.folders, [entry]);
  assert.deepEqual(h.previews, ['pending', null]);
  assert.equal(h.native.length, 0, 'no dragend is needed to clear either preview');
});

test('a positively identified directory gets the project invitation', () => {
  const h = harness();
  const entry = folder();
  drag(h, transfer([entry]));
  assert.deepEqual(h.previews, ['folder']);
  h.dispatch('drop', transfer([entry]));
  assert.deepEqual(h.folders, [entry]);
  assert.deepEqual(h.previews, ['folder', null]);
});

test('unknown is never cached as no; dragover can discover the folder later', () => {
  const h = harness();
  h.dispatch('dragenter', transfer([null]));
  h.dispatch('dragover', transfer([folder()]));
  h.dispatch('dragover', transfer([null]));
  assert.deepEqual(h.previews, ['pending', 'folder']);
});

test('throwing entry API during hover still permits a real folder drop', () => {
  const h = harness();
  drag(h, transfer([null], { throws: true }));
  const entry = folder();
  h.dispatch('drop', transfer([entry]));
  assert.deepEqual(h.folders, [entry]);
});

for (const [name, type, contents] of [
  ['photo.png', 'image/png', 'png'],
  ['notes.txt', 'text/plain', 'text'],
  ['unknown.bin', '', 'bytes'],
  ['empty', '', ''],
]) {
  test(`original ${name} drop is delivered untouched to the attachment intake`, () => {
    const h = harness();
    const file = new File([contents], name, { type });
    drag(h, transfer([null]));
    const payload = transfer([fileEntry(name)], { files: [file] });
    const drop = h.dispatch('drop', payload);
    assert.equal(drop.defaultPrevented, false);
    assert.equal(drop.propagationStopped, false);
    assert.deepEqual(h.native, [drop]);
    assert.equal(h.native[0], drop);
    assert.equal(drop.dataTransfer, payload);
    assert.equal(drop.dataTransfer.files[0], file);
    assert.equal(drop.target, h.originalTarget);
    assert.deepEqual(h.folders, []);
    assert.deepEqual(h.rejected, []);
    assert.deepEqual(h.previews, ['pending', null]);
  });
}

test('multiple ordinary files retain their order and identities', () => {
  const h = harness();
  const files = [new File(['1'], 'a.txt'), new File(['2'], 'b.png')];
  drag(h, transfer([null, null]));
  const drop = h.dispatch('drop', transfer([fileEntry(), null], { files }));
  assert.equal(h.native[0], drop);
  assert.equal(drop.dataTransfer.files, files);
  assert.equal(h.folders.length, 0);
});

test('missing entry API is not interpreted as a directory', () => {
  const h = harness();
  const payload = { types: ['Files'], items: [{ kind: 'file' }], files: [] };
  drag(h, payload);
  const drop = h.dispatch('drop', payload);
  assert.equal(h.native[0], drop);
  assert.equal(h.folders.length, 0);
});

for (const entries of [
  [folder('one'), folder('two')],
  [folder(), fileEntry('photo.png')],
  [folder(), null],
]) {
  test(`mixed/multiple payload (${entries.map((e) => e?.name ?? 'unreadable').join(', ')}) is explicitly rejected`, () => {
    const h = harness();
    drag(h, transfer(entries));
    const drop = h.dispatch('drop', transfer(entries));
    assert.equal(drop.propagationStopped, true);
    assert.deepEqual(h.rejected, ['multiple']);
    assert.deepEqual(h.folders, []);
    assert.equal(h.native.length, 0);
    assert.equal(h.previews.at(-1), null);
  });
}

test('a previously known folder becoming unreadable is not uploaded as a file', () => {
  const h = harness();
  drag(h, transfer([folder()]));
  const drop = h.dispatch('drop', transfer([null]));
  assert.equal(drop.propagationStopped, true);
  assert.deepEqual(h.rejected, ['unreadable']);
  assert.equal(h.folders.length, 0);
});

test('drop inspects the actual payload even without any preceding hover', () => {
  const h = harness();
  const entry = folder();
  h.dispatch('drop', transfer([entry]));
  assert.deepEqual(h.folders, [entry]);
});

test('busy or chooser policy rejects a second directory instead of replacing work', () => {
  const h = harness({ canAcceptFolder: () => false });
  drag(h, transfer([folder()]));
  h.dispatch('drop', transfer([folder()]));
  assert.deepEqual(h.rejected, ['busy']);
  assert.deepEqual(h.folders, []);
  assert.equal(h.previews.at(-1), null);
});

test('nested enter/leave does not flicker, even without DataTransfer on leave', () => {
  const h = harness();
  const hover = transfer([null]);
  h.dispatch('dragenter', hover);
  h.dispatch('dragenter', hover);
  h.dispatch('dragleave', null);
  assert.deepEqual(h.previews, ['pending']);
  h.dispatch('dragleave', null);
  assert.deepEqual(h.previews, ['pending', null]);
});

test('leaving viewport resets even with unmatched nested enters', () => {
  const h = harness();
  h.dispatch('dragenter', transfer([null]));
  h.dispatch('dragenter', transfer([null]));
  h.dispatch('dragleave', null, { clientX: 0, clientY: 0, relatedTarget: null });
  assert.equal(h.previews.at(-1), null);
  drag(h, transfer([folder()]));
  assert.equal(h.previews.at(-1), 'folder');
});

for (const terminal of ['dragend', 'blur', 'Escape', 'hidden']) {
  test(`${terminal} clears a preview and the next drag works`, () => {
    const h = harness();
    drag(h, transfer([null]));
    if (terminal === 'hidden') {
      h.target.document.hidden = true;
      h.documentListeners.get('visibilitychange')();
    } else if (terminal === 'Escape') {
      h.dispatch('keydown', null, { key: 'Escape' });
      assert.equal(h.cancellations, 1);
    } else h.dispatch(terminal);
    assert.equal(h.previews.at(-1), null);
    drag(h, transfer([folder()]));
    assert.equal(h.previews.at(-1), 'folder');
  });
}

test('Escape cancels an open flow, but does not cancel a busy add', () => {
  const h = harness({ hasFlow: () => true });
  h.dispatch('keydown', null, { key: 'Escape' });
  assert.equal(h.cancellations, 1);
  const busy = harness({ hasFlow: () => true, canCancel: () => false });
  busy.dispatch('keydown', null, { key: 'Escape' });
  assert.equal(busy.cancellations, 0);
});

for (const types of [['text/plain'], ['text/uri-list'], ['application/x-dsh-file'], ['Files', 'application/x-dsh-file']]) {
  test(`non-external drag ${types.join('+')} passes through unchanged`, () => {
    const h = harness();
    const payload = transfer([null], { types });
    const enter = h.dispatch('dragenter', payload);
    const over = h.dispatch('dragover', payload);
    const drop = h.dispatch('drop', payload);
    assert.deepEqual(h.native, [enter, over, drop]);
    assert.deepEqual(h.previews, []);
    assert.equal(h.folders.length, 0);
  });
}

test('dispose and remount remove exactly their own listeners, without duplicates', () => {
  const h = harness();
  h.dispose();
  assert.equal([...h.listeners.values()].reduce((sum, items) => sum + items.size, 0), 0);
  assert.equal(h.documentListeners.size, 0);
  drag(h, transfer([folder()]));
  assert.deepEqual(h.previews, []);
  const disposeAgain = h.install();
  drag(h, transfer([folder()]));
  const entry = folder();
  h.dispatch('drop', transfer([entry]));
  assert.deepEqual(h.folders, [entry]);
  disposeAgain();
  assert.equal(h.documentListeners.size, 0);
});
