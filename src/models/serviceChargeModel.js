import mongoose from '../common/db.connect.js';

const serviceChargeSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'customer', required: true },
    serviceName: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    hsnSac: { type: String, trim: true, default: '998422' },
    baseAmount: { type: Number, required: true },
    isGstApplicable: { type: Boolean, default: false },
    gstRate: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    paymentStatus: { type: String, enum: ['Paid', 'Pending'], default: 'Pending' },
    paymentMode: { type: String, enum: ['cash', 'online', 'unpaid'], default: 'unpaid' },
    transactionId: { type: String, default: null },
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'collection', default: null },
    gstInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'gstInvoice', default: null },
    invoiceNumber: { type: String, default: null },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    serviceDate: { type: Date, default: () => new Date() },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

serviceChargeSchema.index({ customerId: 1, serviceDate: -1 });
serviceChargeSchema.index({ paymentStatus: 1, serviceDate: -1 });

const ServiceCharge = mongoose.model('serviceCharge', serviceChargeSchema);

export default ServiceCharge;
