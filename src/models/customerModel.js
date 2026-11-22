import mongoose from '../common/db.connect.js';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    mobile: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'plan' },
    address: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['active', 'suspended', 'disconnected'],
      default: 'active',
    },
    // GST Billing Profile
    isGstCustomer: { type: Boolean, default: false },
    companyName: { type: String, trim: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },
    billingAddress: { type: String, trim: true, default: '' },
    stateCode: { type: String, trim: true, default: '33' },
    gstRate: { type: Number, default: 18 },
    hsnSac: { type: String, trim: true, default: '998422' },

    advanceAmount: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    transactions: [
      {
        date: { type: Date, default: () => new Date() },
        type: {
          type: String,
          enum: ['due', 'payment', 'advance', 'remainbalance', 'reversal', 'service'],
          required: true,
        },
        amount: { type: Number, required: true },
        collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
        note: { type: String, default: null },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

customerSchema.index({ status: 1 });
customerSchema.index({ planId: 1 });
customerSchema.index({ mobile: 1 });
customerSchema.index({ isGstCustomer: 1 });
customerSchema.index({ 'transactions.date': -1 });

const Customer = mongoose.model('customer', customerSchema);

export default Customer;
