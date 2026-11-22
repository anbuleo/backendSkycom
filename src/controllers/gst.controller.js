import GstInvoice from '../models/gstInvoiceModel.js';
import Collection from '../models/collectionModel.js';
import Customer from '../models/customerModel.js';
import Plan from '../models/planModel.js';
import CompanySettings from '../models/companySettingsModel.js';
import InvoiceCounter from '../models/invoiceCounterModel.js';
import { errorHandler } from '../uitils/errorHandler.js';
import {
  allocateNextInvoiceNumber,
  calculateGstBreakdown,
  extractStateCodeFromGstin,
  formatDDMMYYYY,
  getFinancialYear,
  getMonthPeriodBounds,
  getOrCreateCompanySettings,
  numberToIndianWords,
  round2,
} from '../uitils/gstUtils.js';
import XLSX from 'xlsx';
import { runMonthlyBillingGeneration } from './collection.controller.js';

export const createGstInvoiceInternal = async ({
  customer,
  items,
  invoiceDate = new Date(),
  billingPeriodStart = null,
  billingPeriodEnd = null,
  invoiceType = 'monthly',
  gstRateOverride,
  collectionId = null,
  serviceChargeId = null,
  initialAmountPaid = 0,
  initialPaymentMode = 'unpaid',
  initialTransactionId = null,
  createdBy = null,
}) => {
  const dateObj = new Date(invoiceDate);
  const month = dateObj.getMonth() + 1;
  const year = dateObj.getFullYear();

  const { invoiceNumber, sequenceNumber, financialYear, settings } =
    await allocateNextInvoiceNumber(dateObj);

  const normalizedItems = items.map((item) => {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const rate = round2(Number(item.rate) || 0);
    const amount = round2(item.amount !== undefined ? Number(item.amount) : qty * rate);
    return {
      particulars: String(item.particulars || 'Bandwidth Charges').trim(),
      periodLabel: item.periodLabel || '',
      hsnSac: String(item.hsnSac || customer.hsnSac || settings.defaultHsnSac || '998422').trim(),
      quantity: qty,
      rate,
      amount,
    };
  });

  const taxableValue = round2(normalizedItems.reduce((sum, it) => sum + it.amount, 0));
  const gstRate =
    gstRateOverride !== undefined
      ? Number(gstRateOverride)
      : Number(customer.gstRate ?? settings.defaultGstRate ?? 18);

  const buyerStateCode = extractStateCodeFromGstin(
    customer.gstin,
    customer.stateCode || settings.stateCode || '33'
  );
  const sellerStateCode = settings.stateCode || '33';

  const tax = calculateGstBreakdown({
    taxableValue,
    gstRate,
    buyerStateCode,
    sellerStateCode,
  });

  const paid = round2(Math.min(tax.grandTotal, Math.max(0, Number(initialAmountPaid) || 0)));
  const balanceDue = round2(Math.max(0, tax.grandTotal - paid));
  const paymentStatus = balanceDue === 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';

  const invoice = await GstInvoice.create({
    invoiceNumber,
    sequenceNumber,
    financialYear,
    invoiceDate: dateObj,
    billingPeriodStart,
    billingPeriodEnd,
    month,
    year,
    invoiceType,
    customerId: customer._id,
    collectionId,
    serviceChargeId,
    seller: {
      companyName: settings.companyName,
      addressLine1: settings.addressLine1,
      addressLine2: settings.addressLine2,
      addressLine3: settings.addressLine3,
      stateCode: settings.stateCode,
      gstin: settings.gstin,
      pan: settings.pan,
      contact: settings.contact,
      email: settings.email,
      bankName: settings.bankName,
      accountNumber: settings.accountNumber,
      branchAndIfsc: settings.branchAndIfsc,
      declaration: settings.declaration,
    },
    buyer: {
      companyName: customer.companyName || customer.name,
      contactName: customer.name,
      mobile: customer.mobile || '',
      email: customer.email || '',
      address: customer.billingAddress || customer.address || '',
      gstin: customer.gstin || '',
      stateCode: buyerStateCode,
    },
    items: normalizedItems,
    ...tax,
    amountInWords: numberToIndianWords(tax.grandTotal),
    taxInWords: numberToIndianWords(tax.totalTax),
    amountPaid: paid,
    balanceDue,
    paymentStatus,
    paymentMode: paid > 0 ? initialPaymentMode || 'cash' : 'unpaid',
    transactionId: paid > 0 ? initialTransactionId : null,
    paidAt: paymentStatus === 'Paid' ? new Date() : null,
    createdBy,
  });

  return invoice;
};

const getCompanySettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateCompanySettings();
    const { fy } = getFinancialYear(new Date());
    const counter = await InvoiceCounter.findOne({ financialYear: fy }).lean();
    const counters = await InvoiceCounter.find().sort({ financialYear: -1 }).lean();

    res.status(200).json({
      success: true,
      settings,
      currentFinancialYear: fy,
      currentSequence: counter?.seq || 0,
      nextInvoicePreview: `${settings.invoicePrefix || 'SKYDPM'} / ${String(
        (counter?.seq || 0) + 1
      ).padStart(3, '0')} / ${fy}`,
      counters,
    });
  } catch (error) {
    next(error);
  }
};

const updateCompanySettings = async (req, res, next) => {
  try {
    await getOrCreateCompanySettings();

    const allowedFields = [
      'companyName',
      'addressLine1',
      'addressLine2',
      'addressLine3',
      'stateCode',
      'gstin',
      'pan',
      'contact',
      'email',
      'bankName',
      'accountNumber',
      'branchAndIfsc',
      'invoicePrefix',
      'defaultHsnSac',
      'defaultGstRate',
      'declaration',
    ];

    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] =
          field === 'defaultGstRate'
            ? Number(req.body[field])
            : String(req.body[field]).trim();
      }
    });

    if (updates.invoicePrefix) {
      updates.invoicePrefix = updates.invoicePrefix.toUpperCase();
    }
    if (updates.gstin) {
      updates.gstin = updates.gstin.toUpperCase();
      if (!updates.stateCode && /^\d{2}/.test(updates.gstin)) {
        updates.stateCode = updates.gstin.slice(0, 2);
      }
    }

    const updated = await CompanySettings.findOneAndUpdate(
      { key: 'primary' },
      { $set: updates },
      { new: true, upsert: true }
    ).lean();

    // Optional: set starting sequence number for the current Financial Year (e.g., migrating from invoice #410)
    const { fy } = getFinancialYear(new Date());
    if (req.body.currentSequence !== undefined && req.body.currentSequence !== '') {
      const requestedSeq = Number(req.body.currentSequence);
      if (!Number.isInteger(requestedSeq) || requestedSeq < 0) {
        return next(errorHandler(400, 'Sequence number must be a non-negative whole number'));
      }

      const highestExisting = await GstInvoice.findOne({ financialYear: fy })
        .sort({ sequenceNumber: -1 })
        .select('sequenceNumber')
        .lean();

      if (highestExisting && requestedSeq < highestExisting.sequenceNumber) {
        return next(
          errorHandler(
            400,
            `Cannot set FY ${fy} sequence below existing highest invoice #${highestExisting.sequenceNumber}`
          )
        );
      }

      await InvoiceCounter.findOneAndUpdate(
        { financialYear: fy },
        { $set: { seq: requestedSeq } },
        { upsert: true, new: true }
      );
    }

    const counter = await InvoiceCounter.findOne({ financialYear: fy }).lean();

    res.status(200).json({
      success: true,
      message: 'Company GST & invoice settings updated successfully',
      settings: updated,
      currentFinancialYear: fy,
      currentSequence: counter?.seq || 0,
      nextInvoicePreview: `${updated.invoicePrefix || 'SKYDPM'} / ${String(
        (counter?.seq || 0) + 1
      ).padStart(3, '0')} / ${fy}`,
    });
  } catch (error) {
    next(error);
  }
};

const listGstInvoices = async (req, res, next) => {
  try {
    const { fy, month, year, customerId, paymentStatus, search, includeCancelled } = req.query;
    const filter = {};

    if (fy && fy !== 'all') filter.financialYear = fy;
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);
    if (customerId) filter.customerId = customerId;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
    if (includeCancelled !== 'true') {
      // By default include cancelled invoices in table so sequence audit is visible, unless filtered out
    }

    if (search && String(search).trim()) {
      const escaped = String(search)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { invoiceNumber: rx },
        { 'buyer.companyName': rx },
        { 'buyer.contactName': rx },
        { 'buyer.gstin': rx },
      ];
    }

    const [invoices, distinctFYs, availableMonths] = await Promise.all([
      GstInvoice.find(filter)
        .populate('customerId', 'name mobile companyName gstin')
        .sort({ financialYear: -1, sequenceNumber: -1 })
        .lean(),
      GstInvoice.distinct('financialYear'),
      GstInvoice.aggregate([
        {
          $match: {
            isCancelled: { $ne: true },
            ...(fy && fy !== 'all' ? { financialYear: fy } : {}),
          },
        },
        {
          $group: {
            _id: { year: '$year', month: '$month' },
            count: { $sum: 1 },
            totalGrand: { $sum: '$grandTotal' },
            totalPaid: { $sum: '$amountPaid' },
            totalPending: { $sum: '$balanceDue' },
          },
        },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        {
          $project: {
            _id: 0,
            year: '$_id.year',
            month: '$_id.month',
            count: 1,
            totalGrand: { $round: ['$totalGrand', 2] },
            totalPaid: { $round: ['$totalPaid', 2] },
            totalPending: { $round: ['$totalPending', 2] },
          },
        },
      ]),
    ]);

    const activeInvoices = invoices.filter((inv) => !inv.isCancelled);
    const summary = activeInvoices.reduce(
      (acc, inv) => {
        acc.totalInvoices += 1;
        acc.totalTaxable = round2(acc.totalTaxable + (Number(inv.taxableValue) || 0));
        acc.totalCgst = round2(acc.totalCgst + (Number(inv.cgstAmount) || 0));
        acc.totalSgst = round2(acc.totalSgst + (Number(inv.sgstAmount) || 0));
        acc.totalIgst = round2(acc.totalIgst + (Number(inv.igstAmount) || 0));
        acc.totalTax = round2(acc.totalTax + (Number(inv.totalTax) || 0));
        acc.totalGrand = round2(acc.totalGrand + (Number(inv.grandTotal) || 0));
        acc.totalPaid = round2(acc.totalPaid + (Number(inv.amountPaid) || 0));
        acc.totalPending = round2(acc.totalPending + (Number(inv.balanceDue) || 0));
        return acc;
      },
      {
        totalInvoices: 0,
        totalTaxable: 0,
        totalCgst: 0,
        totalSgst: 0,
        totalIgst: 0,
        totalTax: 0,
        totalGrand: 0,
        totalPaid: 0,
        totalPending: 0,
      }
    );

    const { fy: currentFY } = getFinancialYear(new Date());
    const availableFYs = [...new Set([currentFY, ...distinctFYs])].sort().reverse();

    res.status(200).json({
      success: true,
      invoices,
      summary,
      currentFinancialYear: currentFY,
      availableFYs,
      availableMonths,
    });
  } catch (error) {
    next(error);
  }
};

const getGstInvoiceById = async (req, res, next) => {
  try {
    const invoice = await GstInvoice.findById(req.params.id)
      .populate('customerId', 'name mobile companyName gstin address billingAddress')
      .populate('collectionId')
      .lean();

    if (!invoice) return next(errorHandler(404, 'GST Invoice not found'));

    res.status(200).json({ success: true, invoice });
  } catch (error) {
    next(error);
  }
};

const createManualGstInvoice = async (req, res, next) => {
  try {
    const {
      customerId,
      invoiceDate,
      invoiceType = 'custom',
      month,
      year,
      billingPeriodStart,
      billingPeriodEnd,
      items,
      gstRate,
      addToCollection = true,
    } = req.body;

    if (!customerId) return next(errorHandler(400, 'Please select a customer'));

    const customer = await Customer.findById(customerId);
    if (!customer) return next(errorHandler(404, 'Customer not found'));

    const invDate = invoiceDate ? new Date(invoiceDate) : new Date();
    const billMonth = Number(month) || invDate.getMonth() + 1;
    const billYear = Number(year) || invDate.getFullYear();

    let periodStart = billingPeriodStart ? new Date(billingPeriodStart) : null;
    let periodEnd = billingPeriodEnd ? new Date(billingPeriodEnd) : null;
    let periodLabel = '';

    if (periodStart && periodEnd) {
      periodLabel = `(${formatDDMMYYYY(periodStart)} to ${formatDDMMYYYY(periodEnd)})`;
    } else if (invoiceType === 'monthly') {
      const bounds = getMonthPeriodBounds(billYear, billMonth);
      periodStart = bounds.start;
      periodEnd = bounds.end;
      periodLabel = bounds.periodLabel;
    }

    let invoiceItems = Array.isArray(items) && items.length > 0 ? items : [];

    // If monthly invoice without explicit items, auto-fill from subscriber's assigned plan
    if (invoiceItems.length === 0) {
      const plan = customer.planId ? await Plan.findById(customer.planId).lean() : null;
      if (!plan) {
        return next(
          errorHandler(400, 'Please provide at least one line item or assign a plan to this customer')
        );
      }
      invoiceItems = [
        {
          particulars: `Bandwidth Charges${plan.name ? ` - ${plan.name}` : ''}`,
          periodLabel,
          hsnSac: customer.hsnSac || '998422',
          quantity: 1,
          rate: plan.amount,
          amount: plan.amount,
        },
      ];
    } else {
      invoiceItems = invoiceItems.map((it) => ({
        ...it,
        periodLabel: it.periodLabel || periodLabel,
      }));
    }

    // Validate all line item amounts
    for (const it of invoiceItems) {
      const amt = Number(it.amount ?? (Number(it.quantity) || 1) * (Number(it.rate) || 0));
      if (!it.particulars?.trim() || !Number.isFinite(amt) || amt <= 0) {
        return next(errorHandler(400, 'Each line item requires a description and positive amount'));
      }
    }

    // Create invoice first with atomic FY sequence number
    const invoice = await createGstInvoiceInternal({
      customer,
      items: invoiceItems,
      invoiceDate: invDate,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      invoiceType,
      gstRateOverride: gstRate !== undefined && gstRate !== '' ? Number(gstRate) : undefined,
      createdBy: req.user.id,
    });

    // Link into Collection & Customer balance so payment collection stays 100% end-to-end
    if (addToCollection) {
      const availableAdvance = Math.max(0, Number(customer.advanceAmount) || 0);
      const advanceUsed = round2(Math.min(availableAdvance, invoice.grandTotal));
      const dueAfterAdvance = round2(Math.max(0, invoice.grandTotal - advanceUsed));

      const billTypeForCollection =
        invoiceType === 'monthly'
          ? (await Collection.findOne({
              customerId: customer._id,
              month: billMonth,
              year: billYear,
              billType: 'monthly',
            }))
            ? 'custom'
            : 'monthly'
          : invoiceType;

      const collection = await Collection.create({
        userId: req.user.id,
        customerId: customer._id,
        billType: billTypeForCollection,
        description: invoiceItems.map((i) => i.particulars).join(', '),
        isGstBill: true,
        gstInvoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        taxableAmount: invoice.taxableValue,
        taxAmount: invoice.totalTax,
        amountDue: dueAfterAdvance,
        amountPaid: advanceUsed,
        dueDate: new Date(billYear, billMonth - 1, 10),
        month: billMonth,
        year: billYear,
        status: dueAfterAdvance === 0 ? 'Paid' : 'Pending',
      });

      invoice.collectionId = collection._id;
      if (advanceUsed > 0) {
        invoice.amountPaid = advanceUsed;
        invoice.balanceDue = dueAfterAdvance;
        invoice.paymentStatus = dueAfterAdvance === 0 ? 'Paid' : 'Partial';
        invoice.paymentMode = 'cash';
        if (dueAfterAdvance === 0) invoice.paidAt = new Date();
      }
      await invoice.save();

      customer.advanceAmount = round2(availableAdvance - advanceUsed);
      customer.remainingBalance = round2((Number(customer.remainingBalance) || 0) + dueAfterAdvance);
      customer.transactions.push({
        type: 'due',
        amount: invoice.grandTotal,
        collectedBy: req.user.id,
        note: `GST Invoice ${invoice.invoiceNumber}`,
      });
      await customer.save();
    }

    res.status(201).json({
      success: true,
      message: `GST Invoice ${invoice.invoiceNumber} created successfully`,
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

const recordGstInvoicePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paidAmount = round2(Number(req.body.amountPaid));
    const mode = req.body.paymentMode || 'online';
    const trimmedTxnId = req.body.transactionId ? String(req.body.transactionId).trim() : null;

    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return next(errorHandler(400, 'Payment amount must be greater than 0'));
    }
    if (!['cash', 'online'].includes(mode)) {
      return next(errorHandler(400, 'Invalid payment mode'));
    }
    if (mode === 'online' && !trimmedTxnId) {
      return next(errorHandler(400, 'Transaction / UTR ID is required for online payments'));
    }

    const invoice = await GstInvoice.findById(id);
    if (!invoice) return next(errorHandler(404, 'GST Invoice not found'));
    if (invoice.isCancelled) {
      return next(errorHandler(400, 'Cannot record payment on a cancelled invoice'));
    }
    if (invoice.paymentStatus === 'Paid' && invoice.balanceDue <= 0) {
      return next(errorHandler(400, 'This GST invoice is already fully paid'));
    }

    const customer = await Customer.findById(invoice.customerId);
    if (!customer) return next(errorHandler(404, 'Customer not found'));

    const remainingAfter = round2(Number(invoice.balanceDue) - paidAmount);
    const appliedToInvoice = round2(Math.min(Number(invoice.balanceDue), paidAmount));
    const extraAdvance = remainingAfter < 0 ? round2(Math.abs(remainingAfter)) : 0;

    invoice.amountPaid = round2((Number(invoice.amountPaid) || 0) + appliedToInvoice);
    invoice.balanceDue = round2(Math.max(0, remainingAfter));
    invoice.paymentStatus = invoice.balanceDue === 0 ? 'Paid' : 'Partial';
    invoice.paymentMode = mode;
    invoice.transactionId = mode === 'online' ? trimmedTxnId : null;
    if (invoice.balanceDue === 0) {
      invoice.paidAt = new Date();
    }
    await invoice.save();

    // Sync linked Collection record if present
    if (invoice.collectionId) {
      const col = await Collection.findById(invoice.collectionId);
      if (col) {
        col.amountPaid = round2((Number(col.amountPaid) || 0) + paidAmount);
        col.amountDue = invoice.balanceDue;
        col.status = invoice.balanceDue === 0 ? 'Paid' : 'Pending';
        col.paymentMode = mode;
        col.transactionId = mode === 'online' ? trimmedTxnId : null;
        col.userId = req.user.id;
        col.payments.push({
          amount: paidAmount,
          paymentMode: mode,
          transactionId: mode === 'online' ? trimmedTxnId : null,
          collectedBy: req.user.id,
          date: new Date(),
        });
        await col.save();
      }
    }

    // Sync Customer balances & ledger
    customer.remainingBalance = round2(
      Math.max(0, (Number(customer.remainingBalance) || 0) - appliedToInvoice)
    );
    if (extraAdvance > 0) {
      customer.advanceAmount = round2((Number(customer.advanceAmount) || 0) + extraAdvance);
    }
    customer.transactions.push({
      type: 'payment',
      amount: paidAmount,
      collectedBy: req.user.id,
      note: `Payment for ${invoice.invoiceNumber}${trimmedTxnId ? ` (${trimmedTxnId})` : ''}`,
    });
    await customer.save();

    res.status(200).json({
      success: true,
      message: `Payment of ₹${paidAmount} recorded for ${invoice.invoiceNumber}`,
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

const cancelGstInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) {
      return next(errorHandler(400, 'Please provide a reason for cancelling this invoice'));
    }

    const invoice = await GstInvoice.findById(id);
    if (!invoice) return next(errorHandler(404, 'GST Invoice not found'));
    if (invoice.isCancelled) return next(errorHandler(400, 'Invoice is already cancelled'));
    if (Number(invoice.amountPaid) > 0) {
      return next(
        errorHandler(
          400,
          'Cannot cancel an invoice with recorded payments. Reverse the payment first.'
        )
      );
    }

    invoice.isCancelled = true;
    invoice.cancelReason = reason;
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = req.user.id;
    const removedDue = Number(invoice.balanceDue) || 0;
    invoice.balanceDue = 0;
    await invoice.save();

    if (invoice.collectionId) {
      await Collection.findByIdAndDelete(invoice.collectionId);
    }

    const customer = await Customer.findById(invoice.customerId);
    if (customer) {
      customer.remainingBalance = round2(
        Math.max(0, (Number(customer.remainingBalance) || 0) - removedDue)
      );
      customer.transactions.push({
        type: 'reversal',
        amount: removedDue,
        collectedBy: req.user.id,
        note: `Cancelled GST Invoice ${invoice.invoiceNumber}: ${reason}`,
      });
      await customer.save();
    }

    res.status(200).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} cancelled (sequence preserved for audit)`,
      invoice,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Multi-sheet CA / GSTR-1 Audit Excel Export
 * Sheet 1: GST Invoices (GSTR-1 B2B Register)
 * Sheet 2: HSN Summary (GSTR-1 Table 12)
 * Sheet 3: Monthly GST Summary (GSTR-3B Reconciliation)
 * Sheet 4: GST Customers Master
 */
const downloadGstAuditExcel = async (req, res, next) => {
  try {
    const { fy, month, year } = req.query;
    const filter = {};
    if (fy && fy !== 'all') filter.financialYear = fy;
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);

    const [invoices, gstCustomers] = await Promise.all([
      GstInvoice.find(filter)
        .sort({ financialYear: 1, sequenceNumber: 1 })
        .lean(),
      Customer.find({ isGstCustomer: true })
        .populate('planId', 'name amount speed')
        .sort({ companyName: 1, name: 1 })
        .lean(),
    ]);

    if (invoices.length === 0 && gstCustomers.length === 0) {
      return next(errorHandler(404, 'No GST invoice or GST customer data found to export'));
    }

    const workbook = XLSX.utils.book_new();

    // Sheet 1: Detailed Invoice Register (includes Cancelled rows explicitly for sequence audit!)
    const invoiceRows = invoices.map((inv) => ({
      InvoiceNo: inv.invoiceNumber,
      SequenceNo: inv.sequenceNumber,
      FinancialYear: inv.financialYear,
      InvoiceDate: formatDDMMYYYY(inv.invoiceDate),
      InvoiceType: (inv.invoiceType || 'monthly').toUpperCase(),
      Status: inv.isCancelled ? 'CANCELLED' : 'ACTIVE',
      BuyerName: inv.buyer?.companyName || inv.buyer?.contactName || '—',
      BuyerGSTIN: inv.buyer?.gstin || 'URD',
      PlaceOfSupplyCode: inv.buyer?.stateCode || '33',
      SupplyType: inv.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)',
      HSN_SAC: [...new Set((inv.items || []).map((i) => i.hsnSac))].join(', '),
      Particulars: (inv.items || [])
        .map((i) => `${i.particulars}${i.periodLabel ? ` ${i.periodLabel}` : ''}`)
        .join('; '),
      TaxableValue: inv.isCancelled ? 0 : inv.taxableValue,
      CGSTRate: inv.isCancelled ? 0 : inv.cgstRate,
      CGSTAmount: inv.isCancelled ? 0 : inv.cgstAmount,
      SGSTRate: inv.isCancelled ? 0 : inv.sgstRate,
      SGSTAmount: inv.isCancelled ? 0 : inv.sgstAmount,
      IGSTRate: inv.isCancelled ? 0 : inv.igstRate,
      IGSTAmount: inv.isCancelled ? 0 : inv.igstAmount,
      TotalTax: inv.isCancelled ? 0 : inv.totalTax,
      GrandTotal: inv.isCancelled ? 0 : inv.grandTotal,
      AmountPaid: inv.isCancelled ? 0 : inv.amountPaid,
      BalanceDue: inv.isCancelled ? 0 : inv.balanceDue,
      PaymentStatus: inv.isCancelled ? 'Cancelled' : inv.paymentStatus,
      PaymentMode: inv.paymentMode || 'unpaid',
      TransactionRef: inv.transactionId || '—',
      PaidDate: inv.paidAt ? formatDDMMYYYY(inv.paidAt) : '—',
      CancelReason: inv.cancelReason || '—',
    }));

    const sheet1 = XLSX.utils.json_to_sheet(
      invoiceRows.length ? invoiceRows : [{ Info: 'No GST invoices for selected filter' }]
    );
    XLSX.utils.book_append_sheet(workbook, sheet1, 'GST Invoices (GSTR-1)');

    // Sheet 2: HSN / SAC Summary (Active invoices only)
    const hsnMap = new Map();
    invoices
      .filter((inv) => !inv.isCancelled)
      .forEach((inv) => {
        const invTaxable = Number(inv.taxableValue) || 1;
        (inv.items || []).forEach((item) => {
          const code = item.hsnSac || '998422';
          const ratio = (Number(item.amount) || 0) / invTaxable;
          const prev = hsnMap.get(code) || {
            HSN_SAC: code,
            InvoiceCount: 0,
            TotalQuantity: 0,
            TaxableValue: 0,
            CGSTAmount: 0,
            SGSTAmount: 0,
            IGSTAmount: 0,
            TotalTax: 0,
            TotalValue: 0,
          };
          prev.InvoiceCount += 1;
          prev.TotalQuantity += Number(item.quantity) || 1;
          prev.TaxableValue = round2(prev.TaxableValue + (Number(item.amount) || 0));
          prev.CGSTAmount = round2(prev.CGSTAmount + (Number(inv.cgstAmount) || 0) * ratio);
          prev.SGSTAmount = round2(prev.SGSTAmount + (Number(inv.sgstAmount) || 0) * ratio);
          prev.IGSTAmount = round2(prev.IGSTAmount + (Number(inv.igstAmount) || 0) * ratio);
          prev.TotalTax = round2(prev.TotalTax + (Number(inv.totalTax) || 0) * ratio);
          prev.TotalValue = round2(prev.TaxableValue + prev.TotalTax);
          hsnMap.set(code, prev);
        });
      });

    const hsnRows = Array.from(hsnMap.values());
    const sheet2 = XLSX.utils.json_to_sheet(
      hsnRows.length ? hsnRows : [{ Info: 'No active HSN records' }]
    );
    XLSX.utils.book_append_sheet(workbook, sheet2, 'HSN Summary');

    // Sheet 3: Monthly GST Summary (GSTR-3B)
    const monthMap = new Map();
    invoices
      .filter((inv) => !inv.isCancelled)
      .forEach((inv) => {
        const key = `${inv.financialYear}-${inv.year}-${String(inv.month).padStart(2, '0')}`;
        const prev = monthMap.get(key) || {
          FinancialYear: inv.financialYear,
          Year: inv.year,
          Month: inv.month,
          ActiveInvoices: 0,
          TaxableValue: 0,
          CGST: 0,
          SGST: 0,
          IGST: 0,
          TotalGSTLiability: 0,
          TotalBilled: 0,
          TotalCollected: 0,
          TotalPending: 0,
        };
        prev.ActiveInvoices += 1;
        prev.TaxableValue = round2(prev.TaxableValue + (Number(inv.taxableValue) || 0));
        prev.CGST = round2(prev.CGST + (Number(inv.cgstAmount) || 0));
        prev.SGST = round2(prev.SGST + (Number(inv.sgstAmount) || 0));
        prev.IGST = round2(prev.IGST + (Number(inv.igstAmount) || 0));
        prev.TotalGSTLiability = round2(prev.TotalGSTLiability + (Number(inv.totalTax) || 0));
        prev.TotalBilled = round2(prev.TotalBilled + (Number(inv.grandTotal) || 0));
        prev.TotalCollected = round2(prev.TotalCollected + (Number(inv.amountPaid) || 0));
        prev.TotalPending = round2(prev.TotalPending + (Number(inv.balanceDue) || 0));
        monthMap.set(key, prev);
      });

    const monthlyRows = Array.from(monthMap.values());
    const sheet3 = XLSX.utils.json_to_sheet(
      monthlyRows.length ? monthlyRows : [{ Info: 'No monthly summary data' }]
    );
    XLSX.utils.book_append_sheet(workbook, sheet3, 'Monthly GST Summary');

    // Sheet 4: GST Customers Master
    const customerRows = gstCustomers.map((c) => ({
      CompanyName: c.companyName || c.name,
      ContactName: c.name,
      GSTIN: c.gstin || '—',
      StateCode: c.stateCode || '33',
      Mobile: c.mobile,
      Email: c.email || '—',
      Plan: c.planId?.name || 'Unassigned',
      BaseMonthlyRate: c.planId?.amount || 0,
      GSTRate: `${c.gstRate ?? 18}%`,
      HSN_SAC: c.hsnSac || '998422',
      Status: c.status || 'active',
      AdvanceCredit: c.advanceAmount || 0,
      PendingBalance: c.remainingBalance || 0,
      BillingAddress: c.billingAddress || c.address,
    }));

    const sheet4 = XLSX.utils.json_to_sheet(
      customerRows.length ? customerRows : [{ Info: 'No GST customers registered' }]
    );
    XLSX.utils.book_append_sheet(workbook, sheet4, 'GST Customers Master');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileLabel = fy && fy !== 'all' ? `GST_Audit_FY_${fy}.xlsx` : 'GST_Audit_Report.xlsx';

    res.setHeader('Content-Disposition', `attachment; filename=${fileLabel}`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Monthly GST Customer Billing Tracker:
 * Shows EVERY GST customer for (month, year) — clearly flagging who ALREADY has
 * a monthly GST Tax Invoice vs who STILL DOES NOT have a bill generated yet.
 */
const getMonthlyGstStatus = async (req, res, next) => {
  try {
    const now = new Date();
    const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
    const year = req.query.year ? Number(req.query.year) : now.getFullYear();

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return next(errorHandler(400, 'Month must be between 1 and 12'));
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return next(errorHandler(400, 'Year must be a valid 4-digit year'));
    }

    const { periodLabel } = getMonthPeriodBounds(year, month);
    const invDate = new Date(year, month - 1, 1);
    const { fy } = getFinancialYear(invDate);

    const [gstCustomers, monthlyInvoices, settings, counter] = await Promise.all([
      Customer.find({ isGstCustomer: true })
        .populate('planId', 'name amount speed')
        .sort({ companyName: 1, name: 1 })
        .lean(),
      GstInvoice.find({
        month,
        year,
        invoiceType: 'monthly',
        isCancelled: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .lean(),
      getOrCreateCompanySettings(),
      InvoiceCounter.findOne({ financialYear: fy }).lean(),
    ]);

    const invoiceByCustomer = new Map();
    monthlyInvoices.forEach((inv) => {
      const cid = String(inv.customerId);
      if (!invoiceByCustomer.has(cid)) invoiceByCustomer.set(cid, inv);
    });

    const sellerStateCode = settings.stateCode || '33';
    const prefix = settings.invoicePrefix || 'SKYDPM';
    const nextInvoicePreview = `${prefix} / ${String((counter?.seq || 0) + 1).padStart(
      3,
      '0'
    )} / ${fy}`;

    const summary = {
      month,
      year,
      periodLabel,
      financialYear: fy,
      nextInvoicePreview,
      totalGstCustomers: gstCustomers.length,
      activeGstCustomers: 0,
      generatedCount: 0,
      notGeneratedCount: 0,
      inactiveCount: 0,
      noPlanCount: 0,
      generatedTotalValue: 0,
      projectedMissingValue: 0,
    };

    const rows = gstCustomers.map((c) => {
      const status = c.status || 'active';
      const plan = c.planId && typeof c.planId === 'object' ? c.planId : null;
      const baseAmount = round2(Number(plan?.amount) || 0);
      const gstRate = Number(c.gstRate ?? settings.defaultGstRate ?? 18);
      const buyerStateCode = extractStateCodeFromGstin(c.gstin, c.stateCode || sellerStateCode);
      const tax = calculateGstBreakdown({
        taxableValue: baseAmount,
        gstRate,
        buyerStateCode,
        sellerStateCode,
      });

      const existingInv = invoiceByCustomer.get(String(c._id)) || null;
      let billingStatus = 'not_generated';

      if (existingInv) {
        billingStatus = 'generated';
        summary.activeGstCustomers += 1;
        summary.generatedCount += 1;
        summary.generatedTotalValue = round2(
          summary.generatedTotalValue + (Number(existingInv.grandTotal) || 0)
        );
      } else if (status === 'suspended' || status === 'disconnected') {
        billingStatus = 'inactive';
        summary.inactiveCount += 1;
      } else if (!plan || baseAmount <= 0) {
        billingStatus = 'no_plan';
        summary.activeGstCustomers += 1;
        summary.noPlanCount += 1;
      } else {
        billingStatus = 'not_generated';
        summary.activeGstCustomers += 1;
        summary.notGeneratedCount += 1;
        summary.projectedMissingValue = round2(summary.projectedMissingValue + tax.grandTotal);
      }

      return {
        customerId: c._id,
        companyName: c.companyName || c.name,
        contactName: c.name,
        mobile: c.mobile,
        gstin: c.gstin || '',
        stateCode: buyerStateCode,
        customerStatus: status,
        planName: plan?.name || 'No Plan',
        planSpeed: plan?.speed || null,
        baseAmount,
        gstRate,
        isInterState: tax.isInterState,
        taxAmount: tax.totalTax,
        grandTotal: tax.grandTotal,
        billingStatus,
        invoice: existingInv
          ? {
              _id: existingInv._id,
              invoiceNumber: existingInv.invoiceNumber,
              invoiceDate: existingInv.invoiceDate,
              grandTotal: existingInv.grandTotal,
              amountPaid: existingInv.amountPaid,
              balanceDue: existingInv.balanceDue,
              paymentStatus: existingInv.paymentStatus,
            }
          : null,
      };
    });

    // Sort priority: Not Generated first, then No Plan, then Generated, then Inactive
    const order = { not_generated: 0, no_plan: 1, generated: 2, inactive: 3 };
    rows.sort((a, b) => (order[a.billingStatus] ?? 9) - (order[b.billingStatus] ?? 9));

    res.status(200).json({
      success: true,
      summary,
      rows,
    });
  } catch (error) {
    next(error);
  }
};

const generateMissingMonthlyGstBills = async (req, res, next) => {
  try {
    const result = await runMonthlyBillingGeneration({
      month: req.body?.month,
      year: req.body?.year,
      runType: 'manual',
      triggeredByUserId: req.user?.id || null,
      triggeredByName: req.user?.userName || 'Admin',
      gstOnly: true,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getCompanySettings,
  updateCompanySettings,
  getMonthlyGstStatus,
  generateMissingMonthlyGstBills,
  listGstInvoices,
  getGstInvoiceById,
  createManualGstInvoice,
  recordGstInvoicePayment,
  cancelGstInvoice,
  downloadGstAuditExcel,
};
