import mongoose from '../common/db.connect.js';

const invoiceCounterSchema = new mongoose.Schema(
  {
    financialYear: { type: String, required: true, unique: true }, // e.g., "26-27"
    seq: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const InvoiceCounter = mongoose.model('invoiceCounter', invoiceCounterSchema);

export default InvoiceCounter;
