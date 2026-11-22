import mongoose from '../common/db.connect.js';

const gstInvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true }, // e.g., "SKYDPM / 410 / 26-27"
    sequenceNumber: { type: Number, required: true },
    financialYear: { type: String, required: true }, // e.g., "26-27"
    invoiceDate: { type: Date, required: true, default: () => new Date() },
    billingPeriodStart: { type: Date, default: null },
    billingPeriodEnd: { type: Date, default: null },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    invoiceType: {
      type: String,
      enum: ['monthly', 'service', 'custom'],
      default: 'monthly',
    },

    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'customer', required: true },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'collection', default: null },
    serviceChargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'serviceCharge', default: null },

    seller: {
      companyName: String,
      addressLine1: String,
      addressLine2: String,
      addressLine3: String,
      stateCode: String,
      gstin: String,
      pan: String,
      contact: String,
      email: String,
      bankName: String,
      accountNumber: String,
      branchAndIfsc: String,
      declaration: String,
    },

    buyer: {
      companyName: String,
      contactName: String,
      mobile: String,
      email: String,
      address: String,
      gstin: String,
      stateCode: String,
    },

    items: [
      {
        particulars: { type: String, required: true },
        periodLabel: { type: String, default: '' },
        hsnSac: { type: String, default: '998422' },
        quantity: { type: Number, default: 1 },
        rate: { type: Number, required: true },
        amount: { type: Number, required: true },
      },
    ],

    taxableValue: { type: Number, required: true },
    gstRate: { type: Number, default: 18 },
    isInterState: { type: Boolean, default: false },
    cgstRate: { type: Number, default: 9 },
    cgstAmount: { type: Number, default: 0 },
    sgstRate: { type: Number, default: 9 },
    sgstAmount: { type: Number, default: 0 },
    igstRate: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    totalTax: { type: Number, required: true },
    grandTotal: { type: Number, required: true },

    amountInWords: { type: String, default: '' },
    taxInWords: { type: String, default: '' },

    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ['Unpaid', 'Partial', 'Paid'],
      default: 'Unpaid',
    },
    paymentMode: { type: String, enum: ['cash', 'online', 'unpaid'], default: 'unpaid' },
    transactionId: { type: String, default: null },
    paidAt: { type: Date, default: null },

    isCancelled: { type: Boolean, default: false },
    cancelReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

gstInvoiceSchema.index({ financialYear: 1, sequenceNumber: 1 }, { unique: true });
gstInvoiceSchema.index({ customerId: 1, invoiceDate: -1 });
gstInvoiceSchema.index({ year: -1, month: -1 });
gstInvoiceSchema.index({ paymentStatus: 1, isCancelled: 1 });

const GstInvoice = mongoose.model('gstInvoice', gstInvoiceSchema);

export default GstInvoice;
