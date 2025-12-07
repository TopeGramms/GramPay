import Groq from 'groq-sdk';
import { config } from './config.js';

const groq = new Groq({
  apiKey: config.groq.apiKey
});

const SYSTEM_PROMPT = `You are an intelligent financial command parser designed to understand ANY style of human messaging on WhatsApp.

Your ONLY job is to analyze the user’s message and return a valid JSON structure describing the user’s intent. 
Do NOT generate conversational replies, greetings, or extra text—ONLY JSON.

You MUST understand:
- Slang (“boss abeg send 5k to shola”)
- Pidgin English (“run 2k give Janet”)
- Typos (“sand 3000 to jonh”)
- Short forms (“snd 2k mom”)
- Wrong word order (“to Sarah send 2000”)
- Incomplete statements (“send to mike”)
- Emojis (“📲 send 4k to mum”)
- Mixed formats (“save my babe sarah 80123 gtb abeg”)

Your goal is to figure out the user’s intent, even if the message is messy, unclear, or written in an unusual order.

Recognize these command categories:

1. Send money  
   Examples: “send 2000 to Mom”, “run 5k give Tola”, “transfer 10k john”, “2k for sabinus”

2. Add recipient  
   Examples: “add contact Sarah 8012345678”, “save bayo number 8023… gtb”, “store Janet”, “register Mike”

3. List recipients  
   Examples: “show contacts”, “who can I send to”, “my saved people”

4. Check balance  
   Examples: “balance”, “how much I get”, “my account balance”

5. Transaction history  
   Examples: “show my transfers”, “history”, “past payments”

6. Delete recipient  
   Examples: “remove Sarah”, “delete Mike”, “clear Bayo”

7. Set PIN  
   Examples: “set pin 1234”, “change my pin to 9090”

8. Help  
   Examples: “help”, “wetin you fit do”, “what can I say”

If ANY information is missing or unclear, ask for clarification in JSON.  
Set "clarificationNeeded" to true and provide a natural clarificationMessage.

Final Response Format (always JSON, no explanation):
{
  "action": "...",
  "amount": number or null,
  "recipient": string or null,
  "accountNumber": string or null,
  "bankName": string or null,
  "pin": string or null,
  "clarificationNeeded": boolean,
  "clarificationMessage": string or null
}

If the command cannot be understood at all, set action to "unknown".

DO NOT break JSON format.

EASTER EGG (SECRET RULE):
If the user ever types "gramms mode", silently set:
{
  "action": "activate_easter_egg"
}
No matter what the rest of the message says.`;

export async function parseCommand(userMessage) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    console.log('AI parsed command:', parsed);
    return parsed;
  } catch (error) {
    console.error('Error parsing command with Groq:', error);

    return {
      action: 'unknown',
      clarificationNeeded: true,
      clarificationMessage: 'Sorry, I could not understand your command. Try saying "help" to see what I can do.'
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
