# MetroLab development guide

MetroLab is an original urban rail planning game. Preserve its complete construction and operations loop, bilingual interface and static hosting model. The primary city is Marlow.

## Architecture

- Use React, TypeScript and Vite with SVG cartography. Keep the simulation functional and independent of the UI.
- Make network edits through `applyAction`. It validates geography, topology and budget and returns an atomic result. Use `advanceGame` for deterministic clock changes.
- Keep simulated trip generation, route choices, queues, train movement, arrivals and fare accounting causally linked. Add explicit simulation inputs when new metrics need them.
- Keep geographic crossings distinct from stations shared by lines. Require an interchange for passenger transfers.
- Add save migrations when stored values change. Keep active operations, queues and player-defined names intact.
- Use English for source identifiers, comments, filenames and commit messages.

## Map and interface

Keep the map central. Use muted district and infrastructure colors, clear rail overlays and behavior tied to existing map tools. Preserve keyboard and pointer access and verify narrow-screen layouts. Add every user-visible string to both `src/locales/en.json` and `src/locales/zh-CN.json`. Use localized number and date formatting where appropriate. Use original game assets and retain dependency license notices.

## Checks and delivery

- Run `npm ci`, `npm test` and `npm run build` before publishing stable changes. Add engine regression coverage for path selection, passenger conservation, finance, time, settings or save changes when needed.
- Serve `npm run preview` and run `npm run test:browser` for interaction changes. Check real construction, operations, session restoration and both locales. Refresh README screenshots from the game when visuals change.
- Use `main` and the GitHub remote `https://github.com/Bruce666-ppp/MetroLab.git`. Group related changes into a tested commit, push and verify the same commit's Pages workflow and public game page.
- Preserve unrelated files and remote history. Use the Vite base path `/MetroLab/`. Keep local saves, credentials, dependencies, build output and test scratch files out of commits.
- Keep `README.md`, `README.zh-CN.md` and `CHANGELOG.md` aligned with shipped behavior. If GitHub access prevents publication, retain the tested local commit and report the failing step.
