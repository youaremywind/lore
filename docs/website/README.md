# LoreHub website docs

This directory is the source of truth for the public LoreHub documentation.

- `manifest.json` defines the navigation tree, page metadata, and the default `/documents` page.
- `content/documents/**/*.mdx` contains one MDX file per documentation page.
- LoreHub copies this directory during its build step and generates its local MDX registry from it.

Keep public docs usage-focused: installation, core concepts, recall, Dream, Web Console, configuration, daily playbooks, and troubleshooting. Avoid internal code structure, database schema, or implementation-only notes here.
