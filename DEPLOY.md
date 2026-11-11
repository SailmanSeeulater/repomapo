# Deploying repomapo

repomapo goes on the Oracle VPS the same way gitube does: GitHub Actions builds
it, then rsyncs the static `dist/` folder into a web root that the host nginx
serves. There is no container and no server process: the app is plain files,
and the only thing it fetches is an index JSON from its own origin.

| Thing | Value |
| --- | --- |
| URL | https://repomapo.latesailor.dev (assumed; change it in the four places listed below) |
| VPS | `ubuntu@146.235.217.254` |
| Web root | `/var/www/repomapo` |
| nginx vhost | `deploy/nginx/repomapo.conf` to `/etc/nginx/sites-available/repomapo` |
| Security headers | `deploy/nginx/repomapo-headers.conf` to `/etc/nginx/snippets/repomapo-headers.conf` |
| Pipeline | `.github/workflows/deploy.yml`, runs on every push to `master` |
| Secret | `VPS_SSH_KEY`, the private half of a deploy key for this repo |

The address appears in `deploy/nginx/repomapo.conf`, `.github/workflows/deploy.yml`
(`SITE_URL`), and this file. Change all of them together.

## What gets published

Only `public/data/sample.json`, the index of the small project in `sample/`.
An index you build locally lands in `public/data/threads.json`, which is
ignored by git because it holds the full source of whatever repo you indexed.
The deploy job fails if `dist/data` contains anything but the sample.

Do not deploy a `dist/` built on your own machine without deleting
`dist/data/threads.json` first: a local build copies it in.

## Once

1. **DNS.** An A record `repomapo` pointing at `146.235.217.254`. Check it with
   `nslookup repomapo.latesailor.dev` before running certbot.
2. **A deploy key for this repo.** `ssh-keygen -t ed25519 -C "repomapo deploy" -f ~/.ssh/repomapo_deploy -N ""`.
   The private half goes into the GitHub secret `VPS_SSH_KEY`; the public half
   is appended to `~/.ssh/authorized_keys` on the VPS.
3. **The VPS.** Copy the two nginx files up, then:

   ```bash
   sudo install -d -o www-data -g www-data /var/www/repomapo
   sudo mv /tmp/repomapo-headers.conf /etc/nginx/snippets/repomapo-headers.conf
   sudo mv /tmp/repomapo.conf /etc/nginx/sites-available/repomapo
   sudo ln -s /etc/nginx/sites-available/repomapo /etc/nginx/sites-enabled/repomapo
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d repomapo.latesailor.dev
   ```

   The deploy user needs passwordless `sudo rsync` and `sudo find`, as for gitube.
4. **Push to `master`.** The deploy job builds, syncs and smoke-tests the live site.

## Checking a deploy

The job's smoke test covers the page title, the immutable cache header on the
hashed entry script, the sample index, a real 404 for a missing index, and the
Content-Security-Policy. To re-run a deploy without a commit, use "Run workflow"
on the Deploy action.
