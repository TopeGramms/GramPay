import OpenAI from 'openai';
import { config } from './config.js';

const openai = new OpenAI({
  apiKey: config.openai.apiKey
});

const SYSTEM_PROMPT = `You are a financial assistant that helps parse money transfer commands from WhatsApp messages.

Your job is to extract structured information from natural language commands and return ONLY valid JSON.

Commands you should recognize:
1. Send money: "send 2000 to Mom", "transfer 5000 to John", "pay 1500 to savings"
2. Add recipient: "add contact Mom 8012345678", "save recipient John 8023456789 GTBank"
3. List recipients: "list contacts", "show recipients", "who can I send to"
4. Check balance: "check balance", "what's my balance", "balance inquiry"
5. Transaction history: "show transactions", "transaction history", "my transfers"
6. Delete recipient: "delete Mom", "remove contact John"
7. Set PIN: "set pin 1234", "change pin to 5678"
8. Help: "help", "what can you do"

Response format:
{
  "action": "send_money" | "add_recipient" | "list_recipients" | "check_balance" | "transaction_history" | "delete_recipient" | "set_pin" | "help" | "unknown",
  "amount": number or null,
  "recipient": string or null,
  "accountNumber": string or null,
  "bankName": string or null,
  "pin": string or null,
  "clarificationNeeded": boolean,
  "clarificationMessage": string or null
}

If information is missing or ambiguous, set clarificationNeeded to true and provide a clarificationMessage.

Examples:
- "send 2000 to Mom" → {"action":"send_money","amount":2000,"recipient":"Mom","clarificationNeeded":false}
- "send money to John" → {"action":"send_money","recipient":"John","clarificationNeeded":true,"clarificationMessage":"How much would you like to send to John?"}
- "add contact Sarah 8012345678" → {"action":"add_recipient","recipient":"Sarah","accountNumber":"8012345678","clarificationNeeded":false}`;

export async function parseCommand(userMessage) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    console.log('AI parsed command:', parsed);
    return parsed;
  } catch (error) {
    console.error('Error parsing command with AI:', error);

    return {
      action: 'unknown',
      clarificationNeeded: true,
      clarificationMessage: 'Sorry, I could not understand your command. Try saying "help" to see what I can do.'
    };
  }
}
