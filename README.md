# i wish it were real

A shared tldraw canvas for a few friends, at [iwishitwerereal.com](https://iwishitwerereal.com).

- **One Cloudflare Worker** serves the React app and the API.
- **tldraw sync** runs on a SQLite-backed Durable Object (one per room; the room is `main`).
- **Viewing is public.** Anyone can open the canvas and follow deep links; anonymous sessions are read-only, enforced by the sync server, and viewers are invisible to editors.
- **Editing** needs a sign-in via invite-only magic links. The allowlist, tokens and sessions live in a second Durable Object. Admins come from the `ADMIN_EMAILS` var and can add or remove people at `/admin`.
- **Email** goes out through Cloudflare Email Sending, so there is no third-party mail provider.
- **Uploads** (images, video) go to R2.
- Every shape is stamped with who created and last edited it; hover a shape to see it. "Copy link to view" shares the exact camera position.

## Develop

```sh
npm install
npm run dev
```

Magic links in local dev are also printed to the wrangler console. Sending real email from `wrangler dev` uses the remote binding, so it does work if you are logged in to wrangler.

## Deploy

Pushes to `main` deploy via GitHub Actions. The workflow needs one repository secret:

- `CLOUDFLARE_API_TOKEN`: a token made from the **Edit Cloudflare Workers** template, plus **Zone → DNS → Edit** on `iwishitwerereal.com` so the custom domain can be attached.

Manual deploy: `npm run deploy`.
