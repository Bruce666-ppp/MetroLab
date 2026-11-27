# Hong Kong data and simulation

MetroLab 2.0 models a fictional railway network laid over present-day Hong Kong Island and Kowloon. The shoreline, buildings, roads and district boundaries describe the city at their source vintages. The population and employment control year is 2021. The 2022 travel survey calibrates the scale and timing of demand. The rail network starts empty.

## Sources and reuse

| Input | Release used | In-game use |
| --- | --- | --- |
| [Lands Department Building](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-landsd-building) | 19 November 2026 building outline release | Permanent building and structure footprints, base and top elevations, available storey counts and names. |
| [Lands Department Digital Terrain Model](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-5m-grid-dtm) | Published 5 m GeoTIFF grid | Relief, height, slope and road access weighting. The source contains some non-ground heights such as bridges. |
| [Lands Department Geographic Names](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-landsd-geographic-name) | CSDI point and name-table snapshot | Official Chinese and English names. The pipeline joins `GEO_NAME_ID`, prioritising official entries. |
| [OpenStreetMap via Geofabrik](https://download.geofabrik.de/asia/china/hong-kong/index.html) | Hong Kong extract `hong-kong-260101.osm.pbf` | Shoreline, streets, pedestrian links, green spaces, building-use signals, ferry piers and additional bilingual names. |
| [Census and Statistics Department 2021 Census](https://data.gov.hk/en-data/dataset/hk-censtatd-census_geo-2021-population-census-by-stpu) | 2021 small TPU groups | Enumerated population and matching statistical boundaries. |
| [Planning Department 2021-based TPEDM](https://www.pland.gov.hk/pland_en/resources/population_data/tpedm/2021.html) | 2021 baseline, published December 2024 | Official estimates of jobs by District Council District. Jobs can include both full- and part-time positions. |
| [Home Affairs Department district boundaries](https://data.gov.hk/en-data/dataset/hk-had-json1-hong-kong-administrative-boundaries) | Published bilingual geographic boundaries | District employment aggregation and the northern playable boundary. |
| [Transport Department Travel Characteristics Survey 2022](https://www.td.gov.hk/filemanager/en/content_5349/tcs2022_eng.pdf) | Final report, especially §3.3 and Table 3.4 | Weekday intraregional/cross-harbour mechanised trip totals, commute directions and morning/evening peak profiles. |
| [West and South Island Line cost reporting](https://www.legco.gov.hk/yr14-15/english/panels/tp/tp_rdp/papers/tp_rdpcb4-1222-e.pdf) | Legislative Council railway project update | Relative engineering cost benchmark for underground and mixed elevated/underground construction. |

The Government of the Hong Kong Special Administrative Region and the relevant organisations own the intellectual property rights in their data. Digital copies retain Government and source portal attribution. [CSDI terms of use](https://portal.csdi.gov.hk/csdi-webpage/doc/TNC) · [DATA.GOV.HK terms of use](https://data.gov.hk/en/terms-and-conditions)

© OpenStreetMap contributors. The processed OSM shoreline, road and pedestrian graph, land-use geometries and supplemental names are available with the source and preprocessing code under ODbL 1.0. Names in the compiled model retain a source column. Individual visual tiles store government building outlines and OSM roads in separate arrays. The application code uses the repository MIT licence. [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright) · [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)

## Observed inputs, estimates and game values

- **Published inputs.** The build contains 50,286 source building footprints, including 45,280 with height from the published top minus base elevation. Seventeen use published storey counts with a type-based floor height and 4,989 use explicitly modelled height from building type and footprint size. The latter two use the source footprints. Modern terrain and building imagery can differ from the geography during the 2021 Census.
- **Control totals.** The 105 included Census small TPU groups contain **3,346,352 residents**. The 2021 TPEDM baseline supplies **2,446,550 estimated jobs** across the nine playable administrative districts. Group 174 has 79,727 residents and falls on Ap Lei Chau, which appears for context on the map. Its population is excluded from the simulation. The Southern District jobs total is distributed across the district's playable land because the published table aggregates the whole district.
- **Spatial estimates.** 250 m cells share official population controls by Census group and employment controls by district. Integer largest-remainder allocation retains the input totals exactly. Weights come from footprints, floor heights, land use and named facilities. Mixed or unclassified footprints receive documented weights in the builder. Schools, clinics, retail, public venues and parks contribute attraction estimates. Daytime and night-time presence derive from the balance of modelled departures and returns.
- **Simulation parameters.** The starting HKD 38 billion, unit rates, 250 m minimum curve radius, train capacity, headways, station sizes, fares, time distributions, mode-choice parameters and site constraints are gameplay assumptions. Costs use measured alignment length and sampled terrain, water and built footprint occupancy. Underground is the harbour-crossing method. Surface methods test grade and occupied land. The game treats tunnel depth, geology, property acquisition, gradients on ramps and engineering approvals as outside its physical model.

## Demand and operations

The model estimates the origin and destination matrix with 105 zones and five trip purposes. A gravity weight combines Census residents, destination activity and estimated travel time. The weekday market controls are 1.909 million trips within Hong Kong Island, 2.393 million within Kowloon and 1.970 million between them. These are survey totals for mechanised trips. The game uses them as the size of the weekday market in a scenario where the rail network starts empty, including trips that shift to other modes. A small-area observed OD matrix and actual work, school or shopping pairing data are outside the public release used here. The model reverses outbound flows over the day, applies separate weekend schedules and retains local trips within a zone. It does not model trips with one endpoint outside the scenario.

Station access follows walkable OSM links and short on-land connectors with steps and grade penalties. The base 600 m walking budget grows to 700 and 800 m at higher station levels. Each cell is attributed to its shortest accessible station in the relevant network, so overlapping catchments share the same residents and jobs. The pathfinder compares rail alternatives with estimated walking, road and ferry travel. Crossing modes use modelled travel times and ferry terminal access, without a bus timetable or ferry schedule. Railway costs combine walking, headway, onboard time, transfers, load and fare. Boarding and station queues apply capacity constraints. A journey that cannot use rail falls back to another mode. A completed rail journey earns the fares quoted for the legs it uses, including any transfer. Peak crowding is the highest observed occupied share on departures in the morning and evening modelled peak periods.

Tracks, stations and fleets incur operating expenses. Energy and running costs depend on simulated train-kilometres. Crew and track maintenance, base station expenses and standby costs accrue with the game clock. Figures in the daily panels are day-to-date. Daily counters roll over at midnight. The demand overlay shows anticipated departures per five minutes and the selected area's strongest modelled destination flows. Passenger flow shows counted rail boardings and station activity.

## Rebuild the published assets

The bundle ships with the app. Core gameplay accesses static files on the same host. It needs no key or external web map service. The preprocessing script uses a raw input cache and records SHA-256 hashes in [`sources.json`](../public/data/hong-kong/sources.json). Public service endpoints for names and updated government layers may return later revisions. Retain the original input cache when reproducing a particular capture.

```shell
python -m pip install -r tools/requirements-hong-kong.txt
python tools/build_hong_kong.py --cache ../metrolab-hong-kong-sources
```

The builder reads the downloaded ZIP, GeoJSON, PBF and PDF files. It projects geometry to Hong Kong 1980 Grid, EPSG:2326. World units are 10 projected metres. It records the model in [`model.json`](../public/data/hong-kong/model.json), samples the 5 m source terrain to 40 m for engineering, and produces a 15 m shaded relief and 3 km vector tiles for the visible map. Geographic features outside the scenario appear as map context. Levels of detail limit the roads, footprints and labels drawn at each scale. The browser runs Hong Kong passenger simulation in a module worker during normal play.
