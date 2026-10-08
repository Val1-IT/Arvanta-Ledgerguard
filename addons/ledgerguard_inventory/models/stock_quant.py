"""One JSON-2 call, one Odoo transaction. Never commit or elevate the caller.

References (Odoo 19):
https://www.odoo.com/documentation/19.0/developer/reference/external_api.html#transaction
https://github.com/odoo/odoo/blob/19.0/addons/stock/models/stock_quant.py
https://github.com/odoo/odoo/blob/19.0/odoo/orm/models.py (check_access)

The lock protects the exact approved row, not all quants for a product/location.
Odoo's stock implementation may create duplicate quants during concurrent moves.
The usual Odoo stock accounting methods contain their own internal maintenance
privileges; this module does not add or bypass the initiating user's permissions.
"""
import json

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from ..contract import PROTOCOL, action_hash, quantities_equal, validate_request


class StockQuant(models.Model):
    _inherit = 'stock.quant'

    @api.private
    def init(self):
        super().init()
        # No ORM model, RPC CRUD method, or ACL grant exposes receipt writes.
        # Retain this append-only table across addon uninstall/reinstall: deleting
        # receipts would discard durable replay protection. No automatic pruning.
        self.env.cr.execute('''
            CREATE TABLE IF NOT EXISTS ledgerguard_inventory_receipt (
                user_id INTEGER NOT NULL,
                action_hash VARCHAR(64) NOT NULL,
                request JSONB NOT NULL,
                snapshot JSONB NOT NULL,
                created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, action_hash)
            )
        ''')

    @api.model
    def ledgerguard_apply_inventory(self, request):
        """Apply a narrowly scoped approved count or safely replay its receipt.

        Any exception, conflict wizard, or failed verification rolls back both
        the count and receipt. JSON-2 owns the transaction and retry boundary.
        """
        request, quant = self._ledgerguard_prepare(request)
        with self.env.cr.savepoint():
            quant._ledgerguard_lock()
            prior = quant._ledgerguard_receipt(request)
            if prior:
                return quant._ledgerguard_replay(request, prior)
            stale = quant._ledgerguard_precondition(request)
            if stale:
                return dict(protocol=PROTOCOL, status='stale', request=request, detail=stale)
            quant._ledgerguard_check_scope()
            quant.write({'inventory_quantity': request['target_quantity']})
            outcome = quant.action_apply_inventory()
            if outcome:
                raise UserError('LedgerGuard inventory apply requires interactive resolution; no changes committed')
            quant.flush_recordset()
            quant.invalidate_recordset()
            quant.check_access('read')
            quant.check_access('write')
            if not quant._ledgerguard_matches_target(request):
                raise ValidationError('LedgerGuard inventory postcondition failed; no changes committed')
            snapshot = quant._ledgerguard_snapshot()
            quant._ledgerguard_store_receipt(request, snapshot)
            return dict(protocol=PROTOCOL, status='applied', replayed=False,
                        request=request, snapshot=snapshot)

    @api.model
    def ledgerguard_inventory_status(self, request):
        """Read only: action-bound evidence, never infer provenance from quantity."""
        request, quant = self._ledgerguard_prepare(request)
        # Serialize with a concurrent invocation of the mutation method. Under
        # Odoo Repeatable Read a concurrent update may cause a retryable database
        # error, rather than incorrectly claiming an uncommitted call did nothing.
        quant._ledgerguard_lock()
        prior = quant._ledgerguard_receipt(request)
        if prior:
            return quant._ledgerguard_replay(request, prior)
        return dict(protocol=PROTOCOL, status='not_applied', request=request)

    @api.model
    def _ledgerguard_prepare(self, request):
        try:
            request = validate_request(request)
        except (ValueError, OverflowError) as error:
            raise ValidationError(str(error)) from error
        if self.env.su or not self.env.user.has_group('stock.group_stock_manager'):
            raise AccessError('LedgerGuard requires a non-superuser inventory manager')
        # Accessing env.companies validates allowed_company_ids. Drop arbitrary
        # context flags before stock methods (force_company, inventory_name,
        # quants_cache, skip checks, or caller-selected defaults are not allowed).
        companies = self.env.companies.ids
        quant = self.with_context({'allowed_company_ids': companies, 'inventory_mode': True}).browse(request['quant_id'])
        quant.check_access('read')
        quant.check_access('write')
        for name in ('product_id', 'location_id', 'company_id', 'quantity', 'write_date'):
            quant._check_field_access(quant._fields[name], 'read')
        if not quant.exists():
            raise AccessError('The requested inventory record is not accessible')
        # Reading fields also enforces field access; check_access alone is not a
        # substitute for ORM reads. Never read inventory state directly in SQL.
        quant._ledgerguard_snapshot()
        return request, quant

    def _ledgerguard_lock(self):
        self.ensure_one()
        self.flush_recordset()
        # Only the validated integer ID enters this fixed parameterized SQL.
        # Actual ACL/record rules were checked BEFORE taking a lock, and are
        # checked again after invalidation. SQL is used solely for synchronization.
        self.env.cr.execute('SELECT id FROM stock_quant WHERE id = %s FOR UPDATE', (self.id,))
        if not self.env.cr.fetchone():
            raise AccessError('The requested inventory record is not accessible')
        self.invalidate_recordset()
        self.check_access('read')
        self.check_access('write')

    def _ledgerguard_snapshot(self):
        self.ensure_one()
        return dict(id=self.id, product_id=self.product_id.id, location_id=self.location_id.id,
                    company_id=self.company_id.id or None, quantity=self.quantity,
                    write_date=fields.Datetime.to_string(self.write_date))

    def _ledgerguard_receipt(self, request):
        self.env.cr.execute('''
            SELECT request, snapshot FROM ledgerguard_inventory_receipt
            WHERE user_id = %s AND action_hash = %s
        ''', (self.env.uid, action_hash(request)))
        row = self.env.cr.fetchone()
        if not row:
            return None
        if row[0] != request:
            raise ValidationError('LedgerGuard action receipt binding mismatch')
        return row[1]

    def _ledgerguard_store_receipt(self, request, snapshot):
        # The unique key is a second defense against duplicate receipts. Never
        # catch a uniqueness/serialization failure and retain an inventory write.
        self.env.cr.execute('''
            INSERT INTO ledgerguard_inventory_receipt (user_id, action_hash, request, snapshot)
            VALUES (%s, %s, %s::jsonb, %s::jsonb)
        ''', (self.env.uid, action_hash(request), json.dumps(request), json.dumps(snapshot)))

    def _ledgerguard_replay(self, request, snapshot):
        current = self._ledgerguard_snapshot()
        # A prior success is not proof that later stock movements preserved it.
        if not self._ledgerguard_matches_target(request) or current != snapshot:
            return dict(protocol=PROTOCOL, status='ambiguous', request=request,
                        detail='A durable receipt exists but the current quant has changed')
        return dict(protocol=PROTOCOL, status='applied', replayed=True,
                    request=request, snapshot=snapshot)

    def _ledgerguard_precondition(self, request):
        snapshot = self._ledgerguard_snapshot()
        for field in ('product_id', 'location_id', 'company_id'):
            if snapshot[field] != request[field]:
                return f'{field} changed after approval'
        if not quantities_equal(snapshot['quantity'], request['expected_quantity']):
            return 'quantity changed after approval'
        if snapshot['write_date'] != request['expected_write_date']:
            return 'write_date changed after approval'
        return None

    def _ledgerguard_matches_target(self, request):
        current = self._ledgerguard_snapshot()
        return (all(current[field] == request[field] for field in ('product_id', 'location_id', 'company_id'))
                and quantities_equal(current['quantity'], request['target_quantity']))

    def _ledgerguard_check_scope(self):
        if self.location_id.usage != 'internal' or not self.company_id:
            raise ValidationError('LedgerGuard requires a company-owned internal stock location')
        if self.product_id.tracking != 'none' or self.lot_id or self.package_id or self.owner_id:
            raise ValidationError('LedgerGuard currently supports only untracked, unpackaged, unowned quants')
        if self.inventory_quantity_set:
            raise ValidationError('An inventory count is already pending; LedgerGuard will not overwrite it')
