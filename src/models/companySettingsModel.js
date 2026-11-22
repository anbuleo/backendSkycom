import mongoose from '../common/db.connect.js';

const companySettingsSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'primary' },
    companyName: { type: String, default: 'Sky Communications Internet Services' },
    addressLine1: { type: String, default: 'B.No:204, R.No:116, MC Complex,' },
    addressLine2: { type: String, default: 'Udumalai Road, Dharapuram-638656' },
    addressLine3: { type: String, default: 'Tirupur District, Tamilnadu, code : 33' },
    stateCode: { type: String, default: '33' },
    gstin: { type: String, default: '33FHVPS4167K1ZF' },
    pan: { type: String, default: 'FHVPS4167K' },
    contact: { type: String, default: '9655344226' },
    email: { type: String, default: 'skycommunicationsdpm@gmail.com' },
    bankName: { type: String, default: 'State Bank of India' },
    accountNumber: { type: String, default: '39113740698' },
    branchAndIfsc: { type: String, default: 'Dharapuram & SBIN0000831' },
    invoicePrefix: { type: String, default: 'SKYDPM' },
    defaultHsnSac: { type: String, default: '998422' },
    defaultGstRate: { type: Number, default: 18 },
    declaration: {
      type: String,
      default:
        'We declare that this invoice shows the actual price of the good described and that all particulars are true and correct.',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const CompanySettings = mongoose.model('companySettings', companySettingsSchema);

export default CompanySettings;
