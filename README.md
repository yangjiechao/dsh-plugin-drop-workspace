# dsh-plugin-drop-workspace

Drag a folder from Finder onto the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI and it becomes a project — a registered Workspace on the host machine, opened in a new session. No menu, no dialog.

<sub>把文件夹从 Finder 拖到 DeepSeek Harness 网页里，它就成为宿主机上的一个项目（Workspace），并自动开一个新会话；不用点菜单，也不用翻文件夹对话框。</sub>

## Install

Requires DeepSeek Harness `0.2.x` (declared as `engines.dsh: >=0.2.1-rc.3 <0.3.0`) with the Web GUI. There is no build step — the package ships plain ESM plus a prebuilt browser module.

**From GitHub** (no npm account needed). In the Web GUI open **Plugins → Add**, paste:

```
github:<your-user>/dsh-plugin-drop-workspace
```

Or ask the agent to run the `plugin_manager` tool:

```
install_bundle  target: "github:<your-user>/dsh-plugin-drop-workspace"
```

**From npm**, once published:

```
install_bundle  target: "dsh-plugin-drop-workspace"
```

**From a local checkout** (for development): install the absolute directory, which is linked instead of copied:

```
install_bundle  target: "/absolute/path/to/dsh-plugin-drop-workspace"
```

Installing enables the bundle. If the host was already running with this bundle, toggle the `drop-workspace` row off/on (or restart `dsh web`) so the host module reloads; refresh the page to pick up a changed `client.js`.

## Use

1. Drag a folder from Finder (or Explorer) anywhere onto the page.
2. A dashed drop target appears; release.
3. Harness looks the folder up on the host and, when the match is unambiguous, registers it and opens a new session.
4. Otherwise a chooser lists the ranked candidates, with an absolute-path field and **Choose in system dialog…** as fallbacks.

Only folder drags are claimed, and only in the window capture phase, so dropping **files** into the composer still goes to its attachment intake.

## How the resolution works

A browser drop never reveals an absolute host path — `webkitGetAsEntry()` gives you a name and the folder's contents, nothing about where it lives on disk. Harness Workspaces are identified by host path, so the plugin resolves in two steps:

1. The client posts the folder name, up to 60 top-level entry names, and the parent directories of already-registered Workspaces to `POST /dsh-drop-workspace/resolve`.
2. The host walks a bounded set of roots (those parents first, then `$HOME`, depth 3–4) for directories with a matching basename, and ranks them by how many of the dropped folder's entries they contain.

A single candidate is adopted automatically when the dropped folder is empty or the entry overlap is at least 50%; anything else opens the chooser rather than guessing. Registration itself uses the existing Workspace Remote (`ctx.workspaces.create`), so there is no second registry and nothing is written outside the profile's normal state.

### Limits

- The scan is bounded: 24 000 directories, 1.6 s wall clock, skipping `node_modules`, `.git`, `Library`, build output and hidden directories. A partial answer reports `truncated`.
- A folder named like an existing one elsewhere on the machine can produce several candidates — that is what the chooser is for.
- Folders on volumes outside `$HOME` (for example an external disk) will usually need the chooser's path field or the system dialog.
- Folder drops rely on `webkitGetAsEntry()`: Chrome, Edge and Safari work; Firefox exposes entries only at drop time, so the invitation overlay may not appear there (the drop itself still works).

## Security and privacy

This is host-side code: it runs in-process in the Harness host, outside the workspace sandbox, like any bundle. Specifically it:

- registers one loopback HTTP route, `POST /dsh-drop-workspace/resolve`, rejecting non-POST methods, cross-origin `Origin` headers, and bodies over 64 KiB;
- reads directory listings under `$HOME` and the parents of registered Workspaces while a drop is being resolved;
- makes no network requests of its own, stores nothing, and sends no telemetry.

Read `index.js` and `search.js` before installing — they are small and do exactly the above.

## Files

| File | Role |
|---|---|
| `index.js` | Host plugin: the resolve route, same-origin check, body limit |
| `search.js` | Bounded candidate scan and ranking |
| `client.js` | Client plugin: drop invitation, chooser, registration |
| `cordis.patch.yml` | Inserts the `drop-workspace` row |
| `locale/{en,zh}.json` | Display metadata for the plugin list |

## Develop

Plain ESM, no bundler. Edit `search.js` / `index.js`, then toggle the `drop-workspace` row (unload and reload picks up new host code). `client.js` is served by the host with a file-metadata revision, but a page refresh is the reliable way to see client changes.

## License

MIT — see [LICENSE](LICENSE).
