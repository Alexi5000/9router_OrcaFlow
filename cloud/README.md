# 9Router Cloud Worker

Deploy your own Cloudflare Worker to access 9Router from anywhere.

## Setup

```bash
# 1. Login to Cloudflare
npm install -g wrangler
wrangler login

# 2. Install dependencies
cd app/cloud
npm install

# 3. Create KV & D1, then paste IDs into wrangler.toml
wrangler kv namespace create KV
wrangler d1 create proxy-db

# 4. Set a dedicated random management token (at least 32 characters)
wrangler secret put CLOUD_SYNC_MANAGEMENT_TOKEN

# 5. Init database & deploy
wrangler d1 execute proxy-db --remote --file=./migrations/0001_init.sql
npm run deploy
```

Legacy dashboard setup guidance (the current fork has no implemented `/api/sync/cloud` route): Copy your Worker URL → 9Router Dashboard → **Endpoint** → **Setup Cloud** → paste → **Save** → **Enable Cloud**.

## Sync management authentication

Every GET, POST and DELETE to `/sync/:machineId` requires `Authorization: Bearer <CLOUD_SYNC_MANAGEMENT_TOKEN>`. Configure a dedicated randomly generated token of at least 32 characters using the Worker secret command above. Store the same value only in the environment/secret store of a trusted server-side sync caller. Never expose it in browser code, public variables, URLs, logs or inference API keys. Missing/short Worker configuration returns503; missing or incorrect bearer returns401 before storage is read or modified. OPTIONS remains a credential-free preflight and performs no storage operation.

This is one operator's management credential with access to all machine records on that Worker. It is not per-machine or multi-tenant isolation. Machine IDs select records and confer no authority; inference API keys and dashboard sessions do not authorize standalone Worker sync. Use separate Workers/credentials where operators need separate administration. Rotate the Worker secret and trusted callers together; the former token immediately stops authorizing new requests. There is no fallback to anonymous sync.

Existing external sync clients must add this header before the updated Worker is deployed. The method paths and authorized request/response payloads are unchanged. The checked-in scheduler references a missing Next.js sync endpoint and is not initialized by this fork, so this change does not claim to restore that feature or send the management token through the dashboard. No account secrets, bindings, domains or deployed settings are provisioned automatically.

The obsolete `/testClaude` endpoint was removed because its handler was absent and prevented the Worker entrypoint from loading. No supported client or documented setup refers to it; it now returns404.
