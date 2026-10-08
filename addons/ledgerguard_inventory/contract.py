"""Strict wire contract shared by the endpoints; no caller-selected models or fields."""
from datetime import datetime
import hashlib
import json
import math
import re

PROTOCOL = 'ledgerguard.inventory.v1'
_FIELDS = frozenset({'quant_id', 'product_id', 'location_id', 'company_id',
                     'expected_quantity', 'target_quantity', 'expected_write_date'})
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
    return request


def action_hash(request):
    """Bound every approved field; the receipt primary key also binds the caller uid."""
    material = json.dumps([PROTOCOL, request], sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(material.encode('utf-8')).hexdigest()


def quantities_equal(left, right):
    return math.isfinite(left) and math.isfinite(right) and abs(left - right) < 1e-6
