-- pgTAP tests for Milestone 6: Payments
BEGIN;
SELECT plan(12);

-- 1. Table structure tests
SELECT has_table('public', 'payments', 'Table payments exists');

SELECT has_column('public', 'payments', 'id', 'payments has id');
SELECT has_column('public', 'payments', 'agreement_id', 'payments has agreement_id');
SELECT has_column('public', 'payments', 'payer_id', 'payments has payer_id');
SELECT has_column('public', 'payments', 'payee_id', 'payments has payee_id');
SELECT has_column('public', 'payments', 'amount', 'payments has amount');
SELECT has_column('public', 'payments', 'payment_method', 'payments has payment_method');
SELECT has_column('public', 'payments', 'status', 'payments has status');
SELECT has_column('public', 'payments', 'reference_number', 'payments has reference_number');

-- 2. Verify functions exist
SELECT has_function('public', 'report_payment', ARRAY['uuid', 'uuid', 'integer', 'text', 'text', 'text', 'text'], 'Function report_payment exists');
SELECT has_function('public', 'confirm_payment', ARRAY['uuid'], 'Function confirm_payment exists');
SELECT has_function('public', 'complete_agreement', ARRAY['uuid'], 'Function complete_agreement exists');

SELECT * FROM finish();
ROLLBACK;
