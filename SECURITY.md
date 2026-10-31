# Security policy

## Supported versions

Purser is pre-1.0. Security fixes are made on the latest release line only.

## Reporting a vulnerability

Please **do not** open a public issue. Report the vulnerability privately through GitHub's private vulnerability reporting (the **Report a vulnerability** button on the repository's *Security* tab) with a description, the affected version and a minimal reproduction if possible. We aim to acknowledge reports within 5 working days.

## Scope

Purser runs at build time on your own source code, and it loads your tokens module with `import()`, which executes it. Relevant issues include:

- generated CSS that escapes its rule, for example a crafted value injecting declarations or rules (values containing `;`, `{` or `}` outside strings are rejected);
- the build reading or writing outside the configured project, source and output paths;
- the runtime (`css.create` / `css.props`) behaving unsafely with untrusted input.

Styles are meant to be static source code. Passing untrusted user input into `css.create` is not a supported use.
