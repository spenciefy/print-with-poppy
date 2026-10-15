# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/spenciefy/print-with-poppy/security/advisories/new). Do not post credentials, customer photos, private order links, or personal information in public issues or pull requests.

Run locally in demo mode. Before processing real orders, configure provider accounts, the trusted agent allowlist, persistent storage, backups, and monitoring as described in README.md. Demo endpoints simulate payment and fulfillment and must never share live order storage.

## Contributions and deployments

- Review untrusted changes before approving workflow runs, especially workflow files, package scripts, dependencies, and deployment configuration.
- CI runs on GitHub-hosted runners with a read-only token and no production secrets. Never use `pull_request_target` to execute contribution code or add Railway credentials to pull-request workflows.
- Keep Railway private and automatic PR environments disabled. Deploy only reviewed code from the protected main branch, or reviewed local source using an authorized operator account.
- Keep production credentials in the deployment provider. Do not expose them through `VITE_` variables, commit `.env` files, databases, uploads, or private keys, or copy production secrets into preview environments.
- Secret scanning and push protection are safeguards, not a guarantee. If a credential is exposed, revoke and replace it immediately; deleting it from Git history does not revoke it.
- Dependency updates require review and passing CI. Do not automatically merge security or dependency pull requests.
