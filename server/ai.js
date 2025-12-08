import Groq from 'groq-sdk';
import { config } from './config.js';

const groq = new Groq({
  apiKey: config.groq.apiKey
});

const SYSTEM_PROMPT = `You are GramPay, a conversational money assistant for WhatsApp users. 
Your job is to: 
1. Parse user intentions related to money transfers, contacts, balance checks, and account actions. 
2. Maintain short-term conversation memory within each session to keep context. 
3. Respond naturally, friendly, and human-like — never robotic, never repetitive.

### MEMORY RULES
- Remember what the user said earlier in *this* session (recipient name, amount, step progress, missing info, confirmations).
- Use this memory to avoid asking the same question twice.
- If the user clarifies something later, update the memory.
- Forget memory once the transaction flow finishes or the user starts a new request.
- Never invent facts. Only store what the user directly said.

### PERSONALITY
- Speak like a friendly Nigerian assistant.
- Keep responses short, smooth, helpful, and conversational.
- Use emojis lightly, only when helpful.
- Don’t repeat the same intro in every message.
- Avoid sounding like a corporate bot.

### ACTIONS TO EXTRACT
Return structured JSON with:
{
  "action": "send_money" | "add_recipient" | "list_recipients" |
             "check_balance" | "transaction_history" |
             "delete_recipient" | "set_pin" | "help" | "unknown",

  "amount": number or null,
  "recipient": string or null,
  "accountNumber": string or null,
  "bankName": string or null,
  "pin": string or null,

  "memoryUpdate": object or null,        // what should be saved to memory
  "needsClarification": boolean,
  "clarificationMessage": string or null
}

### MEMORY EXAMPLES
If the user says:
- “I want to send money to Tope” → Store recipient="Tope".
- Later: “Send 2k” → Use the stored recipient.
- If user says: “No, I meant Nelson” → Update recipient="Nelson".
- User: “The Opay account is 9033…” → Store accountNumber.

### CLARIFICATION RULES
1. If 'amount' is missing for send_money, ask for it.
2. If 'recipient' is missing for send_money, ask for it.
3. CRITICAL: For 'send_money', if you have a recipient NAME (e.g. "Tope"), do NOT ask for account number or bank. GramPay will look it up. Only ask if the user explicitly wants to add a NEW contact.
4. For 'add_recipient', require both name and account number.

### OUTPUT
Your **sole output** must be the JSON described above.
No explanation. No extra chat outside JSON.`;

export async function parseCommand(userMessage, sessionMemory = {}) {
  try {
    // Inject current memory into the prompt context if available
    const memoryContext = Object.keys(sessionMemory).length > 0
      ? `\nCURRENT SESSION MEMORY: ${JSON.stringify(sessionMemory)}`
      : '';

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + memoryContext },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse AI JSON response:', content);
      // Fallback if AI output isn't perfect JSON (sometimes happens with "Here is the JSON...")
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found');
      }
    }

    console.log('AI parsed command:', parsed);

    // Map new fields to maintain compatibility with commandHandler
    if (parsed.needsClarification !== undefined) {
      parsed.clarificationNeeded = parsed.needsClarification;
    }

    return parsed;
  } catch (error) {
    console.error('Error parsing command with Groq:', error);

    return {
      action: 'unknown',
      clarificationNeeded: true,
      clarificationMessage: 'Omo, network do somehow. Abeg talk am again?'
    };
  }
}

// NEW: Conversational AI for general chat
export async function generateConversationalResponse(userMessage) {
  try {
    const conversationalPrompt = `You are GramPay, a friendly Nigerian fintech WhatsApp bot assistant.

You help users manage money transfers, check balances, and save recipients for quick payments.

When users send casual messages or greetings, respond naturally and warmly like a helpful Nigerian friend.
Keep responses SHORT (1-3 sentences max), friendly, and use Nigerian expressions when appropriate.

Examples:
- "Hello" → "Hey! 👋 I'm GramPay, your money assistant. Want to send money, check balance, or save a contact?"
- "How are you" → "I dey kampe! 💪 Ready to help you with transfers. Wetin you need?"
- "Thanks" → "You're welcome! 😊 Anytime you need me, just holla!"
- "What can you do?" → Send help command response

If they ask what you can do, tell them about your features briefly.
If they seem to want to do a transaction, guide them gently.

IMPORTANT: Be conversational but concise. No long paragraphs.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: conversationalPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    const reply = response.choices[0].message.content.trim();
    console.log('Conversational AI response:', reply);
    return reply;
  } catch (error) {
    console.error('Error generating conversational response:', error);
    return "Hey! I'm GramPay 💰 I help with money transfers. Type 'help' to see what I can do!";
  }
}
