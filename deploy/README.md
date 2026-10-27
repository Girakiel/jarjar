# Deploying jarjar on AWS Lightsail

One small server runs jarjar and [Caddy](https://caddyserver.com), which handles HTTPS. Plan on about 20 minutes, most of it waiting.

One jarjar instance can track any number of websites: add each one under **Add a site** in the dashboard.

## 1. Pick the address

The steps below use `jarjar.edugamitec.com`. Any subdomain you control works; avoid names like `analytics.` or `stats.`, which ad blockers filter.

## 2. Give the server read access to the code

The repository is private, so the server needs a read-only token to download it:

1. On GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: *Only select repositories* → `Girakiel/jarjar`.
3. **Permissions → Repository permissions → Contents**: *Read-only*. Nothing else.
4. Generate and copy the token.

(If you make the repository public instead, skip this and leave `GITHUB_TOKEN` empty. [Automatic updates](#updating) need a public repository, because they read test results from GitHub's public API.)

## 3. Create the server

In the [Lightsail console](https://lightsail.aws.amazon.com):

1. **Create instance**. Pick the region closest to your visitors.
2. Platform **Linux/Unix**, blueprint **OS Only → Ubuntu 24.04 LTS**.
3. **+ Add launch script**: paste the contents of [`lightsail-launch.sh`](lightsail-launch.sh) and fill in `GITHUB_TOKEN` (and `JARJAR_DOMAIN` if you chose another address).
4. Plan: **2 GB RAM** (the smaller plans also work thanks to a swap file, but builds are slow).
5. Name it `jarjar` and **Create instance**.

When it's running, open the instance:

6. **Networking → Create static IP** and attach it to the instance. Note the IP.
7. **Networking → IPv4 Firewall → Add rule**: application **HTTPS** (TCP 443). SSH and HTTP are open already.
8. **Snapshots → Automatic snapshots**: turn on. These are your daily backups.

## 4. Point the address at the server

Add an **A record** for `jarjar` pointing at the static IP, wherever `edugamitec.com`'s DNS is managed:

- **Route 53** → Hosted zones → `edugamitec.com` → **Create record**: name `jarjar`, type `A`, value = static IP, TTL 300.
- **Lightsail** → Domains & DNS → `edugamitec.com` → **Add record**: A record, subdomain `jarjar`, resolves to the static IP.
- Another provider (GoDaddy, Namecheap, …): same record in their DNS settings.

## 5. Wait, then claim the dashboard

The launch script installs Docker, builds jarjar and turns on [automatic updates](#updating), which takes about 5–10 minutes. To watch it, use **Connect using SSH** in Lightsail and run:

```bash
tail -f /var/log/jarjar-setup.log
```

When it finishes and DNS has updated, open **https://jarjar.edugamitec.com** and **create your account straight away**. Until the first account exists, anyone who opens the page can create it.

Then add your sites and paste each site's snippet into its pages.

## Updating

The server updates itself. Every 5 minutes it checks the `main` branch on GitHub. When there's a new commit whose checks (the CI workflow: type check, tests, build) have passed, the server builds it and switches over. If the new version doesn't build or start within 2 minutes, the server goes back to the previous one and skips that commit. The bottom of the dashboard's sidebar shows which version is running.

So to release a change, merge it into `main`. It's live 10–15 minutes later. Each update interrupts jarjar for a few seconds while its container restarts.

Over SSH:

| To | Run |
| --- | --- |
| See what the auto-update did | `journalctl -u jarjar-update -n 30` |
| Update right now, without waiting for the checks | `sudo /opt/jarjar/deploy/update.sh` |
| Turn auto-update off | `sudo systemctl disable --now jarjar-update.timer` |
| Turn it on again | `sudo /opt/jarjar/deploy/install-auto-update.sh` |

A server set up before auto-updates existed (following another branch) switches to `main` and turns them on with:

```bash
sudo git -C /opt/jarjar fetch origin main && sudo git -C /opt/jarjar checkout -f -B main FETCH_HEAD && sudo /opt/jarjar/deploy/install-auto-update.sh
```

## Troubleshooting

All commands over SSH:

| Problem | Check |
| --- | --- |
| Setup didn't finish | `cat /var/log/jarjar-setup.log` |
| Browser can't connect | Firewall has HTTPS (443); `getent hosts jarjar.edugamitec.com` returns the static IP |
| Certificate error | `cd /opt/jarjar/deploy && sudo docker compose logs caddy`. Caddy retries until DNS points at the server |
| Dashboard errors | `cd /opt/jarjar/deploy && sudo docker compose logs jarjar` |
| A merged change isn't live | `journalctl -u jarjar-update -n 30` says whether it's waiting for checks, they failed, or the build failed |
| Restart everything | `cd /opt/jarjar/deploy && sudo docker compose restart` |

Data lives in the Docker volume `deploy_jarjar-data`. Lightsail snapshots include it.
