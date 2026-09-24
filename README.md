# i wish it were real

A shared whiteboard for a few friends, at [iwishitwerereal.com](https://iwishitwerereal.com).

- **One Cloudflare Worker** serves the React app and the API.
- **The board is [Quickdraw](https://github.com/huttj/quickdraw)**, pinned as a git submodule in `vendor/quickdraw` and linked with `file:` dependencies, so a fork with the features we like ships without waiting on an npm release.
- **Sync** is a small room protocol of our own (`shared/protocol.ts`) on a SQLite-backed Durable Object (`worker/BoardDurableObject.ts`, one per room; the room is `main`). Quickdraw's store emits JSON diffs for every change; the room validates them, writes them through, and relays them. Records are whole and last-writer-wins. Live cursors and laser pointers ride the same socket.
- **Viewing is public.** Anyone can open the canvas and follow deep links; anonymous sessions are read-only, enforced by the room, and viewers are invisible to editors.
- **Editing** needs a sign-in via invite-only magic links. The allowlist, tokens and sessions live in a second Durable Object. Admins come from the `ADMIN_EMAILS` var and can add or remove people at `/admin`.
- **Email** goes out through Cloudflare Email Sending, so there is no third-party mail provider.
- **Images** are uploaded to R2 (named by content hash) before they sync; the document only ever holds the upload URL.
- **Attribution:** every shape is stamped with who created and last edited it (`meta` on the record, written by a store reactor so it lands in the same undo step). Hover a shape to see it. "Copy link to view" shares the exact camera position.

## Develop

```sh
git submodule update --init
npm install
npm run dev
```

Magic links in local dev are also printed to the wrangler console. Sending real email from `wrangler dev` uses the remote binding, so it does work if you are logged in to wrangler.

To move to a newer Quickdraw, check out the commit you want inside `vendor/quickdraw` and commit the submodule pointer.

## Deploy

Pushes to `main` deploy via GitHub Actions. The workflow needs one repository secret:

- `CLOUDFLARE_API_TOKEN`: a token made from the **Edit Cloudflare Workers** template, plus **Zone → DNS → Edit** on `iwishitwerereal.com` so the custom domain can be attached.

Manual deploy: `npm run deploy`.

## The old tldraw board

The tldraw-era room class is still declared (`worker/LegacyTldrawDurableObject.ts`) so its data is not dropped; its content was converted onto the Quickdraw board with Quickdraw's own tldraw importer on 2026-09-24, and admins can still pull the raw records from `/api/admin/legacy/tldraw`. When that backup is no longer wanted, add a migration to `wrangler.jsonc`:

```jsonc
{ "tag": "v3", "deleted_classes": ["TldrawDurableObject"] }
```

then remove the class, its binding and the export route.
