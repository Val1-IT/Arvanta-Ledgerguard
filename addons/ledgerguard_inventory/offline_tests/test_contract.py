"""Pure protocol tests runnable without an Odoo installation."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('contract', Path(__file__).parents[1] / 'contract.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)

REQUEST = dict(quant_id=17, product_id=3, location_id=8, company_id=1,
               expected_quantity=20, target_quantity=10,
               expected_write_date='2026-10-08 01:00:00')


class ContractTest(unittest.TestCase):
    def test_canonical_request_has_stable_hash(self):
        request = contract.validate_request(REQUEST)
        reverse = contract.validate_request(dict(reversed(list(REQUEST.items()))))
        self.assertEqual(contract.action_hash(request), contract.action_hash(reverse))
        for key, value in dict(quant_id=18, product_id=4, location_id=9, company_id=2,
                               expected_quantity=21, target_quantity=11,
                               expected_write_date='2026-10-08 01:00:01').items():
            self.assertNotEqual(contract.action_hash(request),
                                contract.action_hash(contract.validate_request({**REQUEST, key: value})))

    def test_rejects_extra_missing_or_non_mapping_input(self):
        for request in [None, [], {}, {**REQUEST, 'sudo': True},
                        {k: v for k, v in REQUEST.items() if k != 'company_id'}]:
            with self.subTest(request=request), self.assertRaises(ValueError):
                contract.validate_request(request)

    def test_rejects_boolean_non_finite_unsafe_and_string_numbers(self):
        for key in ['quant_id', 'product_id', 'location_id', 'company_id']:
            for value in [True, False, 0, -1, 1.5, '1', 2**53]:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    contract.validate_request({**REQUEST, key: value})
        for key in ['expected_quantity', 'target_quantity']:
            for value in [True, '10', None, float('inf'), float('-inf'), float('nan'), 2**53]:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    contract.validate_request({**REQUEST, key: value})

    def test_requires_canonical_real_utc_second_datetime(self):
        for value in ['2026-02-31 00:00:00', '2026-10-08T01:00:00Z',
                      '2026-10-08 01:00:00 extra', '2026-10-08 25:00:00', None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                contract.validate_request({**REQUEST, 'expected_write_date': value})

    def test_normalizes_equal_numeric_inputs_and_nullable_company(self):
        self.assertEqual(contract.action_hash(contract.validate_request(REQUEST)),
                         contract.action_hash(contract.validate_request({**REQUEST, 'target_quantity': 10.0})))
        self.assertEqual(contract.action_hash(contract.validate_request({**REQUEST, 'target_quantity': 0})),
                         contract.action_hash(contract.validate_request({**REQUEST, 'target_quantity': -0.0})))
        self.assertIsNone(contract.validate_request({**REQUEST, 'company_id': None})['company_id'])


if __name__ == '__main__':
    unittest.main()
