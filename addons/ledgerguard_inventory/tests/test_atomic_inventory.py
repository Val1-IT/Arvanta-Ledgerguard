"""Server tests: run with --test-enable --test-tags /ledgerguard_inventory.

These require a disposable Odoo/PostgreSQL instance. Offline contract tests do
not substitute for these ORM, ACL, record-rule, and rollback checks.
"""
from unittest.mock import patch

from odoo import Command, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase, new_test_user


@tagged('post_install', '-at_install')
class TestLedgerguardAtomicInventory(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.manager = new_test_user(cls.env, login='ledgerguard-inventory-manager',
                                    groups='stock.group_stock_manager',
                                    company_id=cls.company.id,
                                    company_ids=[Command.set([cls.company.id])])
        cls.reader = new_test_user(cls.env, login='ledgerguard-inventory-reader',
                                   groups='stock.group_stock_user',
                                   company_id=cls.company.id,
                                   company_ids=[Command.set([cls.company.id])])
        cls.product = cls.env['product.product'].create({
            'name': 'LedgerGuard Atomic Test', 'is_storable': True, 'type': 'consu',
        })
        cls.location = cls.env['stock.location'].create({
            'name': 'LedgerGuard Atomic Test Stock', 'usage': 'internal', 'company_id': cls.company.id,
        })
        cls.quant = cls.env['stock.quant'].create({
            'product_id': cls.product.id, 'location_id': cls.location.id, 'quantity': 20,
        })
        cls.env.flush_all()

    def _request(self, **overrides):
        self.quant.invalidate_recordset()
        return dict({
            'quant_id': self.quant.id, 'product_id': self.product.id,
            'location_id': self.location.id, 'company_id': self.company.id,
            'expected_quantity': self.quant.quantity, 'target_quantity': 10,
            'expected_write_date': fields.Datetime.to_string(self.quant.write_date),
        }, **overrides)

    def _api(self, user=None):
        return self.env['stock.quant'].with_user(user or self.manager)

    def _receipt_count(self):
        self.env.cr.execute('SELECT count(*) FROM ledgerguard_inventory_receipt WHERE user_id = %s',
                            (self.manager.id,))
        return self.env.cr.fetchone()[0]

    def test_applies_verifies_and_replays_exact_action(self):
        request = self._request()
        first = self._api().ledgerguard_apply_inventory(request)
        self.assertEqual(first['status'], 'applied')
        self.assertFalse(first['replayed'])
        self.assertEqual(first['snapshot']['quantity'], 10)
        count = self.env['stock.move'].search_count([('product_id', '=', self.product.id)])
        replay = self._api().ledgerguard_apply_inventory(request)
        self.assertEqual(replay['status'], 'applied')
        self.assertTrue(replay['replayed'])
        self.assertEqual(self._receipt_count(), 1)
        self.assertEqual(self.env['stock.move'].search_count([('product_id', '=', self.product.id)]), count)
        self.assertEqual(self._api().ledgerguard_inventory_status(request)['status'], 'applied')

    def test_each_approved_precondition_is_checked_without_write(self):
        for overrides in [dict(expected_quantity=21), dict(product_id=self.product.id + 99999),
                          dict(location_id=self.location.id + 99999), dict(company_id=None),
                          dict(expected_write_date='2000-01-01 00:00:00')]:
            with self.subTest(overrides=overrides):
                result = self._api().ledgerguard_apply_inventory(self._request(**overrides))
                self.assertEqual(result['status'], 'stale')
                self.assertEqual(self.quant.quantity, 20)
                self.assertFalse(self.quant.inventory_quantity_set)
                self.assertEqual(self._receipt_count(), 0)

    def test_rejects_superuser_and_non_manager_before_mutation(self):
        for api in [self.env['stock.quant'].sudo(), self._api(self.reader)]:
            with self.assertRaises(AccessError):
                api.ledgerguard_apply_inventory(self._request())
        self.assertEqual(self.quant.quantity, 20)
        self.assertEqual(self._receipt_count(), 0)

    def test_actual_quant_write_acl_is_required(self):
        # Remove every quant model write ACL, including additive implied groups.
        self.env['ir.model.access'].search([
            ('model_id.model', '=', 'stock.quant'), ('perm_write', '=', True),
        ]).write({'perm_write': False})
        with self.assertRaises(AccessError):
            self._api().ledgerguard_apply_inventory(self._request())
        self.assertEqual(self.quant.quantity, 20)
        self.assertEqual(self._receipt_count(), 0)

    def test_actual_record_rule_is_enforced_for_apply_and_replay(self):
        request = self._request()
        self._api().ledgerguard_apply_inventory(request)
        self.env['ir.rule'].create({
            'name': 'Deny LedgerGuard test quant',
            'model_id': self.env['ir.model']._get_id('stock.quant'),
            'domain_force': "[('id', '!=', %d)]" % self.quant.id,
            'perm_read': True, 'perm_write': True,
        })
        for method in ['ledgerguard_apply_inventory', 'ledgerguard_inventory_status']:
            with self.assertRaises(AccessError):
                getattr(self._api(), method)(request)
        self.assertEqual(self._receipt_count(), 1)

    def test_write_only_record_rule_denies_apply_even_when_read_is_allowed(self):
        request = self._request()
        self.env['ir.rule'].create({
            'name': 'Read but do not adjust LedgerGuard test quant',
            'model_id': self.env['ir.model']._get_id('stock.quant'),
            'domain_force': "[('id', '!=', %d)]" % self.quant.id,
            'perm_read': False, 'perm_write': True,
            'perm_create': False, 'perm_unlink': False,
        })
        self.quant.with_user(self.manager).check_access('read')
        with self.assertRaises(AccessError):
            self._api().ledgerguard_apply_inventory(request)
        self.assertEqual(self.quant.quantity, 20)
        self.assertEqual(self._receipt_count(), 0)

    def test_cannot_access_another_company_or_forge_allowed_companies(self):
        other = self.env['res.company'].create({'name': 'LedgerGuard Other Company'})
        location = self.env['stock.location'].create({
            'name': 'Other company stock', 'usage': 'internal', 'company_id': other.id,
        })
        quant = self.env['stock.quant'].create({
            'product_id': self.product.id, 'location_id': location.id, 'quantity': 20,
        })
        request = self._request(quant_id=quant.id, location_id=location.id, company_id=other.id,
                                expected_write_date=fields.Datetime.to_string(quant.write_date))
        with self.assertRaises(AccessError):
            self._api().ledgerguard_apply_inventory(request)
        with self.assertRaises(AccessError):
            self._api().with_context(allowed_company_ids=[other.id]).ledgerguard_apply_inventory(request)
        self.assertEqual(quant.quantity, 20)

    def test_conflict_wizard_rolls_back_staged_inventory_count(self):
        request = self._request()
        with patch.object(type(self.quant), 'action_apply_inventory', return_value={'res_model': 'stock.inventory.conflict'}):
            with self.assertRaises(UserError):
                self._api().ledgerguard_apply_inventory(request)
        self.quant.invalidate_recordset()
        self.assertEqual(self.quant.quantity, 20)
        self.assertFalse(self.quant.inventory_quantity_set)
        self.assertEqual(self._receipt_count(), 0)

    def test_postcondition_failure_rolls_back_real_stock_moves_and_receipt(self):
        request = self._request()
        before = self.env['stock.move'].search_count([('product_id', '=', self.product.id)])
        with patch.object(type(self.quant), '_ledgerguard_matches_target', return_value=False):
            with self.assertRaises(ValidationError):
                self._api().ledgerguard_apply_inventory(request)
        self.quant.invalidate_recordset()
        self.assertEqual(self.quant.quantity, 20)
        self.assertFalse(self.quant.inventory_quantity_set)
        self.assertEqual(self._receipt_count(), 0)
        self.assertEqual(self.env['stock.move'].search_count([('product_id', '=', self.product.id)]), before)

    def test_receipt_failure_rolls_back_the_inventory_write(self):
        request = self._request()
        before = self.env['stock.move'].search_count([('product_id', '=', self.product.id)])
        with patch.object(type(self.quant), '_ledgerguard_store_receipt', side_effect=UserError('receipt unavailable')):
            with self.assertRaises(UserError):
                self._api().ledgerguard_apply_inventory(request)
        self.quant.invalidate_recordset()
        self.assertEqual(self.quant.quantity, 20)
        self.assertFalse(self.quant.inventory_quantity_set)
        self.assertEqual(self._receipt_count(), 0)
        self.assertEqual(self.env['stock.move'].search_count([('product_id', '=', self.product.id)]), before)

    def test_pending_count_is_never_overwritten(self):
        self.quant.with_context(inventory_mode=True).write({'inventory_quantity': 19})
        with self.assertRaises(ValidationError):
            self._api().ledgerguard_apply_inventory(self._request())
        self.assertEqual(self.quant.inventory_quantity, 19)
        self.assertEqual(self.quant.quantity, 20)
        self.assertEqual(self._receipt_count(), 0)

    def test_tracked_quant_is_rejected(self):
        self.product.tracking = 'lot'
        with self.assertRaises(ValidationError):
            self._api().ledgerguard_apply_inventory(self._request())
        self.assertEqual(self.quant.quantity, 20)

    def test_status_without_receipt_never_claims_a_coincidental_write(self):
        request = self._request(target_quantity=20)
        self.assertEqual(self._api().ledgerguard_inventory_status(request)['status'], 'not_applied')
        self.assertEqual(self._receipt_count(), 0)

    def test_receipts_are_scoped_to_the_authenticated_user(self):
        request = self._request()
        self._api().ledgerguard_apply_inventory(request)
        other_manager = new_test_user(self.env, login='ledgerguard-other-manager',
                                      groups='stock.group_stock_manager',
                                      company_id=self.company.id,
                                      company_ids=[Command.set([self.company.id])])
        self.assertEqual(self._api(other_manager).ledgerguard_inventory_status(request)['status'], 'not_applied')
        self.assertEqual(self._api(other_manager).ledgerguard_apply_inventory(request)['status'], 'stale')
        self.assertEqual(self._api().ledgerguard_inventory_status(request)['status'], 'applied')
        self.assertEqual(self.quant.quantity, 10)
        self.assertEqual(self._receipt_count(), 1)

    def test_replay_after_later_drift_is_ambiguous_and_does_not_reapply(self):
        request = self._request()
        self._api().ledgerguard_apply_inventory(request)
        self.quant.write({'quantity': 12})
        self.assertEqual(self._api().ledgerguard_inventory_status(request)['status'], 'ambiguous')
        self.assertEqual(self._api().ledgerguard_apply_inventory(request)['status'], 'ambiguous')
        self.assertEqual(self.quant.quantity, 12)
        self.assertEqual(self._receipt_count(), 1)

    def test_ignored_caller_context_cannot_change_stock_method_behavior(self):
        request = self._request()
        original = type(self.quant).action_apply_inventory
        seen = []
        def inspect_context(record):
            seen.append(dict(record.env.context))
            return original(record)
        with patch.object(type(self.quant), 'action_apply_inventory', inspect_context):
            result = self._api().with_context(inventory_name='unapproved', force_company=999,
                                             quants_cache={}).ledgerguard_apply_inventory(request)
        self.assertEqual(result['status'], 'applied')
        self.assertEqual(seen, [{'allowed_company_ids': [self.company.id], 'inventory_mode': True}])

    def test_unsupported_fields_are_rejected_before_mutation(self):
        with self.assertRaises(ValidationError):
            self._api().ledgerguard_apply_inventory(self._request(model='res.users'))
        self.assertEqual(self.quant.quantity, 20)
        self.assertEqual(self._receipt_count(), 0)
