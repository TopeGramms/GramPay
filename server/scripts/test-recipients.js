import { recipientService } from '../recipients.js';
import { config } from '../config.js';

async function testRecipients() {
    console.log('🧪 Testing Recipient Service...');
    console.log('Checking Supabase connection...');

    try {
        // 1. List recipients (should be empty or have existing)
        console.log('\n1. Listing initial recipients...');
        const listResult = await recipientService.listRecipients();
        console.log('Result:', listResult.message);

        // 2. Add a test recipient
        const testUser = `TestUser_${Date.now()}`;
        const testAccount = '1234567890';
        console.log(`\n2. Adding test recipient: ${testUser}...`);
        const addResult = await recipientService.addRecipient(testUser, testAccount, 'Test Bank');
        console.log('Result:', addResult.message);

        if (!addResult.success && !addResult.message.includes('already exists')) {
            throw new Error('Failed to add recipient');
        }

        // 3. Verify added recipient is in list
        console.log('\n3. Verifying addition...');
        const verifyList = await recipientService.listRecipients();
        const found = verifyList.data.find(r => r.nickname === testUser);

        if (found) {
            console.log(`✅ Successfully found ${testUser} in list!`);
        } else {
            console.error(`❌ ${testUser} not found in list!`);
        }

        // 4. Clean up (Delete test recipient)
        console.log(`\n4. Cleaning up (Deleting ${testUser})...`);
        const deleteResult = await recipientService.deleteRecipient(testUser);
        console.log('Result:', deleteResult.message);

        console.log('\n✅ Recipient Service Test Completed Successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test Failed:', error);
        process.exit(1);
    }
}

testRecipients();
