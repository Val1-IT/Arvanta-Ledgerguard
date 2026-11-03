"""Strict wire contract shared by the endpoints; no caller-selected models or fields."""
from datetime import datetime
import hashlib
import json
import math
import re

# v2 adds an execution fence: the control-plane execution key and its lease
# generation. A call whose generation is below the highest generation Odoo has
# seen for that key is rejected inside the same transaction as the write.
PROTOCOL = 'ledgerguard.inventory.v2'
_FIELDS = frozenset({'quant_id', 'product_id', 'location_id', 'company_id',
                     'expected_quantity', 'target_quantity', 'expected_write_date',
                     'execution_key', 'fence_generation'})
MAX_EXECUTION_KEY_LENGTH = 200
_EXECUTION_KEY = re.compile(r'[\x21-\x7e]{1,%d}' % MAX_EXECUTION_KEY_LENGTH)
MAX_SAFE_INTEGER = 2**53 - 1


def validate_request(value):
    if not isinstance(value, dict) or set(value) != _FIELDS:
        raise ValueError('An exact LedgerGuard inventory request is required')
    request = dict(value)
    for key in ('quant_id', 'product_id', 'location_id', 'company_id'):
        number = request[key]
        if key == 'company_id' and number is None:
            continue
        if type(number) is not int or not 0 < number <= MAX_SAFE_INTEGER:
            raise ValueError(f'{key} must be a positive safe integer')
    for key in ('expected_quantity', 'target_quantity'):
        number = request[key]
        if type(number) not in (int, float) or not math.isfinite(number) or abs(number) > MAX_SAFE_INTEGER:
            raise ValueError(f'{key} must be a finite safe number')
        request[key] = 0.0 if number == 0 else float(number)
    stamp = request['expected_write_date']
    if not isinstance(stamp, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', stamp):
        raise ValueError('expected_write_date must be a canonical Odoo UTC datetime')
    datetime.strptime(stamp, '%Y-%m-%d %H:%M:%S')
    key, generation = request['execution_key'], request['fence_generation']
    if key is None and generation is None:
        return request  # unfenced direct call: no control-plane key to protect
    if not isinstance(key, str) or not _EXECUTION_KEY.fullmatch(key):
        raise ValueError('execution_key must be 1-200 printable ASCII characters without spaces')
    if type(generation) is not int or not 0 < generation <= MAX_SAFE_INTEGER:
        raise ValueError('fence_generation must be a positive safe integer')
    return request


def without_fence_generation(request):
    """The approved action and key, independent of which lease generation sent it."""
    return {key: value for key, value in request.items() if key != 'fence_generation'}


def action_hash(request):
    """Bound every approved field; the receipt primary key also binds the caller uid."""
    material = json.dumps([PROTOCOL, request], sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(material.encode('utf-8')).hexdigest()


def quantities_equal(left, right):
    return math.isfinite(left) and math.isfinite(right) and abs(left - right) < 1e-6
