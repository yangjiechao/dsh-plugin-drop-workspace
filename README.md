# dsh-plugin-drop-workspace

Drag a folder from Finder onto the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI and it becomes a project — a registered Workspace on the host machine, opened in a new session. No menu, no dialog.

<sub>把文件夹从 Finder 拖到 DeepSeek Harness 网页里，它就成为宿主机上的一个项目（Workspace），并自动开一个新会话；不用点菜单，也不用翻文件夹对话框。</sub>

## Install

Requires DeepSeek Harness `0.2.x` (declared as `engines.dsh: >=0.2.1-rc.3 <0.3.0`) with the Web GUI. There is no build step — the package ships plain ESM plus a prebuilt browser module.

**From GitHub** (no npm account needed). In the Web GUI open **Plugins → Add**, paste:

```
github:yangjiechao/dsh-plugin-drop-workspace
```

Or ask the agent to run the `plugin_manager` tool:

```
install_bundle  target: "github:yangjiechao/dsh-plugin-drop-workspace"
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
2. A dashed drop target appears; release. If the browser hides the item type until drop, the invitation explains both outcomes: folders become projects; files and images become attachments.
3. Harness looks the folder up on the host and, when the match is unambiguous, registers it and opens a new session.
4. Otherwise a chooser lists the ranked candidates, with an absolute-path field and **Choose in system dialog…** as fallbacks.

External filesystem **hover** events are handled in the window capture phase, before the built-in attachment overlay can show an image-only invitation for a folder. The preview is pointer-transparent, so it does not change the actual drop target. At **drop**, only a single folder is claimed: ordinary files and images continue to DSH's attachment intake as the original, unmodified event. Text, links and DSH's internal image drags are not intercepted.

<sub>拖入前若浏览器尚未提供目录信息，会显示“松开以识别拖入内容 / 文件夹新建项目，文件或图片添加为附件”。松手后才分流：单个文件夹新建项目；普通文件和图片仍作为附件，不会被误建成项目。更新插件后请刷新现有页面，清除旧拖拽状态。</sub>

## How the resolution works

A browser drop never reveals an absolute host path — `webkitGetAsEntry()` gives you a name and the folder's contents, nothing about where it lives on disk. Harness Workspaces are identified by host path, so the plugin resolves in two steps:

1. The client posts the folder name, up to 60 top-level entry names, and the parent directories of already-registered Workspaces to `POST /dsh-drop-workspace/resolve`.
2. The host walks a bounded set of roots (those parents first, then `$HOME`, depth 3–4) for directories with a matching basename, and ranks them by how many of the dropped folder's entries they contain.

A single candidate is adopted automatically when the dropped folder is empty or the entry overlap is at least 50%; anything else opens the chooser rather than guessing. Registration itself uses the existing Workspace Remote (`ctx.workspaces.create`), so there is no second registry and nothing is written outside the profile's normal state.

### Limits

- The scan is bounded: 24 000 directories, 1.6 s wall clock, skipping `node_modules`, `.git`, `Library`, build output and hidden directories. A partial answer reports `truncated`.
- A folder named like an existing one elsewhere on the machine can produce several candidates — that is what the chooser is for.
- Folders on volumes outside `$HOME` (for example an external disk) will usually need the chooser's path field or the system dialog.
- Folder drops rely on `webkitGetAsEntry()`. Browsers may expose entries only at drop time (including protected drag-data modes in Chromium/WebKit); before then the invitation stays neutral instead of treating a missing entry as “not a folder”.
- Drop **one project folder at a time**. Multiple folders, or a folder mixed with files, are rejected with an explicit message rather than silently ignoring extra items. Multiple ordinary file/image attachments still pass through together.
- Finish or cancel an open project operation before dropping another project folder.

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
| `client.js` | Shipped classic browser module: invitation, chooser, registration |
| `drag-events.js` | React-independent event routing source, embedded into `client.js` |
| `scripts/build-client.js` | Dependency-free inline build and stale-artifact check |
| `tests/drag-events.test.js` | Event routing and cleanup regression tests |
| `cordis.patch.yml` | Inserts the `drop-workspace` row |
| `locale/{en,zh}.json` | Display metadata for the plugin list |

## Develop

The package ships its generated `client.js`; installing it still needs no build or dependencies. To develop with Node.js 20+:

```sh
npm run build  # inline drag-events.js after editing it; commit client.js as well
npm test       # check generated output, syntax and event-routing regressions
```

The tests cover protected-mode hover, drop-only directory entries, original file/image delivery, mixed payload rejection, cancellation and listener disposal. They are unit-level event tests, **not** a claim that Finder/Chrome/Safari has been visually exercised. After updating the installed plugin, refresh the existing Harness page and manually drag a folder and a PNG from Finder to confirm both paths.

Edit `search.js` / `index.js`, then toggle the `drop-workspace` row (unload and reload picks up new host code). `client.js` is served by the host with a file-metadata revision, but a page refresh is the reliable way to see client changes.

## License

MIT — see [LICENSE](LICENSE).
