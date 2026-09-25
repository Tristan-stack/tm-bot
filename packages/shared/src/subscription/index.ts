/**
 * Subscription domain (§8, V1-27, V1-28): the catalogue and the pure rules. The database side
 * (activation, invoices, expiry, reads) lives in @launchbot/db.
 */
export { computeExpectedLamports, formatSolUsdRate, invoiceSol } from "./amounts.js";
export { classifyDeposit, isWatchable, mayMoveDeposit, type DepositCase } from "./deposits.js";
export { getPlanFeatures, type PlanFeatures } from "./features.js";
export {
  acceptanceDeadline,
  decideInvoice,
  effectiveStatus,
  isPaid,
  PAYMENT_STATUSES,
  type InvoiceDecision,
  type InvoiceReportKind,
  type PaymentStatus,
} from "./invoice.js";
export {
  getOffer,
  listOffers,
  OFFER_CODES,
  parseOfferCode,
  type Offer,
  type OfferCode,
} from "./offers.js";
export { buildPaymentReceivedScreen } from "./payment-received.js";
export { buildReminderScreen, reminderLeadMs } from "./reminder.js";
export {
  ACTIVATION_KINDS,
  computeActivation,
  decidePurchase,
  type ActivationKind,
  type ActivationMode,
  type ComputedActivation,
  type PurchaseDecision,
  type SubscriptionPeriod,
} from "./rules.js";
export { planLabel, type PlanStatus } from "./status.js";
