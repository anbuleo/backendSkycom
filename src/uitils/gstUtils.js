import CompanySettings from '../models/companySettingsModel.js';
import InvoiceCounter from '../models/invoiceCounterModel.js';

export const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

/**
 * Indian Financial Year (April 1 to March 31)
 * e.g. Nov 2026 -> "26-27", Feb 2027 -> "26-27", Apr 2027 -> "27-28"
 */
export const getFinancialYear = (dateInput = new Date()) => {
  const date = new Date(dateInput);
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  const fy = `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
  return { fy, startYear, endYear };
};

export const extractStateCodeFromGstin = (gstin, fallback = '33') => {
  const clean = String(gstin || '').trim().toUpperCase();
  if (/^\d{2}/.test(clean)) return clean.slice(0, 2);
  return fallback;
};

export const isValidGstin = (gstin) => {
  const clean = String(gstin || '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(clean);
};

export const calculateGstBreakdown = ({
  taxableValue,
  gstRate = 18,
  buyerStateCode = '33',
  sellerStateCode = '33',
}) => {
  const base = round2(Math.max(0, Number(taxableValue) || 0));
  const rate = Math.max(0, Number(gstRate) || 0);
  const isInterState =
    Boolean(buyerStateCode) &&
    Boolean(sellerStateCode) &&
    String(buyerStateCode).trim() !== String(sellerStateCode).trim();

  if (rate === 0) {
    return {
      taxableValue: base,
      gstRate: 0,
      isInterState,
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: 0,
      igstAmount: 0,
      totalTax: 0,
      grandTotal: base,
    };
  }

  if (isInterState) {
    const igstAmount = round2((base * rate) / 100);
    return {
      taxableValue: base,
      gstRate: rate,
      isInterState: true,
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: rate,
      igstAmount,
      totalTax: igstAmount,
      grandTotal: round2(base + igstAmount),
    };
  }

  const halfRate = round2(rate / 2);
  const cgstAmount = round2((base * halfRate) / 100);
  const sgstAmount = round2((base * halfRate) / 100);
  const totalTax = round2(cgstAmount + sgstAmount);
  return {
    taxableValue: base,
    gstRate: rate,
    isInterState: false,
    cgstRate: halfRate,
    cgstAmount,
    sgstRate: halfRate,
    sgstAmount,
    igstRate: 0,
    igstAmount: 0,
    totalTax,
    grandTotal: round2(base + totalTax),
  };
};

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

const twoDigitsToWords = (n) => {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]} ${ONES[o]}` : TENS[t];
};

const intToIndianWords = (num) => {
  const n = Math.floor(Math.abs(num));
  if (n === 0) return 'Zero';

  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;

  if (crore) parts.push(`${intToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) {
    parts.push(parts.length > 0 ? `and ${twoDigitsToWords(rest)}` : twoDigitsToWords(rest));
  }

  return parts.join(' ');
};

export const numberToIndianWords = (amount) => {
  const safe = round2(Math.max(0, Number(amount) || 0));
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);

  let result = `INR ${intToIndianWords(rupees)}`;
  if (paise > 0) {
    result += ` and ${twoDigitsToWords(paise)} Paise`;
  }
  return `${result} Only`;
};

export const formatDDMMYYYY = (dateInput) => {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

export const getMonthPeriodBounds = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const periodLabel = `(${formatDDMMYYYY(start)} to ${formatDDMMYYYY(end)})`;
  return { start, end, periodLabel };
};

export const getOrCreateCompanySettings = async () => {
  let settings = await CompanySettings.findOne({ key: 'primary' }).lean();
  if (!settings) {
    const created = await CompanySettings.create({ key: 'primary' });
    settings = created.toObject();
  }
  return settings;
};

/**
 * Atomically allocates the next sequential invoice number for a Financial Year.
 * Resets automatically to 1 when a new Financial Year begins on April 1.
 */
export const allocateNextInvoiceNumber = async (invoiceDate = new Date(), prefixOverride) => {
  const { fy } = getFinancialYear(invoiceDate);
  const settings = await getOrCreateCompanySettings();
  const prefix = (prefixOverride || settings.invoicePrefix || 'SKYDPM').trim().toUpperCase();

  const counter = await InvoiceCounter.findOneAndUpdate(
    { financialYear: fy },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const seqNum = counter.seq;
  const formattedSeq = String(seqNum).padStart(3, '0');
  const invoiceNumber = `${prefix} / ${formattedSeq} / ${fy}`;

  return {
    invoiceNumber,
    sequenceNumber: seqNum,
    financialYear: fy,
    settings,
  };
};
