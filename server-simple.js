#!/usr/bin/env node

// ============================================================
// GramPay Server Entry Point
// ============================================================
// This is the SOLE entry point for the application.
// It imports ./server/index.js which bootstraps:
//   - Express API
//   - WhatsApp service (single Baileys initializer)
//   - All business logic
//
// Do NOT import ./index.standalone.js here.
// ============================================================

import('./server/index.js').catch(err => {
  console.error('❌ Fatal server error:', err.message);
  console.error(err.stack);
  // Keep process alive even if there's an error
  setInterval(() => {}, 1000);
});

// Ensure process stays alive
setInterval(() => {
  // Keep-alive interval
}, 60000);

// Handle all errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  // Don't exit
});
