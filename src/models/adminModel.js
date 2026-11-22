import mongoose from '../common/db.connect.js';

const adminSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    collectionAmount: { type: Number, required: true },
    subscriptionAmount: { type: Number, default: 0 },
    serviceAmount: { type: Number, default: 0 },
    advanceAmount: { type: Number, default: 0 },
    collectionDate: { type: Date, required: true },
    status: { type: String, enum: ['Pending', 'Recieved'], default: 'Pending' },
    expenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'expense', default: null },
    expenseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'expense' }],
    recievedAmount: { type: Number, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

adminSchema.index({ userId: 1, collectionDate: -1 });
adminSchema.index({ status: 1, createdAt: -1 });

const Admin = mongoose.model('admin', adminSchema);

export default Admin;
