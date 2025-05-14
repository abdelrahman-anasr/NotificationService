
require('dotenv').config(); 

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function log(level, message, data) {
  const levels = ['debug', 'info', 'warn', 'error'];
  const currentLogLevel = process.env.LOG_LEVEL || 'info';

  if (levels.indexOf(level) >= levels.indexOf(currentLogLevel)) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }
}

function debug(message, data) {
  log('debug', message, data);
}

function info(message, data) {
  log('info', message, data);
}

function warn(message, data) {
  log('warn', message, data);
}

function error(message, data) {
  log('error', message, data instanceof Error ? { message: data.message, stack: data.stack } : data);
}

async function logNotification(type, recipient, status, message) {
  try {
    await prisma.notification.create({
      data: {
        type,
        recipient,
        status,
        message,
      },
    });
    info(`[Database] Notification logged: ${type} to ${recipient}`);
  } catch (err) {
    error('[Database] Failed to log notification:', { message: err.message, stack: err.stack });
  }
}

module.exports = { debug, info, warn, error, logNotification };