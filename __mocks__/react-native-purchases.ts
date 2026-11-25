// Manual mock: the native RevenueCat module is not available under jest.
export const PURCHASES_ERROR_CODE = {
  UNKNOWN_ERROR: "0",
  PURCHASE_CANCELLED_ERROR: "1",
  STORE_PROBLEM_ERROR: "2",
  PURCHASE_NOT_ALLOWED_ERROR: "3",
  RECEIPT_ALREADY_IN_USE_ERROR: "7",
  PAYMENT_PENDING_ERROR: "20",
} as const;

export enum LOG_LEVEL {
  VERBOSE = "VERBOSE",
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

const Purchases = {
  configure: jest.fn(),
  logIn: jest.fn(async () => ({ customerInfo: {}, created: false })),
  logOut: jest.fn(async () => ({})),
  getOfferings: jest.fn(async () => ({ current: null, all: {} })),
  purchasePackage: jest.fn(async () => ({ customerInfo: {} })),
  restorePurchases: jest.fn(async () => ({})),
  presentCodeRedemptionSheet: jest.fn(async () => {}),
  isConfigured: jest.fn(async () => false),
  setLogLevel: jest.fn(),
};

export default Purchases;
