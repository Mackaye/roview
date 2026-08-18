# Security policy

## Supported versions

Roview is pre-release software. Security fixes are made on the latest `main` revision only. Do not
use the prototype on a valuable place without a separate backup or source-control checkpoint.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. If that is unavailable, open
a minimal issue asking for a private maintainer contact without including exploit details, tokens,
source code, or private place data.

Include the affected revision, operating system, Studio version, reproduction steps, impact, and
whether a malicious proposal or local process is required. We aim to acknowledge reports within seven
days. Timelines for fixes and disclosure depend on severity and Roblox platform constraints.

## Security boundary

The companion binds to loopback, requires a high-entropy bearer token, persists data locally, and does
not provide telemetry or hosted sharing. Roview does not protect against an already-compromised
machine or malicious Studio plugin. Unknown operations, classes, properties, values, stale targets,
and mismatched proposal digests must fail closed.
