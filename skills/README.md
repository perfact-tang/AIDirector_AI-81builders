# Project Skills

This directory contains the `direct-h3-storyboards` Skill required for script and storyboard generation. Its instructions, references, template, agent metadata, validator and validator tests are included together so a fresh clone can run without the original author's personal Skills directory.

## Install in this project

```sh
npm run skills:install
npm run skills:verify
```

The installer copies the bundled files into `.local/skills/direct-h3-storyboards/`. It makes no network requests and does not modify globally installed Skills. Re-run it after updating the bundled Skill. The installed copy is ignored by Git; the source in this directory is version controlled.

The backend resolves the Skill in this order:

1. `DIRECTOR_SKILL_PATH`, if configured in `.env` (relative paths resolve from the repository root).
2. The project-local installation in `.local/skills/direct-h3-storyboards/`.
3. The bundled source in `skills/direct-h3-storyboards/`.

It reads the Skill into the model's system context and executes the application JSON validator (`validate_app_project.mjs`). `aiand run` does not need to discover or install the Skill separately.

## Contents

- [`SKILL.md`](direct-h3-storyboards/SKILL.md): directing workflow and output constraints.
- `references/`: visual consistency, character sheets, H3 routing and JSON schema.
- `assets/storyboard-template.json`: the project template.
- `scripts/validate_storyboard.mjs`: generated-project validation.
- `scripts/test_validate.mjs`: validator regression tests.
- `agents/openai.yaml`: metadata for compatible agent hosts.

The original Skill is written in Chinese and intentionally asks for Chinese production prompts while preserving the language of dialogue, names and lyrics. UI language selection does not rewrite those instructions or translate project content.

The current application contract follows the form: three visual styles, fixed 5/10-second shots, manually uploaded character images, Edge TTS and ai& MiniMax H3. It does not require Qwen voice creation, music chapters or image generation services. Legacy full MV Maker references and validation scripts remain available for external use and are excluded from the application's model context.

`character_id` identifies a person; each shot's ordered `character_refs` identifies its reference images. The shared `scripts/project_contract.mjs` computes shot duration, frame count and timeline and validates identities and references. The application template is `assets/app-project-template.json`; `assets/storyboard-template.json` remains the legacy template. Imported older projects without explicit references continue using name matching.

Run the bundled validator tests with `npm run test:skills`. To validate an exported project manually:

```sh
node skills/direct-h3-storyboards/scripts/validate_app_project.mjs /path/to/project.json
```
