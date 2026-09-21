export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class PaymentError extends AppError {
  constructor(message = 'Payment processing failed', code = 'PAYMENT_FAILED') {
    super(message, 400, code);
  }
}

export class WhatsAppError extends AppError {
  constructor(message = 'WhatsApp service error') {
    super(message, 502, 'WHATSAPP_ERROR');
  }
}
