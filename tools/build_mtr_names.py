"""Join the official MTR station names to rail locations in the MetroLab OSM snapshot."""

import argparse
import csv
import json
import re
import statistics
from pathlib import Path

import osmium

from build_hong_kong import BOUNDS, PROJECT, point
from shapely.geometry import Point


def name_key(value):
    return re.sub(r'\s+station$|站$', '', value.strip(), flags=re.IGNORECASE).strip().casefold()


class RailLocations(osmium.SimpleHandler):
    def __init__(self, official):
        super().__init__()
        self.official = official
        self.names = {name_key(name): code for code, names in official.items() for name in names}
        self.locations = {}

    def add(self, tags, lon, lat):
        railway = tags.get('railway')
        if railway == 'station' or tags.get('public_transport') == 'station' and tags.get('subway') == 'yes':
            priority = 3
        elif railway in ('stop', 'platform') or tags.get('public_transport') == 'stop_position' and tags.get('subway') == 'yes':
            priority = 2
        elif railway == 'subway_entrance':
            priority = 1
        else:
            return
        code = tags.get('ref')
        if code not in self.official or priority == 1:
            code = next((self.names[key] for tag in ('name:en', 'name:zh-Hant', 'name:zh', 'name')
                         if (key := name_key(tags.get(tag, ''))) in self.names), None)
        if not code:
            return
        xy = PROJECT(lon, lat)
        if BOUNDS.covers(Point(xy)):
            self.locations.setdefault(code, []).append((priority, *point(*xy)))

    def node(self, node):
        self.add(node.tags, node.location.lon, node.location.lat)

    def way(self, way):
        tags = way.tags
        if tags.get('railway') not in ('station', 'platform') and tags.get('public_transport') != 'station':
            return
        nodes = [node for node in way.nodes if node.location.valid()]
        if nodes:
            self.add(tags, statistics.mean(node.lon for node in nodes), statistics.mean(node.lat for node in nodes))


def build(cache, output):
    with (cache / 'mtr-lines-and-stations.csv').open(encoding='utf-8-sig', newline='') as source:
        official = {row['Station Code']: (row['English Name'], row['Chinese Name']) for row in csv.DictReader(source)}
    locations = RailLocations(official)
    locations.apply_file(cache / 'hong-kong-260101.osm.pbf', locations=True, idx='flex_mem')
    stations = []
    for code, candidates in sorted(locations.locations.items()):
        priority = max(item[0] for item in candidates)
        anchors = sorted({(x, y, 16 if priority > 1 else 12) for grade, x, y in candidates if grade == priority})
        stations.append([code, *official[code], anchors])
    output.write_text(json.dumps(stations, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Matched {len(stations)} stations')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    build(args.cache, Path(__file__).resolve().parents[1] / 'public/data/hong-kong/mtr-stations.json')
