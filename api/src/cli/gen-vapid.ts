import { generateVapidKeys } from '../push/sender.js';

// Prints a fresh VAPID key pair in .env format. Keep the private key secret.
const keys = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
