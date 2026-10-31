# Contributing to Grid Browser

Grid is in an early browser experiment stage. Read [PLAN.md](./PLAN.md) for the product goal and [README.md](./README.md) for what currently runs.

For bugs, include the operating system, reproduction steps, expected and observed behavior, and whether the issue is in the WebKit probe, search prototype, or Chromium build experiment. For design proposals, start with the user task that would improve and how to measure it. Do not include browsing history, credentials, private page content, or participant recordings in public issues.

Before a pull request, run:

```sh
swift test
node --check prototypes/search-lab/app.js
```

Keep changes scoped to a user task or a documented engineering gate. Mark recorded search data and simulated states clearly; do not report them as live search or completed AI behavior. Chromium source and build artifacts are not committed to this repository. See [SECURITY.md](./SECURITY.md) for security reports.
