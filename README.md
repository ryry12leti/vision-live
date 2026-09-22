# vision-live

This repository contains **generated deployment output only** — the
security-reviewed, publicly-servable `dist/` build produced by
[`ryry12leti/vision-`](https://github.com/ryry12leti/vision-) (private).

**This repository is not the source of truth.** No application source
code, build tooling, QA gates, or internal documentation lives here — only
the static HTML/CSS/JS/asset files that are safe and intended to be
served publicly, exactly as assembled by that private repository's own
`scripts/build-public.cjs` publication manifest (an explicit allowlist of
files, plus an automated secret/credential/forbidden-project scan that
must pass before anything is published here).

- **Source of truth:** `ryry12leti/vision-` (private)
- **Hosting:** GitHub Pages, served from this repository
- **Why a separate public repository:** GitHub Pages requires either a
  public repository or a paid plan to publish from a private one. Rather
  than make the private source repository public, only its already-public
  build *output* is published here — the same content model as any other
  static-hosting deploy target, just using a second repository as the
  artifact store instead of a hosting provider's own storage.
- **Build/update process:** manual publish of a reviewed `dist/` build
  from the private repository (see that repository's own
  `scripts/github-pages-live-baseline-v1/` mission record for the exact
  provenance of each publish, including git SHA, build manifest hash, and
  security-scan result).

Do not open pull requests against this repository expecting them to
change application behavior — edit the private source repository instead.
