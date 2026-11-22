import 'dotenv/config';
import bcryptjs from 'bcryptjs';
import { connectDB } from '../src/common/db.connect.js';
import User from '../src/models/userModel.js';

const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@skycomm.com').trim().toLowerCase();
const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const adminName = process.env.SEED_ADMIN_NAME || 'SkyComm Admin';
const adminMobile = process.env.SEED_ADMIN_MOBILE || '9000000001';

await connectDB();

const existing = await User.findOne({ email: adminEmail });
if (existing) {
  existing.role = 'admin';
  existing.approved = true;
  await existing.save();
  console.log(`Admin account already exists and is verified as admin: ${adminEmail}`);
} else {
  const saltRounds = Number(process.env.SALT) || 10;
  const hashedPassword = bcryptjs.hashSync(adminPassword, saltRounds);
  await User.create({
    userName: adminName,
    email: adminEmail,
    mobile: adminMobile,
    password: hashedPassword,
    role: 'admin',
    approved: true,
  });
  console.log(`Seeded admin account: ${adminEmail} (mobile: ${adminMobile})`);
}

process.exit(0);
