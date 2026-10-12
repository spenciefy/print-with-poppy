# Security

Do not commit `.env`, deployment credentials, provider keys, uploaded photos, databases, or account screenshots. The example environment file contains placeholders only. Configure secrets in your hosting provider's environment settings; never use `VITE_` variables for server secrets.

Run the example locally in demo mode. Before processing real orders, configure the provider accounts, trusted agent allowlist, persistent storage, backups, and monitoring described in README.md. Demo endpoints simulate payment and fulfillment and must never share live order storage.

Please report security issues through GitHub private vulnerability reporting when enabled. Do not include credentials or customer information in public issues.
