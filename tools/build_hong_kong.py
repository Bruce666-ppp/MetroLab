"""Build the static Hong Kong scenario from public, cached geographic inputs."""

import argparse
import base64
import csv
import hashlib
import json
import math
import re
import shutil
import zipfile
from collections import Counter, defaultdict
from io import TextIOWrapper
from pathlib import Path

import ijson
import numpy as np
import osmium
import rasterio
import requests
from opencc import OpenCC
from PIL import Image
from pypdf import PdfReader
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from shapely import STRtree, make_valid, prepare, transform as transform_geometry
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parents[1]
CSDI = 'https://portal.csdi.gov.hk/server/rest/services/common'
NAMES = f'{CSDI}/landsd_rcd_1648571595120_89752/FeatureServer'
WEST, SOUTH, EAST, NORTH = 828000, 807000, 846000, 825000
CELL, TILE, SURVEY_GRID = 250, 3000, 40
BOUNDS = box(WEST, SOUTH, EAST, NORTH)
PROJECT = Transformer.from_crs(4326, 2326, always_xy=True).transform
TRADITIONAL = OpenCC('s2hk').convert
SOURCES = {
    'hong-kong-260101.osm.pbf': 'https://download.geofabrik.de/asia/china/hong-kong-260101.osm.pbf',
    'buildings.geojson': 'https://static.csdi.gov.hk/csdi-webpage/download/51d63757e2675874af80eef94afb6a35/geojson',
    'dtm.zip': 'https://static.csdi.gov.hk/csdi-webpage/download/common/e9a836d098a3a9ccf55a7f61f69a93e71923c722fb94ddf7b36be83a67b99140',
    'stpu-census.zip': 'https://www.census2021.gov.hk/doc/STPUG_21C.zip',
    'stpu.json': f'{CSDI}/censtatd_rcd_1635933193720_58660/FeatureServer/0/query?f=geojson&where=1%3D1&outFields=*&outSR=2326&geometryPrecision=1',
    'districts.json': 'https://www.had.gov.hk/psi/hong-kong-administrative-boundaries/hksar_18_district_boundary.json',
    'tpedm-2021.pdf': 'https://www.pland.gov.hk/file/resources/population_data/tpedm/2021/2021-based_TPEDM.pdf',
}

COUNCILS = {
    'A': ('Central and Western', '中西區'), 'B': ('Wan Chai', '灣仔區'),
    'C': ('Eastern', '東區'), 'D': ('Southern', '南區'), 'E': ('Yau Tsim Mong', '油尖旺區'),
    'F': ('Sham Shui Po', '深水埗區'), 'G': ('Kowloon City', '九龍城區'),
    'H': ('Wong Tai Sin', '黃大仙區'), 'J': ('Kwun Tong', '觀塘區'),
}
ROADS = {
    'motorway': 0, 'trunk': 0, 'motorway_link': 0, 'trunk_link': 0, 'primary': 0, 'primary_link': 0,
    'secondary': 1, 'secondary_link': 1, 'tertiary': 1, 'tertiary_link': 1,
    'residential': 2, 'unclassified': 2, 'living_street': 2, 'service': 2, 'pedestrian': 2,
    'track': 3, 'path': 3, 'footway': 3, 'steps': 3, 'cycleway': 3,
}
RESIDENTIAL, OFFICE, SHOP, INDUSTRY, SCHOOL, HEALTH, OTHER = range(7)


def fetch(directory, name, url):
    target = directory / name
    if target.exists():
        return target
    print('Download', name, flush=True)
    for attempt in range(3):
        try:
            with requests.get(url, stream=True, timeout=(25, 100)) as response:
                response.raise_for_status()
                temp = target.with_suffix('.partial')
                with temp.open('wb') as output:
                    for block in response.iter_content(chunk_size=1024 * 256):
                        output.write(block)
                temp.replace(target)
            return target
        except requests.RequestException:
            if attempt == 2:
                raise


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def project_geometry(geometry):
    return transform_geometry(geometry, PROJECT, interleaved=False)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')


def point(x, y, precision=1):
    return [round((x - WEST) / 10, precision), round((NORTH - y) / 10, precision)]


def rings(poly):
    return [flat(ring.coords) for ring in [poly.exterior, *poly.interiors]]


def flat(coords):
    return [value for x, y, *_ in coords for value in point(x, y)]


def parts(geometry, kind):
    if geometry.is_empty:
        return
    if geometry.geom_type == kind:
        yield geometry
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from parts(part, kind)


def labels(tags):
    name = tags.get('name', '')
    en = tags.get('name:en') or (name if not re.search(r'[\u3400-\u9fff]', name) else '')
    zh = tags.get('name:zh-Hant') or tags.get('name:zh-HK') or tags.get('name:zh') or name
    if en and re.search('[A-Za-z]', en) and not re.search(r'[\u3400-\u9fff]', en) and re.search(r'[\u3400-\u9fff]', zh):
        return [en.strip(), TRADITIONAL(zh.strip())]


def use(tags):
    values = {tags.get(key) for key in ('building', 'building:use', 'landuse', 'amenity')}
    if values & {'school', 'kindergarten', 'college', 'university', 'dormitory'}:
        return SCHOOL
    if values & {'hospital', 'clinic', 'doctors'} or tags.get('healthcare'):
        return HEALTH
    if values & {'residential', 'apartments', 'house', 'detached', 'terrace', 'semidetached_house'}:
        return RESIDENTIAL
    if values & {'office', 'commercial'} or tags.get('office'):
        return OFFICE
    if values & {'retail', 'marketplace', 'supermarket'} or tags.get('shop'):
        return SHOP
    if values & {'industrial', 'warehouse', 'manufacture'}:
        return INDUSTRY
    if values & {'public', 'civic', 'government', 'stadium', 'sports_centre', 'library', 'place_of_worship', 'hotel'}:
        return OTHER
    return None


def named_use(name):
    for category, expression in [
        (SCHOOL, r'\bschool\b|college|university|kindergarten'),
        (HEALTH, r'hospital|clinic|health cent'),
        (RESIDENTIAL, r'\bestate\b|apartments|mansion|residen|garden|\bcourt\b|\bvilla'),
        (SHOP, r'shopping|\bmall\b|\bmarket\b|arcade'),
        (INDUSTRY, r'industrial|warehouse|godown|factory'),
        (OFFICE, r'office|finance|exchange|commercial|business'),
        (OTHER, r'government|library|museum|hotel|stadium|\bclub\b|sports cent'),
    ]:
        if re.search(expression, name, re.I):
            return category


def label_kind(tags):
    if tags.get('place') in ('suburb', 'quarter', 'neighbourhood', 'village', 'hamlet'):
        return 'district' if tags.get('place') == 'suburb' else 'area'
    if tags.get('amenity') in ('school', 'university', 'college', 'hospital', 'library', 'townhall', 'ferry_terminal') or tags.get('tourism') in ('museum', 'attraction', 'theme_park') or tags.get('shop') == 'mall' or tags.get('leisure') in ('park', 'stadium'):
        return 'facility'
    if tags.get('landuse') == 'residential' or tags.get('building') == 'apartments':
        return 'estate'
    if tags.get('highway') in ROADS and ROADS[tags['highway']] < 3:
        return 'street'


class OpenMap(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.coast, self.roads, self.walkways, self.parks, self.uses = [], [], [], [], []
        self.names, self.piers = [], []

    def add_name(self, tags, xy, kind=None):
        kind = kind or label_kind(tags)
        names = labels(tags) if kind else None
        if names and BOUNDS.covers(Point(xy)):
            self.names.append((xy, *names, kind))
        if tags.get('amenity') == 'ferry_terminal' and BOUNDS.covers(Point(xy)):
            self.piers.append(xy)

    def node(self, node):
        tags = dict(node.tags)
        if tags.get('name') and label_kind(tags) or tags.get('amenity') == 'ferry_terminal':
            self.add_name(tags, PROJECT(node.location.lon, node.location.lat))

    def way(self, way):
        tags = dict(way.tags)
        highway = tags.get('highway')
        coastal = tags.get('natural') == 'coastline'
        if not coastal and highway not in ROADS or not all(node.location.valid() for node in way.nodes):
            return
        coords = [PROJECT(node.lon, node.lat) for node in way.nodes]
        if len(coords) < 2:
            return
        line = LineString(coords)
        if not line.intersects(BOUNDS):
            return
        if coastal:
            self.coast.append(line.intersection(BOUNDS))
        if highway not in ROADS:
            return
        layer = 1 if tags.get('bridge') not in (None, 'no') else -1 if tags.get('tunnel') not in (None, 'no') else 0
        level = ROADS[highway]
        self.roads.append((line, level, layer))
        if line.length > 110:
            self.add_name(tags, line.interpolate(0.5, normalized=True).coords[0], 'street' if level < 3 else None)
        if tags.get('foot') in ('yes', 'designated', 'permissive') or (
            highway not in ('motorway', 'motorway_link', 'trunk', 'trunk_link')
            and tags.get('foot') not in ('no', 'private', 'use_sidepath') and tags.get('access') not in ('no', 'private')
            and (layer >= 0 or highway in ('footway', 'path', 'steps', 'pedestrian'))
        ):
            self.walkways.append(([(node.ref, *xy) for node, xy in zip(way.nodes, coords)], highway == 'steps', layer))

    def area(self, area):
        tags = dict(area.tags)
        landuse = use(tags)
        green = tags.get('leisure') in ('park', 'garden', 'nature_reserve', 'recreation_ground', 'pitch') or tags.get('boundary') in ('protected_area', 'national_park') or tags.get('natural') in ('wood', 'scrub', 'grassland') or tags.get('landuse') in ('forest', 'grass', 'recreation_ground', 'cemetery')
        kind = label_kind(tags)
        if landuse is None and not green and not kind:
            return
        for outer in area.outer_rings():
            coordinates = [(node.lon, node.lat) for node in outer if node.location.valid()]
            if len(coordinates) < 4:
                continue
            geo = shape({'type': 'Polygon', 'coordinates': [coordinates, *[
                [(node.lon, node.lat) for node in hole if node.location.valid()] for hole in area.inner_rings(outer)
            ]]})
            polygon = make_valid(project_geometry(geo)).intersection(BOUNDS)
            if polygon.is_empty:
                continue
            if landuse is not None:
                self.uses.append((polygon, landuse))
            if green:
                self.parks.append((polygon, 1 if tags.get('leisure') in ('park', 'garden', 'pitch') else 0))
            self.add_name(tags, polygon.representative_point().coords[0], kind)


def coastline(osm, councils):
    polygons = list(polygonize(unary_union([BOUNDS.boundary, *osm.coast])))
    island_seed = Point(PROJECT(114.162, 22.263))
    peninsula_seed = Point(PROJECT(114.180, 22.324))
    island = next(poly for poly in polygons if poly.covers(island_seed))
    peninsula = next(poly for poly in polygons if poly.covers(peninsula_seed))
    if island == peninsula or max(island.area, peninsula.area) > BOUNDS.area * 0.52:
        raise ValueError('The OSM shoreline failed to separate Hong Kong Island and Kowloon.')
    ap_lei_chau = Point(PROJECT(114.151, 22.242))
    nearby = [poly for poly in polygons if poly.covers(ap_lei_chau)]
    full = unary_union([island, peninsula, *nearby])
    playable = unary_union([island.intersection(unary_union([councils[key] for key in 'ABCD']).buffer(25)),
                            peninsula.intersection(unary_union([councils[key] for key in 'EFGHJ']).buffer(25))])
    return full, playable, island


def census_data(cache, land):
    with zipfile.ZipFile(cache / 'stpu-census.zip') as archive:
        rows = list(csv.reader(TextIOWrapper(archive.open(archive.namelist()[0]), encoding='utf-8-sig')))
    counts = {row[0]: int(row[3].replace(',', '')) for row in rows[5:] if row[0] and row[3].replace(',', '').isdigit()}
    geo = read_json(cache / 'stpu.json')['features']
    selected = sorted((feature for feature in geo if feature['properties']['stpug'][0] in '12'), key=lambda f: f['properties']['stpug'])
    result = []
    for feature in selected:
        code = feature['properties']['stpug']
        polygon = make_valid(shape(feature['geometry']))
        if polygon.intersection(land).area >= 1_000:
            result.append((code, counts[code], polygon))
        else:
            print('Outside playable Census scope:', code, counts[code], flush=True)
    return result


def employment(path):
    text = PdfReader(path).pages[0].extract_text()
    return {key: int(re.search(r'\b' + name.upper() + r'\s+([\d ]+?)\s{2,}([\d ]+?)\s{2,}', text)[2].replace(' ', ''))
            for key, (name, _) in COUNCILS.items()}


def official_names(cache, playable):
    result = []
    prepare(playable)
    params = '&orderByFields=OBJECTID&resultRecordCount=3000&resultOffset='
    def query(layer, filename, fields):
        for offset in range(0, 30000, 3000):
            url = f'{NAMES}/{layer}/query?f=json&where=1%3D1&outSR=2326&outFields={fields}' + params + str(offset)
            page = read_json(fetch(cache, f'{filename}-{offset}.json', url))
            features = page['features']
            yield from features
            if not page.get('exceededTransferLimit', False) or not features:
                break
    names = {}
    for feature in query(1000, 'csdi-name-table', 'GEO_NAME_ID,NAME_EN,NAME_TC,NAME_STATUS'):
        attrs = feature['attributes']
        if attrs['NAME_EN'] and attrs['NAME_TC'] and (attrs['GEO_NAME_ID'] not in names or attrs['NAME_STATUS'] == 'Official'):
            names[attrs['GEO_NAME_ID']] = (attrs['NAME_EN'].strip(), attrs['NAME_TC'].strip())
    for feature in query(0, 'csdi-name-points', 'GEO_NAME_ID,PLACE_CLASS,PLACE_TYPE'):
        attrs = feature['attributes']
        pair = names.get(attrs['GEO_NAME_ID'])
        location = feature.get('geometry', {})
        if not pair or not location:
            continue
        xy = (location['x'], location['y'])
        if not playable.covers(Point(xy)):
            continue
        kind = 'area' if attrs['PLACE_CLASS'] == 'Settlement' or attrs['PLACE_TYPE'] in (
            'Built-up Area', 'Area', 'District', 'Locality', 'Village', 'Urban Area', 'Residential Area') else 'landmark'
        result.append((xy, *pair, kind))
    return result


def building_features(path):
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            name = next(name for name in archive.namelist() if name.lower().endswith('_building_converted.geojson'))
            with archive.open(name) as data:
                yield from ijson.items(data, 'features.item', use_float=True)
    else:
        with path.open('rb') as data:
            yield from ijson.items(data, 'features.item', use_float=True)


def terrain(cache, meters):
    count = (EAST - WEST) // meters
    out = np.zeros((count, count), dtype='float32')
    raster = cache / 'terrain.tif'
    if not raster.exists():
        with zipfile.ZipFile(cache / 'dtm.zip') as archive:
            name = next(name for name in archive.namelist() if name.lower().endswith(('.tiff', '.tif')))
            with archive.open(name) as raw, raster.with_suffix('.partial').open('wb') as extracted:
                shutil.copyfileobj(raw, extracted, length=1024 * 1024)
        raster.with_suffix('.partial').replace(raster)
    with rasterio.open(raster) as dem:
        reproject(rasterio.band(dem, 1), out, src_crs=dem.crs or 'EPSG:2326', dst_crs='EPSG:2326',
                  dst_transform=from_origin(WEST, NORTH, meters, meters), resampling=Resampling.bilinear)
    return np.clip(np.nan_to_num(out, nan=0), 0, 650)


def save_relief(cache, root, land):
    meters = 15
    heights = terrain(cache, meters)
    dx, dy = np.gradient(heights, meters)
    shade = np.clip((dx * 0.7 - dy * 0.45) * 55, -22, 19)
    upland = np.minimum(1, heights / 420)
    contour = (np.mod(heights, 40) < np.clip(np.hypot(dx, dy) * 9, 0, 5)) * (heights > 55) * 8
    mask = rasterize([(land, 255)], heights.shape, transform=from_origin(WEST, NORTH, meters, meters))
    channels = [np.clip(base - loss * upland + shade - contour, 0, 255) for base, loss in [(232, 58), (231, 40), (210, 55)]]
    Image.fromarray(np.stack([*channels, mask], axis=-1).astype('uint8')).save(root / 'relief.png', optimize=True)


def encoded(array):
    return base64.b64encode(array.tobytes()).decode('ascii')


def grid_key(x, y, step):
    return (int((x - WEST) // step), int((NORTH - y) // step))


def graph(osm, playable, elevations):
    seen = Counter(node[0] for path, _, _ in osm.walkways for node in path)
    nodes, ids, links = [], {}, {}
    count = len(elevations)
    def height(x, y):
        ix, iy = grid_key(x, y, SURVEY_GRID)
        return elevations[iy, ix] if 0 <= ix < count and 0 <= iy < count else 0
    def node_index(node):
        if node[0] not in ids:
            ids[node[0]] = len(nodes)
            nodes.append(point(*node[1:]))
        return ids[node[0]]
    for path, steps, layer in osm.walkways:
        last = None
        length = 0
        for i, node in enumerate(path):
            _, x, y = node
            inside = playable.covers(Point(x, y))
            if not inside and layer <= 0:
                last, length = None, 0
                continue
            if last is not None:
                _, px, py = path[i - 1]
                gap = math.hypot(x - px, y - py)
                length += gap * (1.4 if steps else 1) + (abs(height(x, y) - height(px, py)) * 1.1 if layer == 0 else 0)
                if seen[node[0]] < 2 and length < 65 and i < len(path) - 1:
                    continue
                a, b = sorted((node_index(last), node_index(node)))
                if a != b and length > 0:
                    links[a, b] = min(links.get((a, b), math.inf), length)
            last, length = node, 0
    return nodes, [(a, b, min(65535, max(1, round(float(length))))) for (a, b), length in sorted(links.items())]


def allocate(total, candidates, property):
    scale = sum(item[property] for _, item in candidates)
    if not scale:
        raise ValueError(f'Missing {property} weights for {total} people or jobs')
    quotas = [(key, item[property] * total / scale) for key, item in candidates]
    counts = {key: math.floor(value) for key, value in quotas}
    for key, _ in sorted(quotas, key=lambda pair: (-(pair[1] - math.floor(pair[1])), pair[0]))[:total - sum(counts.values())]:
        counts[key] += 1
    return counts


def data_index(census, councils, osm, official, land, cache, output, elevations):
    census_polygons = [item[2] for item in census]
    council_ids = list(councils)
    council_polygons = [councils[key] for key in council_ids]
    land_uses = [area for area, _ in osm.uses]
    census_tree, council_tree, uses_tree = map(STRtree, [census_polygons, council_polygons, land_uses])
    cells = defaultdict(lambda: np.zeros(10))
    tiles = defaultdict(lambda: {'buildings': [], 'roads': []})
    footprints = []
    heights = Counter()
    names_extent = land.buffer(75)
    prepare(land)
    prepare(names_extent)
    name_list = [entry for entry in osm.names if names_extent.covers(Point(entry[0]))]

    def record(location):
        x, y = location.coords[0]
        gc, gr = grid_key(x, y, CELL)
        tpu = next(iter(census_tree.query(location, predicate='within')), None)
        dcd = next(iter(council_tree.query(location, predicate='within')), None)
        if tpu is None:
            tpu = census_tree.nearest(location)
        if dcd is None:
            dcd = council_tree.nearest(location)
        return cells[gc, gr, int(tpu), int(dcd)]

    def usage(location, name):
        known = named_use(name)
        if known is not None:
            return known
        matches = uses_tree.query(location, predicate='within')
        return osm.uses[min(matches, key=lambda i: land_uses[i].area)][1] if len(matches) else OTHER

    for feature in building_features(cache / 'buildings.geojson'):
        if not feature['geometry']:
            continue
        data = feature['properties']
        if data.get('Status') not in (None, 'Active'):
            continue
        geometry = shape(feature['geometry'])
        if geometry.bounds and geometry.bounds[0] < 200:
            geometry = project_geometry(geometry)
        if not BOUNDS.intersects(geometry):
            continue
        for building in parts(make_valid(geometry), 'Polygon'):
            if building.area < 12:
                continue
            location = building.representative_point()
            if not land.covers(location):
                continue
            x, y = location.coords[0]
            top, ground = data.get('TopHeight'), data.get('BaseHeight')
            name = data.get('BuildingNameEN') or ''
            local = data.get('BuildingNameTC') or ''
            category = usage(location, name)
            measured = top - ground if top is not None and ground is not None else 0
            floors = max(1, data.get('Storeys') or 0) if data.get('Storeys') else 0
            if 1.5 <= measured <= 500:
                height = measured
                heights['surveyed'] += 1
            elif floors:
                height = floors * (3.8 if category in (OFFICE, SHOP) else 3.2)
                heights['storeys'] += 1
            else:
                height = (12, 18, 11, 9, 13, 16, 9)[category] if building.area >= 70 else 4
                heights['estimated'] += 1
            if name and local and category in (SCHOOL, HEALTH, SHOP):
                if name.lower().find('block') == -1:
                    official.append(((x, y), name, local, 'facility'))
            area = building.area
            floor_area = area * (floors or max(1, round(height / (3.8 if category in (OFFICE, SHOP) else 3.2))))
            weights = record(location)
            weights[0] += floor_area * (1, .012, .035, .003, .012, .008, .40)[category]
            weights[1] += floor_area * (.12, 1, .90, .65, .50, .78, .38)[category]
            weights[2] += floor_area * (0, 0, 0, 0, .095, 0, 0)[category]
            weights[3] += floor_area * (.002, .018, .075, .002, .002, .004, .012)[category]
            weights[4] += floor_area * (.0005, .002, .0005, 0, 0, .085, .001)[category]
            weights[5] += floor_area * (.002, .003, .018, 0, .002, .001, .020)[category]
            weights[6:9] += [x * floor_area, y * floor_area, floor_area]
            weights[9] += area
            footprints.append(building)
            simple = building.simplify(.65, preserve_topology=True)
            tiles[grid_key(x, y, TILE)]['buildings'].append([round(height, 1), category, rings(simple)])

    for polygon, green_type in osm.parks:
        location = polygon.intersection(land).representative_point()
        if not location.is_empty:
            record(location)[5] += min(1800, polygon.area / (60 if green_type else 260))

    road_extent = land.buffer(34)
    prepare(road_extent)
    for line, grade, level in osm.roads:
        if not road_extent.intersects(line):
            continue
        if level < 0:
            continue
        for piece in parts(line.intersection(road_extent).simplify(1.6), 'LineString'):
            if piece.length >= 7:
                xy = piece.interpolate(0.5, normalized=True).coords[0]
                tiles[grid_key(*xy, TILE)]['roads'].append([grade, level, flat(piece.coords)])

    for i, (code, count, polygon) in enumerate(census):
        if any(key[2] == i and value[0] > 0 for key, value in cells.items()):
            continue
        candidate = polygon.intersection(land).representative_point()
        if candidate.is_empty and count:
            print('Census group outside buildable land:', code, count, flush=True)
            candidate = land.boundary.interpolate(land.boundary.project(polygon.representative_point()))
        if not candidate.is_empty:
            x, y = candidate.coords[0]
            weights = cells[*grid_key(x, y, CELL), i, council_tree.nearest(candidate)]
            weights[0] += 1
            weights[6:9] += [x, y, 1]

    census_results = {}
    employment_results = {}
    jobs = employment(cache / 'tpedm-2021.pdf')
    for i, (_, count, _) in enumerate(census):
        census_results.update(allocate(count, [(key, value) for key, value in cells.items() if key[2] == i], 0))
    for i, key in enumerate(council_ids):
        employment_results.update(allocate(jobs[key], [(key, value) for key, value in cells.items() if key[3] == i], 1))
    nodes, edges = graph(osm, land, elevations)
    node_tree = STRtree([Point(WEST + x * 10, NORTH - y * 10) for x, y in nodes])
    by_zone = defaultdict(list)
    cell_rows = []
    for key, values in sorted(cells.items()):
        gc, gr, group, council = key
        x, y = values[6:8] / values[8] if values[8] else (WEST + (gc + .5) * CELL, NORTH - (gr + .5) * CELL)
        anchor = Point(x, y)
        if not land.covers(anchor):
            intersection = census_polygons[group].intersection(land).intersection(box(WEST + gc * CELL, NORTH - (gr + 1) * CELL, WEST + (gc + 1) * CELL, NORTH - gr * CELL))
            if not intersection.is_empty:
                anchor = intersection.representative_point()
                x, y = anchor.coords[0]
        node = int(node_tree.nearest(anchor))
        homes, work = census_results[key], employment_results[key]
        weights = [round(n) for n in values[2:6]]
        if not any([homes, work, *weights]):
            continue
        row = [*point(x, y), group, council, homes, work, *weights, node, gc, gr]
        by_zone[group].append(row)
        cell_rows.append(row)

    by_kind = {'district': 0, 'area': 1, 'estate': 2, 'facility': 3, 'landmark': 4, 'street': 5}
    name_index = []
    name_keys = set()
    for source, entries in enumerate((official, name_list)):
        for xy, en, zh, kind in sorted(entries, key=lambda item: (by_kind[item[3]], item[1], item[0])):
            key = (en.casefold(), *grid_key(*xy, 120 if kind == 'street' else 300))
            if key in name_keys:
                continue
            name_keys.add(key)
            name_index.append([*point(*xy), en, zh, by_kind[kind], source])
    named_areas = [entry for entry in name_index if entry[4] < 2]
    if not named_areas:
        raise ValueError('No bilingual names found')
    zones = []
    for i, (code, count, polygon) in enumerate(census):
        real_land = polygon.intersection(land)
        if real_land.is_empty:
            real_land = polygon
        items = by_zone[i]
        center = np.average([(item[0], item[1]) for item in items], axis=0,
                            weights=[max(1, item[4] + item[5] + item[6]) for item in items]) if items else point(*real_land.representative_point().coords[0])
        x, y = map(float, center)
        name = min(named_areas, key=lambda entry: math.hypot(x - entry[0], y - entry[1]) * (1 if entry[4] == 0 else 1.13))
        work = sum(item[5] for item in items)
        if sum(item[4] for item in items) != count:
            raise ValueError(f'Census control total failed in {code}')
        zones.append([code, round(x, 1), round(y, 1), name[2], name[3], count, work,
                      *[sum(row[column] for row in items) for column in range(6, 10)], round(real_land.area / 1e6, 3),
                      [rings(part) for part in parts(real_land.simplify(7, preserve_topology=True), 'Polygon')]])

    for i, key in enumerate(council_ids):
        if sum(row[5] for row in cell_rows if row[3] == i) != jobs[key]:
            raise ValueError(f'Employment control total failed in {key}')

    for (x, y), tile in sorted(tiles.items()):
        write_json(output / 'tiles' / f'{x}-{y}.json', tile)
    fine_grid = rasterize(((shape, 1) for shape in footprints), (len(elevations) * 4,) * 2,
                          transform=from_origin(WEST, NORTH, SURVEY_GRID / 4, SURVEY_GRID / 4), dtype='uint8')
    density = (fine_grid.reshape(len(elevations), 4, len(elevations), 4).mean(axis=(1, 3)) * 100).round().astype('uint8')
    print(f'{len(cell_rows)} cells, {len(nodes)} walk nodes, {len(edges)} edges, {len(name_index)} names, height source {dict(heights)}', flush=True)
    return {
        'projection': [2326, WEST, NORTH, EAST, SOUTH], 'grid': SURVEY_GRID / 10, 'cellSize': CELL / 10, 'tileSize': TILE / 10,
        'elevation': encoded(elevations.round().astype('<u2')), 'density': encoded(density),
        'zones': zones, 'cells': cell_rows, 'councils': [list(COUNCILS[key]) + [jobs[key]] for key in council_ids],
        'nodes': encoded((np.array(nodes) * 10).round().astype('<u2')),
        'edges': encoded(np.array(edges, dtype=[('a', '<u4'), ('b', '<u4'), ('cost', '<u2')])),
        'places': name_index, 'tiles': [list(key) for key in sorted(tiles)],
        'ferryPiers': [point(*xy) for xy in sorted(set(osm.piers)) if land.buffer(130).covers(Point(xy))],
        'buildingHeights': dict(heights),
    }


def build(cache, output):
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        fetch(cache, name, url)
    districts = read_json(cache / 'districts.json')['features']
    councils = {item['properties']['地區號碼']: make_valid(project_geometry(shape(item['geometry']))) for item in districts
                if item['properties']['地區號碼'] in COUNCILS}
    osm = OpenMap()
    pbf = cache / 'hong-kong-260101.osm.pbf'
    print('Read OpenStreetMap snapshot', flush=True)
    osm.apply_file(pbf, locations=True, idx='flex_mem')
    full_land, land, island = coastline(osm, councils)
    expanded_land = land.buffer(40)
    prepare(expanded_land)
    official = official_names(cache, expanded_land)
    print('Allocate Census and TPEDM over buildings', flush=True)
    elevations = terrain(cache, SURVEY_GRID)
    model = data_index(census_data(cache, land), councils, osm, official, land, cache, output, elevations)
    geometry = lambda area: [rings(part) for part in parts(area.simplify(2.5, preserve_topology=True), 'Polygon')]
    model.update({'land': geometry(land), 'fullLand': geometry(full_land), 'island': geometry(island),
                  'coast': [flat(part.coords) for line in osm.coast for part in parts(line.simplify(3.5), 'LineString')
                            if part.intersects(expanded_land)],
                  'parks': [[kind, rings(part)] for area, kind in osm.parks
                            for part in parts(area.intersection(land).simplify(3, preserve_topology=True), 'Polygon') if part.area > 250],
                  'majorRoads': [[kind, level, flat(part.coords)] for line, kind, level in osm.roads if kind <= 1 and level >= 0 and expanded_land.intersects(line)
                                 for part in parts(line.intersection(expanded_land).simplify(5), 'LineString') if part.length > 20]})
    write_json(output / 'model.json', model)
    print('Render authentic topography', flush=True)
    save_relief(cache, output, full_land)
    def raw_hash(path):
        with path.open('rb') as file:
            return hashlib.file_digest(file, 'sha256').hexdigest()
    paths = [cache / name for name in SOURCES] + sorted(cache.glob('csdi-name-*.json'))
    write_json(output / 'sources.json', {path.name: raw_hash(path) for path in paths})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True, help='Directory for unmodified source downloads')
    args = parser.parse_args()
    build(args.cache, ROOT / 'public/data/hong-kong')
