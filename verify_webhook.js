import { opayService } from './server/payments.js';

async function testWebhook() {
    console.log('🧪 Testing Webhook Logic...');

    // 1. Mock Data
    const payload = {
        reference: 'TEST_REF_123',
        orderNo: 'OPAY_ORDER_123',
        amount: '1000',
        currency: 'NGN',
        status: 'SUCCESS',
        statusDesc: 'Transaction Successful'
    };

    // 2. Generate Valid Signature
    console.log('🔑 Generating signature...');
    const signature = opayService.generateSignature(payload);
    console.log('   Signature:', signature);

    // 3. Test handleWebhook with Valid Signature
    console.log('\n1️⃣  Testing with VALID signature...');
    // We expect this to try and update the DB. Since the reference doesn't exist, 
    // it might return "Database update failed" or similar, but the signature check should pass.
    // We are mocking the DB response effectively by expecting a specific failure mode or success if we inserted a dummy.
    // Actually, let's just see if it passes the signature check.

    const result = await opayService.handleWebhook(payload, signature);
    console.log('   Result:', result);

    if (result.message === 'Invalid signature') {
        console.error('❌ FAILED: Valid signature was rejected.');
    } else {
        console.log('✅ PASSED: Valid signature was accepted (DB result: ' + result.message + ')');
    }

    // 4. Test handleWebhook with INVALID Signature
    console.log('\n2️⃣  Testing with INVALID signature...');
    const resultInvalid = await opayService.handleWebhook(payload, 'invalid_signature_string');
    console.log('   Result:', resultInvalid);

    if (resultInvalid.message === 'Invalid signature') {
        console.log('✅ PASSED: Invalid signature was rejected.');
    } else {
        console.error('❌ FAILED: Invalid signature was NOT rejected.');
    }
}

testWebhook().catch(console.error);
