# Vercel proxy for social.nutrimeals.au

A stand-in front door while (or instead of) Railway's custom domain: Vercel serves `social.nutrimeals.au` and
rewrites every request to the Railway service's generated domain. The browser keeps seeing `social.nutrimeals.au`,
so the hub's `.nutrimeals.au` session cookie works. Telegram is unaffected (the bot polls outward).

```bash
cd deploy/vercel-proxy
vercel.cmd login            # once; .cmd avoids PowerShell's script policy
vercel.cmd --prod           # creates the project "fuadijan-social-proxy" and deploys this folder
vercel.cmd domains add social.nutrimeals.au
```

The last command prints the CNAME value Vercel wants (a `….vercel-dns-017.com` name, like the other apps). Put it
in GoDaddy as the `social` CNAME in place of `sd9gqk3y.up.railway.app`. Done within the TTL.

Limits: requests pass through Vercel, which caps request bodies (large photo uploads should still go through
Telegram). To go back to Railway directly, point the CNAME at Railway's value again; nothing in the app changes.
