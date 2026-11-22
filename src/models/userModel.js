import mongoose from '../common/db.connect.js';

const userSchema = new mongoose.Schema(
  {
    userName: { type: String, required: true, unique: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['staff', 'admin'], default: 'staff' },
    approved: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

userSchema.index({ role: 1, approved: 1 });

const User = mongoose.model('user', userSchema);

export default User;
