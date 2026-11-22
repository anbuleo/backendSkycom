import mongoose from '../common/db.connect.js';

const expenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    amount: { type: Number, required: true },
    remarks: { type: String, required: true, trim: true },
    status: { type: String, enum: ['claimed', 'unclaimed'], default: 'unclaimed' },
    date: { type: Date, default: () => new Date() },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

expenseSchema.index({ userId: 1, status: 1, date: -1 });

const Expense = mongoose.model('expense', expenseSchema);

export default Expense;
