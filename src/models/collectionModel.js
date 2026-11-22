import mongoose from '../common/db.connect.js';

const collectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'customer', required: true },
    billType: {
      type: String,
      enum: ['monthly', 'service', 'custom'],
      default: 'monthly',
    },
    description: { type: String, default: '' },
    isGstBill: { type: Boolean, default: false },
    gstInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'gstInvoice',
      default: null,
    },
    invoiceNumber: { type: String, default: null },
    serviceChargeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'serviceCharge',
      default: null,
    },
    taxableAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    amountDue: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    dueDate: { type: Date, default: Date.now },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    status: { type: String, enum: ['Pending', 'Paid', 'Overdue'], default: 'Pending' },
    paymentMode: { type: String, enum: ['cash', 'online'], default: 'cash' },
    transactionId: { type: String, default: null },
    payments: [
      {
        amount: { type: Number, required: true },
        paymentMode: { type: String, enum: ['cash', 'online'], default: 'cash' },
        transactionId: { type: String, default: null },
        collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        date: { type: Date, default: () => new Date() },
        reversed: { type: Boolean, default: false },
        reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null },
        reversedAt: { type: Date, default: null },
        reversalReason: { type: String, default: null },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Unique per customer+month+year ONLY for monthly subscription bills (allows service/custom bills in the same month!)
collectionSchema.index(
  { customerId: 1, month: 1, year: 1, billType: 1 },
  { unique: true, partialFilterExpression: { billType: 'monthly' } }
);
collectionSchema.index({ month: 1, year: 1, status: 1 });
collectionSchema.index({ userId: 1, year: -1, month: -1 });
collectionSchema.index({ gstInvoiceId: 1 });

const Collection = mongoose.model('collection', collectionSchema);

export default Collection;
