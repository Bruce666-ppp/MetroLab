# MetroLab development guide

MetroLab is an original urban rail planning game. Preserve its construction and operations loop, bilingual interface and static hosting model. Hong Kong is the default city. Retain Marlow as a compatible scenario for existing saves.

## Architecture

- Use React, TypeScript and Vite. Render Hong Kong's static cartography on Canvas and survey-aligned rail overlays in SVG. Keep the simulation functional and independent of the UI.
- Make network edits through `applyAction`. It validates geography, topology and budget and returns an atomic result. Use `advanceGame` for deterministic clock changes.
- Keep simulated trip generation, route choices, queues, train movement, arrivals and fare accounting causally linked. Add explicit simulation inputs when new metrics need them.
- Keep geographic crossings distinct from stations shared by lines. Require an interchange for passenger transfers.
- Store each line's ordered station-to-station sections as persistent straight and circular pieces. Use those pieces for the SVG, track length, terrain cost, snapping, speed profiles and passenger routing. Keep all engineering in planimetric coordinates at 10 meters per world unit. The city renderer displaces roofs and facades above this plane.
- Keep the minimum new curve radius and the game speed and acceleration parameters in ENGINEERING in track.ts. Validate new and rebuilt sections, including connections to existing tangents. Preserve confirmed sections when extending a line. Render legacy corners with an engineering warning.
- Add save migrations when stored values change. Keep active operations, queues and player-defined names intact. Schema 4 imports Marlow schemas 1–3. The original octilinear alignment and legacy running profile are retained when migrating schema 1 or 2.
- Use English for source identifiers, comments, filenames and commit messages.

## Map and interface

- In Hong Kong, Draw line starts a provisional plan from any playable geographic point. Ordinary clicks add track control points. Shift-click and explicit station placement add stops. Track may be confirmed before stops are added when the alignment ends on land. An underground alignment can cross water between its ends. Offer extensions from eligible terminals and preserve the draft, camera and custom names across locale changes. Charge for construction only after the player confirms the plan.
- Build station places a standalone stop on land and snaps to an alignment on track. Split occupied sections without moving active trains or dropping their passengers. Ask the player which lines to stop on when more than one alignment matches.
- Keep Hong Kong source provenance, official control totals, public data terms and model assumptions documented in `docs/HONG-KONG-DATA.md`. Derive its cartography and activity grids from source geography. Keep the rail overlay above the extruded city and let players choose their own routes and station locations.

Keep the map central. Use muted district and infrastructure colors, clear rail overlays and behavior tied to existing map tools. Preserve keyboard and pointer access and verify narrow-screen layouts. Add every user-visible string to both `src/locales/en.json` and `src/locales/zh-HK.json`. Use localized number and date formatting where appropriate. Use original game assets and retain dependency and geographic data notices.

## Checks and delivery

- Run `npm ci`, `npm test` and `npm run build` before publishing stable changes. Add engine regression coverage for path selection, passenger conservation, finance, time, settings or save changes when needed.
- Serve `npm run preview` and run `npm run test:browser` for interaction changes. Check real construction, operations, session restoration and both locales. Refresh README screenshots from the game when visuals change.
- Use `main` and the GitHub remote `https://github.com/Bruce666-ppp/MetroLab.git`. Group related changes into a tested commit, push and verify the same commit's Pages workflow and public game page.
- Preserve unrelated files and remote history. Use the Vite base path `/MetroLab/`. Keep local saves, credentials, dependencies, build output and test scratch files out of commits.
- Keep `README.md`, `README.zh-HK.md`, `docs/HONG-KONG-DATA.md` and `CHANGELOG.md` aligned with shipped behavior. If GitHub access prevents publication, retain the tested local commit and report the failing step.
