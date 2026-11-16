# Compatibility review

Reviewed against installed DeepSeek Harness **0.2.2-rc.3** on 2026-11-16.

Keep `engines.dsh: >=0.2.1-rc.3 <0.3.0` unchanged. No 0.2.2-rc.3-only dependency was identified, and this review provides no evidence for a lower minimum or a wider range. This is a support declaration, not proof that all intervening/future releases were tested; recheck APIs when upgrading DSH.

## Installed source evidence

The manifest at `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json` identifies 0.2.2-rc.3. Relative to its `node_modules/@deepseek-ai/`:

- `dsh-host-webserver/src/index.ts:430,445`: `getOrigin()` and disposable `register(route)` match the Host adapter.
- `dsh-api-workspace-controller/src/client/service.ts:37,49,55,130`: `list.getSnapshot()` and `create({ path }) -> WorkspaceView` match project lookup and registration.
- `dsh-client-ui-workspace/src/client/navigation.ts:91,120`: `startSession(workspaceId, options?)` and `pickDirectory()` match navigation and the fallback chooser.
- The plugin retains the classic ModuleLoader factory, locale service and `shell.overlay` slot; its manifest still names the workspace providers.

Reviewed packaged upgrade-index sections from 0.2.1-rc.3 through 0.2.2-rc.1 (including alpha sections). No migration of these used methods was identified. Context-menu and CSS-anchor changes affect menu consumers, not this overlay. The macOS window-drag-region guide concerns Desktop overlays; this package declares Web only. Attachment/projection/Session lineage/CUA/Forge/account/terminal/office changes do not change the plugin's existing Workspace methods or external drag routing. No corresponding code migration is necessary.

## Actual issue fixed

A syntactically valid `null` resolve request previously escaped JSON parsing and then threw at `body.path` outside the handler's catch. Because the route intentionally detaches its async handler, that could produce an unhandled rejection instead of an HTTP response. Arrays/primitives are also not the endpoint's payload contract. Parsing now rejects all non-object JSON with HTTP 400 `invalid-json` before accessing fields. Normal folder resolution is unchanged.

## Verification and limits

`npm test` checks the generated browser artifact, syntax, 28 existing external-drag routing/cleanup cases, plus two Host endpoint regressions covering malformed/non-object JSON, method/origin and absolute-path validation (30 total). The new tests use streams and response doubles without scanning the host, creating Workspaces, accessing the live profile or networking. This is not a visual or real Finder/browser end-to-end acceptance test; no such acceptance is claimed.
