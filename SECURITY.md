# Security and privacy

Cha Waves is an experimental local-first application. The optional phone relay is intended for a trusted local network or a private HTTPS route. It is not a public multi-user recording service.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** option if private vulnerability reporting is enabled for this repository. If it is unavailable, open an issue asking the maintainer for a private reporting channel, without exploit details, keys or recordings. Do not post active pairing links or private capture files publicly.

Include the affected revision, component, impact and a minimal reproduction using synthetic data. The project has no guaranteed response time or long-term support policy; fixes target the current main branch.

## Operational boundaries

- The ordinary static preview disables microphone access. Phone capture requires the optional relay and an explicit recording action.
- Pairing secrets expire. QR codes and phone links grant session access; treat them as credentials.
- The owner API uses a separate loopback listener and private key file. Never expose that listener through Tailscale Serve, a reverse proxy or a public tunnel.
- Raw captures and owner archives remain private local artifacts. Browser-only reviews require explicit export; the relay does not back up those edits.
- Browser storage can be cleared or evicted. Keep exported copies of work you need to preserve.

See [relay setup](docs/PHONE_SATELLITE.md), [owner API](docs/ECHO_LOCAL_API.md) and [static deployment](docs/STATIC_DEPLOYMENT_AND_RECOVERY.md) for the implemented controls and deployment checks.
