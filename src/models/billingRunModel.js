import mongoose from '../common/db.connect.js';

const billingRunSchema = new mongoose.Schema(
  {
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    runType: { type: String, enum: ['manual', 'cron', 'single'], default: 'manual' },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null },
    triggeredByName: { type: String, default: 'System Cron' },
    status: { type: String, enum: ['completed', 'partial', 'failed'], default: 'completed' },

    totalCustomersChecked: { type: Number, default: 0 },
    regularBillsCreated: { type: Number, default: 0 },
    gstBillsCreated: { type: Number, default: 0 },
    totalBillsCreated: { type: Number, default: 0 },
    skippedAlreadyBilled: { type: Number, default: 0 },
    skippedInactive: { type: Number, default: 0 },
    skippedNoPlan: { type: Number, default: 0 },
    markedOverdueCount: { type: Number, default: 0 },

    totalBaseAmount: { type: Number, default: 0 },
    totalGstAmount: { type: Number, default: 0 },
    totalBilledAmount: { type: Number, default: 0 },
    totalAdvanceApplied: { type: Number, default: 0 },
    netNewDueAmount: { type: Number, default: 0 },

    invoiceRangeStart: { type: String, default: null },
    invoiceRangeEnd: { type: String, default: null },
    notes: { type: String, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

billingRunSchema.index({ year: -1, month: -1, createdAt: -1 });

const BillingRun = mongoose.model('billingRun', billingRunSchema);

export default BillingRun;
