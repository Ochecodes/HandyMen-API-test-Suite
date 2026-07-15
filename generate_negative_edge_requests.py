"""
generate_negative_edge_requests.py

Reads HandyMan_API_Test_Suite.xlsx (Test Cases sheet) and
HandyMan_API_postman_collection.json, and generates one Postman request per
Negative/Edge test case row, inserted into the same module folder as its
corresponding Positive request. Writes an extended collection JSON.

Rows that don't match a known scenario pattern are left out and reported at
the end so they can be added by hand.
"""

import json
import re
import copy
import sys

import openpyxl

XLSX_PATH = 'HandyMan_API_Test_Suite.xlsx'
COLLECTION_PATH = 'HandyMan_API_postman_collection.json'
OUT_PATH = 'HandyMan_API_postman_collection.with_negatives.json'

STEPS_RE = re.compile(r'Send\s+(GET|POST|PUT|DELETE|PATCH)\s+(\S+)')


def normalize_endpoint(path_arr):
    return '/' + '/'.join(
        re.sub(r'^\{\{(.+)\}\}$', r'{\1}', seg) for seg in path_arr
    )


def load_collection():
    with open(COLLECTION_PATH) as f:
        return json.load(f)


def load_test_cases():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    ws = wb['Test Cases']
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r[0]:
            continue
        rows.append({
            'id': r[0], 'module': r[1], 'endpoint': r[2], 'method': r[3],
            'scenario': r[4], 'type': r[5], 'priority': r[6],
            'preconditions': r[7], 'steps': r[8], 'expected': r[9],
        })
    return rows


def index_positive_items(collection):
    """Return {module_name: {(method, endpoint): item}} for existing items."""
    index = {}
    for folder in collection['item']:
        if 'item' not in folder:
            continue
        module = folder['name']
        index[module] = {}
        for it in folder['item']:
            req = it['request']
            endpoint = normalize_endpoint(req['url'].get('path', []))
            index[module][(req['method'], endpoint)] = it
    return index


def extract_codes(expected_text):
    codes = re.findall(r'\b([1-5]\d\d)\b', expected_text or '')
    seen = []
    for c in codes:
        if c not in seen:
            seen.append(c)
    return [int(c) for c in seen] or [400]


def parse_steps_url(steps):
    m = STEPS_RE.search(steps or '')
    if not m:
        return None, None
    return m.group(1), m.group(2)


def build_url_from_literal_path(literal_path):
    if '?' in literal_path:
        path_part, query_part = literal_path.split('?', 1)
    else:
        path_part, query_part = literal_path, ''
    path_part = path_part.lstrip('/')
    path_arr = path_part.split('/') if path_part else []
    query_arr = []
    if query_part:
        for pair in query_part.split('&'):
            if '=' in pair:
                k, v = pair.split('=', 1)
            else:
                k, v = pair, ''
            query_arr.append({'key': k, 'value': v})
    raw = '{{baseUrl}}/' + path_part + (('?' + query_part) if query_part else '')
    return {'raw': raw, 'host': ['{{baseUrl}}'], 'path': path_arr, 'query': query_arr}


def classify(row):
    scenario = (row['scenario'] or '').lower()
    steps = (row['steps'] or '').lower()

    if 'without an authorization/bearer token' in steps:
        return 'NO_AUTH'
    if 'invalid/expired bearer token' in steps:
        return 'INVALID_TOKEN'
    if "missing required query param" in scenario:
        return 'MISSING_QUERY_PARAM'
    if "invalid enum value for" in scenario:
        return 'INVALID_ENUM'
    if "invalid email format in" in scenario:
        return 'INVALID_EMAIL'
    if 'below minimum boundary' in scenario or 'above maximum boundary' in scenario:
        return 'BOUNDARY'
    if 'request body missing required field' in scenario:
        return 'MISSING_BODY_FIELD'
    if 'request body with wrong data type' in scenario:
        return 'WRONG_TYPE_BODY'
    if 'request body with empty payload' in scenario:
        return 'EMPTY_BODY'
    if 'does not exist' in scenario:
        return 'NOT_FOUND'
    if 'wrong data type (non-numeric)' in scenario:
        return 'WRONG_TYPE_PATH'
    if 'pagination with negative page number' in scenario:
        return 'PAGINATION_NEGATIVE'
    if 'pagination beyond last page' in scenario:
        return 'PAGINATION_BEYOND'
    if 'out of range' in scenario:
        return 'OUT_OF_RANGE_QUERY'
    return None


def mutate_body(base_item, mutator, note_list):
    body = base_item['request'].get('body')
    if not body or body.get('mode') != 'raw':
        note_list.append('no raw JSON body on base request to mutate')
        return None
    try:
        data = json.loads(body['raw'])
    except Exception as e:
        note_list.append(f'could not parse base body JSON: {e}')
        return None
    ok = mutator(data, note_list)
    if not ok:
        return None
    new_body = copy.deepcopy(body)
    new_body['raw'] = json.dumps(data, indent=2)
    return new_body


def generate_item(row, base_item):
    notes = []
    category = classify(row)
    if category is None:
        return None, 'uncategorized'

    new_item = copy.deepcopy(base_item)
    new_item['name'] = f"{row['id']}: {row['scenario']}"
    new_item['response'] = []

    method, literal_path = parse_steps_url(row['steps'])
    if literal_path:
        new_item['request']['url'] = build_url_from_literal_path(literal_path)
    # else: keep base URL unchanged (shouldn't normally happen)

    if category == 'NO_AUTH':
        new_item['request']['auth'] = {'type': 'noauth'}

    elif category == 'INVALID_TOKEN':
        new_item['request']['auth'] = {
            'type': 'bearer',
            'bearer': [{'key': 'token', 'value': 'invalid.expired.testtoken', 'type': 'string'}],
        }

    elif category == 'MISSING_BODY_FIELD':
        m = re.search(r'required fields:\s*([^)]+)\)', row['steps'] or '')
        if not m:
            notes.append('could not parse required-fields list from Steps')
        else:
            fields = [f.strip() for f in m.group(1).split(',')]
            target = fields[0] if fields else None

            def mutator(data, note_list, target=target):
                if target in data:
                    del data[target]
                    return True
                note_list.append(f"field '{target}' not found in base body")
                return False

            nb = mutate_body(base_item, mutator, notes)
            if nb:
                new_item['request']['body'] = nb
                new_item['name'] += f" (removed: {target})"

    elif category == 'WRONG_TYPE_BODY':
        def mutator(data, note_list):
            for k, v in data.items():
                if isinstance(v, str):
                    data[k] = 12345
                    note_list.append(f"flipped field '{k}' (str->number)")
                    return True
            for k, v in data.items():
                if isinstance(v, (int, float)):
                    data[k] = 'wrong-type-value'
                    note_list.append(f"flipped field '{k}' (number->str)")
                    return True
            note_list.append('no mutable field found for wrong-type test')
            return False

        nb = mutate_body(base_item, mutator, notes)
        if nb:
            new_item['request']['body'] = nb

    elif category == 'EMPTY_BODY':
        def mutator(data, note_list):
            data.clear()
            return True

        nb = mutate_body(base_item, mutator, notes)
        if nb:
            new_item['request']['body'] = nb

    elif category == 'INVALID_EMAIL':
        m = re.search(r"invalid email format in '(\w+)'", row['scenario'] or '', re.I)
        field = m.group(1) if m else 'email'

        def mutator(data, note_list, field=field):
            if field in data:
                data[field] = 'not-an-email'
                return True
            note_list.append(f"field '{field}' not found in base body")
            return False

        nb = mutate_body(base_item, mutator, notes)
        if nb:
            new_item['request']['body'] = nb

    elif category == 'INVALID_ENUM':
        m = re.search(r"invalid enum value for '(\w+)'", row['scenario'] or '', re.I)
        field = m.group(1) if m else None

        def mutator(data, note_list, field=field):
            if field and field in data:
                data[field] = 'INVALID_ENUM_VALUE'
                return True
            note_list.append(f"field '{field}' not found in base body")
            return False

        nb = mutate_body(base_item, mutator, notes)
        if nb:
            new_item['request']['body'] = nb

    elif category == 'BOUNDARY':
        m = re.search(r"'(\w+)' (below|above)", row['scenario'] or '', re.I)
        if not m:
            notes.append('could not parse boundary field/direction from scenario')
        else:
            field, direction = m.groups()
            num_m = re.search(r'\(([-\d.]+|N/A)\)', row['steps'] or '')
            base_num = None
            if num_m and num_m.group(1) != 'N/A':
                base_num = float(num_m.group(1))
            if base_num is not None:
                value = base_num - 1 if direction.lower() == 'below' else base_num + 1
            else:
                value = -999999999 if direction.lower() == 'below' else 999999999

            def mutator(data, note_list, field=field, value=value):
                if field in data:
                    data[field] = value
                    return True
                note_list.append(f"field '{field}' not found in base body")
                return False

            nb = mutate_body(base_item, mutator, notes)
            if nb:
                new_item['request']['body'] = nb

    # NOT_FOUND, WRONG_TYPE_PATH, PAGINATION_NEGATIVE, PAGINATION_BEYOND,
    # MISSING_QUERY_PARAM: fully handled by the literal URL parsed from Steps.

    codes = extract_codes(row['expected'])
    test_script = (
        f"pm.test(\"{row['id']}: status code matches expected\", function () {{\n"
        f"    pm.expect({codes}).to.include(pm.response.code);\n"
        f"}});\n"
        f"pm.test(\"Response time is acceptable\", function () {{\n"
        f"    pm.expect(pm.response.responseTime).to.be.below(3000);\n"
        f"}});\n"
    )
    new_item['event'] = [{
        'listen': 'test',
        'script': {'exec': test_script.split('\n'), 'type': 'text/javascript'},
    }]

    if notes:
        new_item['name'] += f" [CHECK: {'; '.join(notes)}]"

    return new_item, ('generated_with_warning' if notes else 'generated')


def main():
    collection = load_collection()
    rows = load_test_cases()
    index = index_positive_items(collection)

    neg_edge_rows = [r for r in rows if r['type'] in ('Negative', 'Edge')]

    generated = {}  # module -> [items]
    stats = {'generated': 0, 'generated_with_warning': 0, 'uncategorized': 0, 'no_base_match': 0}
    uncategorized_ids = []
    warned_ids = []
    no_match_ids = []

    for row in neg_edge_rows:
        module_index = index.get(row['module'], {})
        base_item = module_index.get((row['method'], row['endpoint']))
        if base_item is None:
            stats['no_base_match'] += 1
            no_match_ids.append((row['id'], row['module'], row['method'], row['endpoint']))
            continue

        new_item, status = generate_item(row, base_item)
        if new_item is None:
            stats['uncategorized'] += 1
            uncategorized_ids.append(row['id'])
            continue

        generated.setdefault(row['module'], []).append(new_item)
        stats[status] += 1
        if status == 'generated_with_warning':
            warned_ids.append(row['id'])

    # Insert generated items into their module folders
    for folder in collection['item']:
        if 'item' not in folder:
            continue
        module = folder['name']
        if module in generated:
            folder['item'].extend(generated[module])

    with open(OUT_PATH, 'w') as f:
        json.dump(collection, f, indent='\t')

    total = len(neg_edge_rows)
    print(f"Negative/Edge rows in xlsx: {total}")
    print(f"  Generated cleanly       : {stats['generated']}")
    print(f"  Generated with warning  : {stats['generated_with_warning']}")
    print(f"  Uncategorized (skipped) : {stats['uncategorized']}")
    print(f"  No base request match   : {stats['no_base_match']}")
    print(f"\nOutput written to: {OUT_PATH}")

    if warned_ids:
        print(f"\nGenerated but flagged for manual review ({len(warned_ids)}): {', '.join(warned_ids)}")
    if uncategorized_ids:
        print(f"\nSkipped — no matching scenario pattern ({len(uncategorized_ids)}): {', '.join(uncategorized_ids)}")
    if no_match_ids:
        print(f"\nSkipped — no base Positive request found ({len(no_match_ids)}):")
        for x in no_match_ids:
            print('  ', x)


if __name__ == '__main__':
    main()
