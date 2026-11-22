import Collection from '../models/collectionModel.js';
import Customer from '../models/customerModel.js';
import Plan from '../models/planModel.js';
import Expense from '../models/expenseModel.js';
import Admin from '../models/adminModel.js';
import GstInvoice from '../models/gstInvoiceModel.js';
import ServiceCharge from '../models/serviceChargeModel.js';
import BillingRun from '../models/billingRunModel.js';
import InvoiceCounter from '../models/invoiceCounterModel.js';
import { errorHandler } from '../uitils/errorHandler.js';
import {
  calculateGstBreakdown,
  extractStateCodeFromGstin,
  getFinancialYear,
  getMonthPeriodBounds,
  getOrCreateCompanySettings,
  round2,
} from '../uitils/gstUtils.js';
import { createGstInvoiceInternal } from './gst.controller.js';
import XLSX from 'xlsx';

// In-flight lock to prevent overlapping monthly billing runs for the same cycle
const activeBillingLocks = new Set();

const summarizeSettlementExpenses = (record) => {
  const map = new Map();
  if (Array.isArray(record.expenseIds)) {
    record.expenseIds.forEach((exp) => {
      if (exp && exp._id) map.set(String(exp._id), exp);
    });
  }
  if (record.expenseId && record.expenseId._id) {
    map.set(String(record.expenseId._id), record.expenseId);
  }
  const expensesList = Array.from(map.values());
  const totalExpenseAmount = expensesList.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const combinedRemarks = expensesList.length
    ? expensesList
        .map((e) => (expensesList.length > 1 ? `${e.remarks} (₹${e.amount})` : e.remarks))
        .join('; ')
    : '';
  return { expensesList, totalExpenseAmount, combinedRemarks };
};

const parseTargetPeriod = (inputMonth, inputYear) => {
  const now = new Date();
  const month = inputMonth ? Number(inputMonth) : now.getMonth() + 1;
  const year = inputYear ? Number(inputYear) : now.getFullYear();

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw errorHandler(400, 'Billing month must be an integer between 1 and 12');
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw errorHandler(400, 'Billing year must be a valid 4-digit year');
  }

  return { month, year };
};

/**
 * DRY-RUN PREVIEW: Computes exactly what will happen if monthly billing runs for (month, year)
 * without mutating a single document.
 */
const previewMonthlyBilling = async (req, res, next) => {
  try {
    const { month, year } = parseTargetPeriod(req.query.month, req.query.year);
    const { periodLabel } = getMonthPeriodBounds(year, month);
    const invoiceDate = new Date(year, month - 1, 1);
    const { fy } = getFinancialYear(invoiceDate);

    const [allCustomers, plans, existingMonthly, settings, counter] = await Promise.all([
      Customer.find().sort({ name: 1 }).lean(),
      Plan.find().lean(),
      Collection.find({
        month,
        year,
        $or: [{ billType: 'monthly' }, { billType: { $exists: false } }],
      })
        .select('customerId invoiceNumber status amountDue amountPaid')
        .lean(),
      getOrCreateCompanySettings(),
      InvoiceCounter.findOne({ financialYear: fy }).lean(),
    ]);

    const planMap = plans.reduce((acc, p) => {
      acc[String(p._id)] = p;
      return acc;
    }, {});

    const existingMap = new Map(existingMonthly.map((c) => [String(c.customerId), c]));
    const sellerStateCode = settings.stateCode || '33';
    const prefix = settings.invoicePrefix || 'SKYDPM';
    let projectedSeq = counter?.seq || 0;

    const rows = [];
    const summary = {
      month,
      year,
      periodLabel,
      financialYear: fy,
      totalCustomers: allCustomers.length,
      eligibleCount: 0,
      eligibleRegularCount: 0,
      eligibleGstCount: 0,
      skippedAlreadyBilled: 0,
      skippedInactive: 0,
      skippedNoPlan: 0,
      totalBaseAmount: 0,
      totalGstAmount: 0,
      totalBilledAmount: 0,
      totalAdvanceApplied: 0,
      netNewDueAmount: 0,
      projectedInvoiceStart: null,
      projectedInvoiceEnd: null,
    };

    for (const c of allCustomers) {
      const plan = c.planId ? planMap[String(c.planId)] : null;
      const existing = existingMap.get(String(c._id));
      const status = c.status || 'active';

      if (existing) {
        summary.skippedAlreadyBilled += 1;
        rows.push({
          customerId: c._id,
          name: c.isGstCustomer && c.companyName ? c.companyName : c.name,
          mobile: c.mobile,
          planName: plan?.name || '—',
          isGstCustomer: Boolean(c.isGstCustomer),
          gstin: c.gstin || '',
          action: 'already_billed',
          reason: `Already billed (${existing.status}${
            existing.invoiceNumber ? ` • ${existing.invoiceNumber}` : ''
          })`,
          baseAmount: 0,
          gstAmount: 0,
          billTotal: 0,
          advanceApplied: 0,
          netDue: 0,
          existingBalance: Number(c.remainingBalance) || 0,
        });
        continue;
      }

      if (status === 'suspended' || status === 'disconnected') {
        summary.skippedInactive += 1;
        rows.push({
          customerId: c._id,
          name: c.isGstCustomer && c.companyName ? c.companyName : c.name,
          mobile: c.mobile,
          planName: plan?.name || '—',
          isGstCustomer: Boolean(c.isGstCustomer),
          gstin: c.gstin || '',
          action: 'skipped_inactive',
          reason: `Skipped (${status})`,
          baseAmount: 0,
          gstAmount: 0,
          billTotal: 0,
          advanceApplied: 0,
          netDue: 0,
          existingBalance: Number(c.remainingBalance) || 0,
        });
        continue;
      }

      const baseAmount = round2(Number(plan?.amount) || 0);
      if (!plan || baseAmount <= 0) {
        summary.skippedNoPlan += 1;
        rows.push({
          customerId: c._id,
          name: c.isGstCustomer && c.companyName ? c.companyName : c.name,
          mobile: c.mobile,
          planName: 'No Plan',
          isGstCustomer: Boolean(c.isGstCustomer),
          gstin: c.gstin || '',
          action: 'skipped_no_plan',
          reason: 'No valid subscription plan assigned',
          baseAmount: 0,
          gstAmount: 0,
          billTotal: 0,
          advanceApplied: 0,
          netDue: 0,
          existingBalance: Number(c.remainingBalance) || 0,
        });
        continue;
      }

      let gstAmount = 0;
      let billTotal = baseAmount;
      let projectedInvoiceNumber = null;

      if (c.isGstCustomer) {
        const buyerState = extractStateCodeFromGstin(c.gstin, c.stateCode || sellerStateCode);
        const tax = calculateGstBreakdown({
          taxableValue: baseAmount,
          gstRate: Number(c.gstRate ?? settings.defaultGstRate ?? 18),
          buyerStateCode: buyerState,
          sellerStateCode,
        });
        gstAmount = tax.totalTax;
        billTotal = tax.grandTotal;
        projectedSeq += 1;
        projectedInvoiceNumber = `${prefix} / ${String(projectedSeq).padStart(3, '0')} / ${fy}`;
        if (!summary.projectedInvoiceStart) summary.projectedInvoiceStart = projectedInvoiceNumber;
        summary.projectedInvoiceEnd = projectedInvoiceNumber;
        summary.eligibleGstCount += 1;
      } else {
        summary.eligibleRegularCount += 1;
      }

      const availableAdvance = round2(Math.max(0, Number(c.advanceAmount) || 0));
      const advanceApplied = round2(Math.min(availableAdvance, billTotal));
      const netDue = round2(Math.max(0, billTotal - advanceApplied));

      summary.eligibleCount += 1;
      summary.totalBaseAmount = round2(summary.totalBaseAmount + baseAmount);
      summary.totalGstAmount = round2(summary.totalGstAmount + gstAmount);
      summary.totalBilledAmount = round2(summary.totalBilledAmount + billTotal);
      summary.totalAdvanceApplied = round2(summary.totalAdvanceApplied + advanceApplied);
      summary.netNewDueAmount = round2(summary.netNewDueAmount + netDue);

      rows.push({
        customerId: c._id,
        name: c.isGstCustomer && c.companyName ? c.companyName : c.name,
        mobile: c.mobile,
        planName: plan.name,
        isGstCustomer: Boolean(c.isGstCustomer),
        gstin: c.gstin || '',
        action: 'will_bill',
        projectedInvoiceNumber,
        reason: netDue === 0 ? 'Auto-paid from Advance Credit' : 'Will generate Pending bill',
        baseAmount,
        gstAmount,
        billTotal,
        advanceApplied,
        netDue,
        existingBalance: Number(c.remainingBalance) || 0,
      });
    }

    res.status(200).json({
      success: true,
      summary,
      rows,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * SENIOR MONTHLY SUBSCRIPTION BILLING ENGINE
 * - Zero double-counting: Each monthly bill stores ONLY that cycle's subscription charge
 *   (Base for Regular, Base + GST for GST customers). Prior unpaid bills stay independently
 *   trackable as Overdue, while customer.remainingBalance increases by ONLY this cycle's net new due.
 * - Idempotent: Safe to re-run anytime (e.g., to catch up newly added mid-month subscribers).
 * - Audited: Every execution writes an immutable BillingRun audit record.
 */
export const runMonthlyBillingGeneration = async ({
  month: inputMonth,
  year: inputYear,
  runType = 'manual',
  triggeredByUserId = null,
  triggeredByName = 'System Cron',
  singleCustomerId = null,
  gstOnly = false,
} = {}) => {
  const { month, year } = parseTargetPeriod(inputMonth, inputYear);
  const lockKey = singleCustomerId
    ? `${year}-${month}-${singleCustomerId}`
    : gstOnly
      ? `${year}-${month}-gst`
      : `${year}-${month}`;

  if (activeBillingLocks.has(lockKey)) {
    throw errorHandler(
      409,
      `Monthly billing for ${month}/${year} is already running. Please wait a moment.`
    );
  }

  activeBillingLocks.add(lockKey);

  try {
    const { start: periodStart, end: periodEnd, periodLabel } = getMonthPeriodBounds(year, month);
    const invoiceDate = new Date(year, month - 1, 1);

    // 1. Mark previous months' still-Pending bills as Overdue (without mutating their amountDue)
    const overdueFilter = {
      status: 'Pending',
      amountDue: { $gt: 0 },
      $or: [{ year: { $lt: year } }, { year, month: { $lt: month } }],
    };
    if (singleCustomerId) overdueFilter.customerId = singleCustomerId;
    if (gstOnly) overdueFilter.isGstBill = true;
    const overdueResult = await Collection.updateMany(overdueFilter, {
      $set: { status: 'Overdue' },
    });

    // 2. Load target customers & plans
    const customerFilter = singleCustomerId
      ? { _id: singleCustomerId }
      : gstOnly
        ? { isGstCustomer: true }
        : {};
    const [allCustomers, plans, existingCollections] = await Promise.all([
      Customer.find(customerFilter).sort({ name: 1 }),
      Plan.find().lean(),
      Collection.find({
        month,
        year,
        ...(singleCustomerId ? { customerId: singleCustomerId } : {}),
        $or: [{ billType: 'monthly' }, { billType: { $exists: false } }],
      })
        .select('customerId')
        .lean(),
    ]);

    const planMap = plans.reduce((acc, plan) => {
      acc[String(plan._id)] = plan;
      return acc;
    }, {});
    const existingCustomerIds = new Set(existingCollections.map((c) => String(c.customerId)));

    let regularBillsCreated = 0;
    let gstBillsCreated = 0;
    let skippedAlreadyBilled = 0;
    let skippedInactive = 0;
    let skippedNoPlan = 0;

    let totalBaseAmount = 0;
    let totalGstAmount = 0;
    let totalBilledAmount = 0;
    let totalAdvanceApplied = 0;
    let netNewDueAmount = 0;
    let invoiceRangeStart = null;
    let invoiceRangeEnd = null;

    for (const customer of allCustomers) {
      if (existingCustomerIds.has(String(customer._id))) {
        skippedAlreadyBilled += 1;
        continue;
      }

      const custStatus = customer.status || 'active';
      if (custStatus === 'suspended' || custStatus === 'disconnected') {
        skippedInactive += 1;
        continue;
      }

      const plan = customer.planId ? planMap[String(customer.planId)] : null;
      const monthlyBaseCharge = round2(Number(plan?.amount) || 0);
      if (!plan || monthlyBaseCharge <= 0) {
        skippedNoPlan += 1;
        continue;
      }

      const availableAdvance = round2(Math.max(0, Number(customer.advanceAmount) || 0));

      if (customer.isGstCustomer) {
        // Issue atomic sequential FY GST Invoice for this month's supply
        const gstInvoice = await createGstInvoiceInternal({
          customer,
          items: [
            {
              particulars: 'Bandwidth Charges',
              periodLabel,
              hsnSac: customer.hsnSac || '998422',
              quantity: 1,
              rate: monthlyBaseCharge,
              amount: monthlyBaseCharge,
            },
          ],
          invoiceDate,
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          invoiceType: 'monthly',
          createdBy: triggeredByUserId || customer.createdBy,
        });

        const cycleTotal = gstInvoice.grandTotal;
        const advanceUsed = round2(Math.min(availableAdvance, cycleTotal));
        const nextAdvance = round2(availableAdvance - advanceUsed);
        const cycleDue = round2(Math.max(0, cycleTotal - advanceUsed));
        const statusPay = cycleDue === 0 ? 'Paid' : 'Pending';

        const collection = await Collection.create({
          userId: customer.createdBy,
          customerId: customer._id,
          billType: 'monthly',
          description: `Bandwidth Charges ${periodLabel}`,
          isGstBill: true,
          gstInvoiceId: gstInvoice._id,
          invoiceNumber: gstInvoice.invoiceNumber,
          taxableAmount: gstInvoice.taxableValue,
          taxAmount: gstInvoice.totalTax,
          amountDue: cycleDue,
          amountPaid: advanceUsed,
          dueDate: new Date(year, month - 1, 10),
          month,
          year,
          status: statusPay,
        });

        gstInvoice.collectionId = collection._id;
        gstInvoice.amountPaid = advanceUsed;
        gstInvoice.balanceDue = cycleDue;
        gstInvoice.paymentStatus =
          cycleDue === 0 ? 'Paid' : advanceUsed > 0 ? 'Partial' : 'Unpaid';
        if (cycleDue === 0) {
          gstInvoice.paymentMode = 'cash';
          gstInvoice.paidAt = new Date();
        }
        await gstInvoice.save();

        // Increment customer remainingBalance ONLY by THIS cycle's unpaid due (zero double-counting!)
        customer.remainingBalance = round2((Number(customer.remainingBalance) || 0) + cycleDue);
        customer.advanceAmount = nextAdvance;
        customer.transactions.push({
          type: 'due',
          amount: cycleTotal,
          note: `Monthly GST Bill • ${gstInvoice.invoiceNumber} ${periodLabel}${
            advanceUsed > 0 ? ` (₹${advanceUsed} paid from Advance)` : ''
          }`,
        });
        await customer.save();

        if (!invoiceRangeStart) invoiceRangeStart = gstInvoice.invoiceNumber;
        invoiceRangeEnd = gstInvoice.invoiceNumber;

        gstBillsCreated += 1;
        totalBaseAmount = round2(totalBaseAmount + gstInvoice.taxableValue);
        totalGstAmount = round2(totalGstAmount + gstInvoice.totalTax);
        totalBilledAmount = round2(totalBilledAmount + cycleTotal);
        totalAdvanceApplied = round2(totalAdvanceApplied + advanceUsed);
        netNewDueAmount = round2(netNewDueAmount + cycleDue);
      } else {
        // Standard Non-GST Monthly Subscription Bill (ONLY this cycle's amount!)
        const cycleTotal = monthlyBaseCharge;
        const advanceUsed = round2(Math.min(availableAdvance, cycleTotal));
        const nextAdvance = round2(availableAdvance - advanceUsed);
        const cycleDue = round2(Math.max(0, cycleTotal - advanceUsed));
        const statusPay = cycleDue === 0 ? 'Paid' : 'Pending';

        await Collection.create({
          userId: customer.createdBy,
          customerId: customer._id,
          billType: 'monthly',
          description: `${plan.name} Subscription ${periodLabel}`,
          isGstBill: false,
          taxableAmount: monthlyBaseCharge,
          taxAmount: 0,
          amountDue: cycleDue,
          amountPaid: advanceUsed,
          dueDate: new Date(year, month - 1, 10),
          month,
          year,
          status: statusPay,
        });

        // Increment customer remainingBalance ONLY by THIS cycle's unpaid due (zero double-counting!)
        customer.remainingBalance = round2((Number(customer.remainingBalance) || 0) + cycleDue);
        customer.advanceAmount = nextAdvance;
        customer.transactions.push({
          type: 'due',
          amount: cycleTotal,
          note: `Monthly Subscription (${plan.name}) ${periodLabel}${
            advanceUsed > 0 ? ` (₹${advanceUsed} paid from Advance)` : ''
          }`,
        });
        await customer.save();

        regularBillsCreated += 1;
        totalBaseAmount = round2(totalBaseAmount + monthlyBaseCharge);
        totalBilledAmount = round2(totalBilledAmount + cycleTotal);
        totalAdvanceApplied = round2(totalAdvanceApplied + advanceUsed);
        netNewDueAmount = round2(netNewDueAmount + cycleDue);
      }
    }

    const totalBillsCreated = regularBillsCreated + gstBillsCreated;

    const summaryMessage =
      totalBillsCreated > 0
        ? `Generated ${totalBillsCreated} subscription bill(s) for ${month}/${year}${
            gstBillsCreated > 0 ? ` (${gstBillsCreated} GST invoice(s))` : ''
          }.`
        : `All eligible active subscribers for ${month}/${year} are already billed.`;

    // Save permanent Billing Run audit log
    const billingRun = await BillingRun.create({
      month,
      year,
      runType,
      triggeredBy: triggeredByUserId,
      triggeredByName,
      status: 'completed',
      totalCustomersChecked: allCustomers.length,
      regularBillsCreated,
      gstBillsCreated,
      totalBillsCreated,
      skippedAlreadyBilled,
      skippedInactive,
      skippedNoPlan,
      markedOverdueCount: overdueResult.modifiedCount || 0,
      totalBaseAmount,
      totalGstAmount,
      totalBilledAmount,
      totalAdvanceApplied,
      netNewDueAmount,
      invoiceRangeStart,
      invoiceRangeEnd,
      notes: summaryMessage,
    });

    return {
      month,
      year,
      generatedCount: totalBillsCreated,
      regularBillsCreated,
      gstInvoicesGenerated: gstBillsCreated,
      skippedCount: skippedAlreadyBilled + skippedInactive + skippedNoPlan,
      skippedAlreadyBilled,
      skippedInactive,
      skippedNoPlan,
      markedOverdueCount: overdueResult.modifiedCount || 0,
      totalBilledAmount,
      totalAdvanceApplied,
      netNewDueAmount,
      invoiceRangeStart,
      invoiceRangeEnd,
      billingRun,
      message: summaryMessage,
    };
  } finally {
    activeBillingLocks.delete(lockKey);
  }
};

const generateMonthlyCollectionss = async (req, res, next) => {
  try {
    const result = await runMonthlyBillingGeneration({
      month: req.body?.month,
      year: req.body?.year,
      runType: 'manual',
      triggeredByUserId: req.user?.id || null,
      triggeredByName: req.user?.userName || 'Admin',
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Error generating monthly bills:', error);
    next(error);
  }
};

const generateSingleCustomerBill = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const customer = await Customer.findById(customerId).lean();
    if (!customer) return next(errorHandler(404, 'Customer not found'));

    const result = await runMonthlyBillingGeneration({
      month: req.body?.month,
      year: req.body?.year,
      runType: 'single',
      triggeredByUserId: req.user?.id || null,
      triggeredByName: req.user?.userName || 'Admin',
      singleCustomerId: customerId,
    });

    if (result.generatedCount === 0) {
      return next(
        errorHandler(
          400,
          result.skippedAlreadyBilled > 0
            ? `Customer "${customer.name}" is already billed for ${result.month}/${result.year}`
            : `Customer "${customer.name}" is not eligible (inactive or missing plan)`
        )
      );
    }

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const getBillingRuns = async (req, res, next) => {
  try {
    const runs = await BillingRun.find()
      .populate('triggeredBy', 'userName')
      .sort({ createdAt: -1 })
      .limit(36)
      .lean();

    res.status(200).json({
      success: true,
      runs,
      schedule: {
        cron: '5 0 1 * *',
        description: 'Automatic run on the 1st of every month at 12:05 AM',
        timezone: process.env.TZ || 'Asia/Kolkata',
      },
    });
  } catch (error) {
    next(error);
  }
};

export const generateMonthlyCollections = async () => {
  try {
    const result = await runMonthlyBillingGeneration({
      runType: 'cron',
      triggeredByUserId: null,
      triggeredByName: 'System Cron (Auto)',
    });
    console.log(result.message);
    return result;
  } catch (error) {
    console.error('Error generating monthly bills:', error);
  }
};

const makePayment = async (req, res, next) => {
  try {
    const { collectionId, paymentMode, transactionId } = req.body;
    const paidAmount = round2(Number(req.body.amountPaid));

    if (!collectionId) {
      return next(errorHandler(400, 'Please select a bill/collection'));
    }
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return next(errorHandler(400, 'Payment amount must be a positive number'));
    }

    const mode = paymentMode || 'cash';
    if (!['cash', 'online'].includes(mode)) {
      return next(errorHandler(400, 'Invalid payment mode'));
    }

    const trimmedTxnId = transactionId ? String(transactionId).trim() : null;
    if (mode === 'online' && !trimmedTxnId) {
      return next(errorHandler(400, 'Transaction ID is required for online payments'));
    }

    const collection = await Collection.findById(collectionId);
    if (!collection) return next(errorHandler(404, 'Bill not found'));

    if (collection.status === 'Paid' && collection.amountDue <= 0) {
      return next(errorHandler(400, 'This bill is already fully paid'));
    }

    const customer = await Customer.findById(collection.customerId);
    if (!customer) return next(errorHandler(404, 'Customer not found'));

    const prevDue = Number(collection.amountDue) || 0;
    const appliedToDue = round2(Math.min(prevDue, paidAmount));
    const remainingDue = round2(prevDue - paidAmount);

    if (remainingDue <= 0) {
      collection.status = 'Paid';
      customer.advanceAmount = round2(
        (Number(customer.advanceAmount) || 0) + Math.abs(remainingDue)
      );
      collection.amountDue = 0;
    } else {
      collection.status = collection.status === 'Overdue' ? 'Overdue' : 'Pending';
      collection.amountDue = remainingDue;
    }

    customer.remainingBalance = round2(
      Math.max(0, (Number(customer.remainingBalance) || 0) - appliedToDue)
    );

    collection.amountPaid = round2((Number(collection.amountPaid) || 0) + paidAmount);
    collection.paymentMode = mode;
    collection.transactionId = mode === 'online' ? trimmedTxnId : null;
    if (req.user) {
      collection.userId = req.user.id;
    }

    collection.payments.push({
      amount: paidAmount,
      paymentMode: mode,
      transactionId: mode === 'online' ? trimmedTxnId : null,
      collectedBy: req.user.id,
      date: new Date(),
    });

    const noteParts = [];
    if (collection.invoiceNumber) noteParts.push(`Invoice ${collection.invoiceNumber}`);
    else if (collection.billType === 'service' && collection.description) {
      noteParts.push(`Service: ${collection.description}`);
    } else {
      noteParts.push(`Bill ${collection.month}/${collection.year}`);
    }
    if (mode === 'online' && trimmedTxnId) noteParts.push(`Ref: ${trimmedTxnId}`);

    customer.transactions.push({
      type: 'payment',
      amount: paidAmount,
      collectedBy: req.user.id,
      note: noteParts.join(' • '),
    });

    await collection.save();
    await customer.save();

    if (collection.gstInvoiceId) {
      const gstInvoice = await GstInvoice.findById(collection.gstInvoiceId);
      if (gstInvoice && !gstInvoice.isCancelled) {
        const appliedToInv = round2(Math.min(gstInvoice.balanceDue, paidAmount));
        gstInvoice.amountPaid = round2((Number(gstInvoice.amountPaid) || 0) + appliedToInv);
        gstInvoice.balanceDue = round2(Math.max(0, gstInvoice.grandTotal - gstInvoice.amountPaid));
        gstInvoice.paymentStatus =
          gstInvoice.balanceDue === 0 ? 'Paid' : gstInvoice.amountPaid > 0 ? 'Partial' : 'Unpaid';
        gstInvoice.paymentMode = mode;
        gstInvoice.transactionId = mode === 'online' ? trimmedTxnId : null;
        if (gstInvoice.balanceDue === 0) gstInvoice.paidAt = new Date();
        await gstInvoice.save();
      }
    }

    if (collection.serviceChargeId) {
      await ServiceCharge.findByIdAndUpdate(collection.serviceChargeId, {
        paymentStatus: collection.status === 'Paid' ? 'Paid' : 'Pending',
        paymentMode: mode,
        transactionId: mode === 'online' ? trimmedTxnId : null,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment recorded successfully',
      collection,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

const reversePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { paymentId, reason } = req.body;
    const trimmedReason = String(reason || '').trim();

    if (!trimmedReason || trimmedReason.length < 3) {
      return next(errorHandler(400, 'Please provide a reason for reversing this payment'));
    }

    const collection = await Collection.findById(id);
    if (!collection) return next(errorHandler(404, 'Bill not found'));

    const customer = await Customer.findById(collection.customerId);
    if (!customer) return next(errorHandler(404, 'Customer not found'));

    let reverseAmount = 0;
    let targetPaymentSubdoc = null;
    let originalCollectorId = collection.userId || req.user.id;

    if (paymentId) {
      targetPaymentSubdoc = collection.payments.id(paymentId);
      if (!targetPaymentSubdoc) {
        return next(errorHandler(404, 'Payment entry not found on this bill'));
      }
      if (targetPaymentSubdoc.reversed) {
        return next(errorHandler(400, 'This payment entry has already been reversed'));
      }
      reverseAmount = round2(Number(targetPaymentSubdoc.amount));
      if (targetPaymentSubdoc.collectedBy) {
        originalCollectorId = targetPaymentSubdoc.collectedBy;
      }
    } else {
      reverseAmount = round2(Number(req.body.amount));
    }

    if (!Number.isFinite(reverseAmount) || reverseAmount <= 0) {
      return next(errorHandler(400, 'Reversal amount must be a positive number'));
    }

    if (reverseAmount > Number(collection.amountPaid || 0)) {
      return next(
        errorHandler(
          400,
          `Reversal amount (₹${reverseAmount}) cannot exceed total paid on this bill (₹${collection.amountPaid})`
        )
      );
    }

    const currentAdvance = Math.max(0, Number(customer.advanceAmount) || 0);
    const advanceToDeduct = round2(Math.min(currentAdvance, reverseAmount));
    const dueToRestore = round2(reverseAmount - advanceToDeduct);

    customer.advanceAmount = round2(currentAdvance - advanceToDeduct);
    collection.amountPaid = round2(Math.max(0, Number(collection.amountPaid) - reverseAmount));
    collection.amountDue = round2(Number(collection.amountDue) + dueToRestore);
    customer.remainingBalance = round2((Number(customer.remainingBalance) || 0) + dueToRestore);
    collection.status = collection.amountDue > 0 ? 'Pending' : 'Paid';

    if (targetPaymentSubdoc) {
      targetPaymentSubdoc.reversed = true;
      targetPaymentSubdoc.reversedBy = req.user.id;
      targetPaymentSubdoc.reversedAt = new Date();
      targetPaymentSubdoc.reversalReason = trimmedReason;
    }

    customer.transactions.push({
      type: 'reversal',
      amount: reverseAmount,
      collectedBy: originalCollectorId,
      note: `Reversed by ${req.user.userName}: ${trimmedReason}`,
    });

    await collection.save();
    await customer.save();

    if (collection.gstInvoiceId) {
      const gstInvoice = await GstInvoice.findById(collection.gstInvoiceId);
      if (gstInvoice && !gstInvoice.isCancelled) {
        gstInvoice.amountPaid = round2(Math.max(0, gstInvoice.amountPaid - dueToRestore));
        gstInvoice.balanceDue = round2(Math.max(0, gstInvoice.grandTotal - gstInvoice.amountPaid));
        gstInvoice.paymentStatus =
          gstInvoice.balanceDue === 0 ? 'Paid' : gstInvoice.amountPaid > 0 ? 'Partial' : 'Unpaid';
        if (gstInvoice.balanceDue > 0) gstInvoice.paidAt = null;
        await gstInvoice.save();
      }
    }

    if (collection.serviceChargeId && collection.amountDue > 0) {
      await ServiceCharge.findByIdAndUpdate(collection.serviceChargeId, {
        paymentStatus: 'Pending',
      });
    }

    res.status(200).json({
      success: true,
      message: `Reversed ₹${reverseAmount} successfully`,
      collection,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

const getBillById = async (req, res, next) => {
  try {
    const bill = await Collection.findById(req.params.id)
      .populate(
        'customerId',
        'name mobile address status isGstCustomer companyName gstin planId advanceAmount remainingBalance'
      )
      .populate('userId', 'userName')
      .populate('gstInvoiceId')
      .populate('payments.collectedBy', 'userName')
      .populate('payments.reversedBy', 'userName');

    if (!bill) return next(errorHandler(404, 'Bill not found'));

    res.status(200).json({ success: true, bill });
  } catch (error) {
    next(error);
  }
};

const getOverduePayments = async (req, res, next) => {
  try {
    const { customerId } = req.query;
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    const filter = {
      status: { $in: ['Overdue', 'Pending'] },
      amountDue: { $gt: 0 },
      $or: [{ year: { $lt: year } }, { year, month: { $lt: month } }],
    };
    if (customerId) filter.customerId = customerId;

    const data = await Collection.find(filter)
      .populate('customerId', 'name mobile address status isGstCustomer companyName gstin')
      .sort({ year: -1, month: -1 });

    res.status(200).json({ success: true, message: 'Overdue payments fetched', data });
  } catch (error) {
    next(error);
  }
};

const getPendingPayments = async (req, res, next) => {
  try {
    const { customerId } = req.query;
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    const filter = { status: 'Pending', amountDue: { $gt: 0 }, month, year };
    if (customerId) filter.customerId = customerId;

    const data = await Collection.find(filter)
      .populate('customerId', 'name mobile address status isGstCustomer companyName gstin')
      .sort({ updatedAt: -1 });

    res.status(200).json({ success: true, message: 'Pending payments fetched', data });
  } catch (error) {
    next(error);
  }
};

// Returns ALL current-month bills PLUS any unpaid Overdue/Pending arrears from previous cycles
const getcurrentmonthcollection = async (req, res, next) => {
  try {
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    const collection = await Collection.find({
      $or: [
        { month, year },
        { amountDue: { $gt: 0 }, status: { $in: ['Overdue', 'Pending'] } },
      ],
    })
      .populate('customerId', 'name mobile address status isGstCustomer companyName gstin planId')
      .populate('userId', 'userName')
      .populate('payments.collectedBy', 'userName')
      .sort({ year: -1, month: -1, updatedAt: -1 });

    // Sort cleanly: Overdue first, then Pending, then Paid
    const statusOrder = { Overdue: 0, Pending: 1, Paid: 2 };
    collection.sort((a, b) => {
      const diff = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
      if (diff !== 0) return diff;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    res.status(200).json({
      success: true,
      message: 'Active collections (current month + unpaid arrears) fetched successfully',
      collection,
    });
  } catch (error) {
    next(error);
  }
};

const getAllCollections = async (req, res, next) => {
  try {
    const { status, month, year, page, limit } = req.query;
    const filter = {};
    if (status && ['Pending', 'Paid', 'Overdue'].includes(status)) filter.status = status;
    if (month) filter.month = Number(month);
    if (year) filter.year = Number(year);

    const query = Collection.find(filter)
      .populate('customerId', 'name mobile status isGstCustomer companyName gstin')
      .populate('userId', 'userName')
      .sort({ year: -1, month: -1, updatedAt: -1 });

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const [total, collections] = await Promise.all([
        Collection.countDocuments(filter),
        query.skip((pageNum - 1) * limitNum).limit(limitNum),
      ]);

      return res.status(200).json({
        success: true,
        collections,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }

    const collections = await query;
    res.status(200).json({ success: true, collections });
  } catch (error) {
    next(error);
  }
};

const getMonthWiseReport = async (req, res, next) => {
  try {
    const report = await Collection.aggregate([
      {
        $group: {
          _id: { year: '$year', month: '$month' },
          totalAmountDue: { $sum: '$amountDue' },
          totalAmountPaid: { $sum: '$amountPaid' },
          totalPending: { $sum: '$amountDue' },
          totalExpected: { $sum: { $add: ['$amountDue', '$amountPaid'] } },
          count: { $sum: 1 },
          subscriptionPaid: {
            $sum: { $cond: [{ $ne: ['$billType', 'service'] }, '$amountPaid', 0] },
          },
          subscriptionPending: {
            $sum: { $cond: [{ $ne: ['$billType', 'service'] }, '$amountDue', 0] },
          },
          subscriptionCount: {
            $sum: { $cond: [{ $ne: ['$billType', 'service'] }, 1, 0] },
          },
          servicePaid: {
            $sum: { $cond: [{ $eq: ['$billType', 'service'] }, '$amountPaid', 0] },
          },
          servicePending: {
            $sum: { $cond: [{ $eq: ['$billType', 'service'] }, '$amountDue', 0] },
          },
          serviceCount: {
            $sum: { $cond: [{ $eq: ['$billType', 'service'] }, 1, 0] },
          },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
    ]);

    res.status(200).json({ success: true, report });
  } catch (error) {
    next(error);
  }
};

const getTotalCollectionByAllPlans = async (req, res, next) => {
  try {
    const result = await Collection.aggregate([
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'plans',
          localField: 'customer.planId',
          foreignField: '_id',
          as: 'planDetails',
        },
      },
      { $unwind: { path: '$planDetails', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$planDetails._id',
          planName: { $first: { $ifNull: ['$planDetails.name', 'Unassigned Plan'] } },
          totalAmountDue: { $sum: '$amountDue' },
          totalCollected: { $sum: '$amountPaid' },
          totalPending: { $sum: '$amountDue' },
        },
      },
      {
        $project: {
          _id: 0,
          planId: '$_id',
          planName: 1,
          totalAmountDue: 1,
          totalCollected: 1,
          totalPending: 1,
        },
      },
      { $sort: { totalCollected: -1 } },
    ]);

    res.status(200).json({ success: true, result });
  } catch (error) {
    next(error);
  }
};

const getMonthlyCollectionByUser = async (req, res, next) => {
  try {
    const timezone = process.env.TZ || 'Asia/Kolkata';

    const result = await Customer.aggregate([
      { $unwind: '$transactions' },
      {
        $match: {
          'transactions.type': { $in: ['payment', 'advance', 'reversal'] },
          'transactions.collectedBy': { $ne: null },
        },
      },
      {
        $group: {
          _id: {
            userId: '$transactions.collectedBy',
            year: { $year: { date: '$transactions.date', timezone } },
            month: { $month: { date: '$transactions.date', timezone } },
          },
          totalCollected: {
            $sum: {
              $cond: [
                { $eq: ['$transactions.type', 'reversal'] },
                { $multiply: ['$transactions.amount', -1] },
                '$transactions.amount',
              ],
            },
          },
        },
      },
      {
        $match: { totalCollected: { $gt: 0 } },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $sort: { '_id.year': -1, '_id.month': -1, totalCollected: -1 } },
      {
        $project: {
          _id: 0,
          userId: '$_id.userId',
          userName: { $ifNull: ['$user.userName', 'Unknown'] },
          month: '$_id.month',
          year: '$_id.year',
          totalCollected: 1,
        },
      },
    ]);

    res.status(200).json({ success: true, result });
  } catch (error) {
    next(error);
  }
};

const downloadxl = async (req, res, next) => {
  try {
    const data = await Collection.aggregate([
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $sort: { year: -1, month: -1, updatedAt: -1 } },
      {
        $project: {
          _id: 0,
          StaffName: { $ifNull: ['$user.userName', '—'] },
          CustomerName: { $ifNull: ['$customer.name', 'Deleted Customer'] },
          Mobile: { $ifNull: ['$customer.mobile', '—'] },
          CustomerStatus: { $ifNull: ['$customer.status', 'active'] },
          BillType: { $ifNull: ['$billType', 'monthly'] },
          InvoiceNumber: { $ifNull: ['$invoiceNumber', '—'] },
          IsGstBill: { $ifNull: ['$isGstBill', false] },
          TaxableAmount: { $ifNull: ['$taxableAmount', 0] },
          TaxAmount: { $ifNull: ['$taxAmount', 0] },
          AmountDue: '$amountDue',
          AmountPaid: '$amountPaid',
          PaymentMode: '$paymentMode',
          TransactionId: { $ifNull: ['$transactionId', '—'] },
          Status: '$status',
          Month: '$month',
          Year: '$year',
          DueDate: '$dueDate',
        },
      },
    ]);

    if (data.length === 0) {
      return next(errorHandler(404, 'No collection records found to export'));
    }

    const formatted = data.map((row) => ({
      ...row,
      DueDate: row.DueDate ? new Date(row.DueDate).toLocaleDateString('en-GB') : '—',
    }));

    const worksheet = XLSX.utils.json_to_sheet(formatted);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Collection Report');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=Collection_Report.xlsx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

const createExpense = async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    const remarks = req.body.remarks?.trim();
    const userId = req.user.id;

    if (!Number.isFinite(amount) || amount <= 0) {
      return next(errorHandler(400, 'Expense amount must be a positive number'));
    }
    if (!remarks) {
      return next(errorHandler(400, 'Remarks are required'));
    }

    const newExpense = new Expense({
      userId,
      amount,
      remarks,
    });

    await newExpense.save();

    res.status(201).json({
      success: true,
      message: 'Expense recorded successfully!',
      data: newExpense,
    });
  } catch (error) {
    next(error);
  }
};

const updateExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findById(id);
    if (!expense) return next(errorHandler(404, 'Expense not found'));

    if (expense.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(errorHandler(403, 'You can only edit your own expenses'));
    }
    if (expense.status === 'claimed') {
      return next(errorHandler(400, 'Claimed expenses cannot be edited'));
    }

    if (req.body.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return next(errorHandler(400, 'Expense amount must be positive'));
      }
      expense.amount = amount;
    }

    if (req.body.remarks !== undefined) {
      const remarks = String(req.body.remarks).trim();
      if (!remarks) return next(errorHandler(400, 'Remarks cannot be empty'));
      expense.remarks = remarks;
    }

    await expense.save();

    res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      data: expense,
    });
  } catch (error) {
    next(error);
  }
};

const deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findById(id);
    if (!expense) return next(errorHandler(404, 'Expense not found'));

    if (expense.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(errorHandler(403, 'You can only delete your own expenses'));
    }
    if (expense.status === 'claimed') {
      return next(errorHandler(400, 'Cannot delete an expense already attached to a settlement'));
    }

    await Expense.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

const getTodayExpenseByUser = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const todayExpense = await Expense.find({
      userId,
      status: 'unclaimed',
    }).sort({ date: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      message: 'Unclaimed expenses retrieved successfully',
      todayExpense,
    });
  } catch (error) {
    next(error);
  }
};

const createDailycol = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const collectionAmount = Number(req.body.collectionAmount);

    if (!Number.isFinite(collectionAmount) || collectionAmount < 0) {
      return next(errorHandler(400, 'Collection amount must be a valid non-negative number'));
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingRecord = await Admin.findOne({
      userId,
      collectionDate: { $gte: startOfDay, $lte: endOfDay },
    });

    if (existingRecord) {
      return next(errorHandler(400, "Today's collection has already been submitted."));
    }

    const rawIds = [];
    if (Array.isArray(req.body.expenseIds)) {
      req.body.expenseIds.forEach((eid) => {
        if (eid) rawIds.push(String(eid));
      });
    }
    if (req.body.expenseId) {
      rawIds.push(String(req.body.expenseId));
    }
    const uniqueExpenseIds = [...new Set(rawIds)];

    let validExpenseIds = [];
    if (uniqueExpenseIds.length > 0) {
      const foundExpenses = await Expense.find({
        _id: { $in: uniqueExpenseIds },
        userId,
        status: 'unclaimed',
      });

      if (foundExpenses.length !== uniqueExpenseIds.length) {
        return next(
          errorHandler(400, 'One or more selected expenses are invalid or already claimed.')
        );
      }

      await Expense.updateMany(
        { _id: { $in: uniqueExpenseIds } },
        { $set: { status: 'claimed' } }
      );
      validExpenseIds = foundExpenses.map((e) => e._id);
    }

    let subscriptionAmount =
      req.body.subscriptionAmount !== undefined && req.body.subscriptionAmount !== ''
        ? round2(Math.max(0, Number(req.body.subscriptionAmount) || 0))
        : null;
    let serviceAmount =
      req.body.serviceAmount !== undefined && req.body.serviceAmount !== ''
        ? round2(Math.max(0, Number(req.body.serviceAmount) || 0))
        : null;
    let advanceAmount =
      req.body.advanceAmount !== undefined && req.body.advanceAmount !== ''
        ? round2(Math.max(0, Number(req.body.advanceAmount) || 0))
        : null;

    // Auto-calculate today's subscription vs service split if caller didn't send explicit split
    if (subscriptionAmount === null && serviceAmount === null) {
      const todayCols = await Collection.aggregate([
        { $unwind: '$payments' },
        {
          $match: {
            'payments.reversed': { $ne: true },
            'payments.date': { $gte: startOfDay, $lte: endOfDay },
          },
        },
        {
          $project: {
            billType: 1,
            collectedBy: { $toString: '$payments.collectedBy' },
            amount: '$payments.amount',
          },
        },
        { $match: { collectedBy: String(userId) } },
        {
          $group: {
            _id: { $cond: [{ $eq: ['$billType', 'service'] }, 'service', 'subscription'] },
            total: { $sum: '$amount' },
          },
        },
      ]);
      subscriptionAmount = 0;
      serviceAmount = 0;
      todayCols.forEach((row) => {
        if (row._id === 'service') serviceAmount = round2(row.total);
        else subscriptionAmount = round2(row.total);
      });
      advanceAmount = round2(Math.max(0, collectionAmount - subscriptionAmount - serviceAmount));
    } else {
      subscriptionAmount = subscriptionAmount ?? 0;
      serviceAmount = serviceAmount ?? 0;
      advanceAmount = advanceAmount ?? 0;
    }

    const newCollection = await Admin.create({
      userId,
      collectionAmount,
      subscriptionAmount,
      serviceAmount,
      advanceAmount,
      recievedAmount: 0,
      collectionDate: new Date(),
      status: 'Pending',
      expenseId: validExpenseIds[0] || null,
      expenseIds: validExpenseIds,
    });

    res.status(201).json({
      success: true,
      message: 'Daily collection submitted successfully!',
      newCollection,
    });
  } catch (error) {
    next(error);
  }
};

const getDailySubmitedCollections = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const docs = await Admin.find({ userId })
      .populate({ path: 'userId', select: 'userName' })
      .populate({ path: 'expenseId', select: 'amount remarks date' })
      .populate({ path: 'expenseIds', select: 'amount remarks date' })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    const report = docs.map((item) => {
      const { expensesList, totalExpenseAmount, combinedRemarks } =
        summarizeSettlementExpenses(item);
      return {
        ...item,
        expensesList,
        totalExpenseAmount,
        combinedRemarks,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Submitted collections fetched successfully',
      report,
    });
  } catch (error) {
    next(error);
  }
};

const getAllAdminData = async (req, res, next) => {
  try {
    const docs = await Admin.find()
      .populate({ path: 'userId', select: 'userName' })
      .populate({ path: 'expenseId', select: 'amount remarks date' })
      .populate({ path: 'expenseIds', select: 'amount remarks date' })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const data = docs.map((item) => {
      const { expensesList, totalExpenseAmount, combinedRemarks } =
        summarizeSettlementExpenses(item);
      return {
        ...item,
        expensesList,
        totalExpenseAmount,
        combinedRemarks,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const receiveCollection = async (req, res, next) => {
  try {
    const { id } = req.params;

    const record = await Admin.findById(id)
      .populate({ path: 'expenseId', select: 'amount remarks status' })
      .populate({ path: 'expenseIds', select: 'amount remarks status' });

    if (!record) return next(errorHandler(404, 'Collection submission record not found'));

    if (record.status === 'Recieved') {
      return next(errorHandler(400, 'Collection has already been marked as received'));
    }

    const { expensesList, totalExpenseAmount } = summarizeSettlementExpenses(record);

    if (expensesList.length > 0) {
      const idsToClaim = expensesList.map((e) => e._id);
      await Expense.updateMany({ _id: { $in: idsToClaim } }, { $set: { status: 'claimed' } });
    }

    const calculatedRecievedAmount = Math.max(
      0,
      Number(record.collectionAmount) - totalExpenseAmount
    );

    record.status = 'Recieved';
    record.recievedAmount = calculatedRecievedAmount;
    await record.save();

    res.status(200).json({
      success: true,
      message: 'Collection marked as received',
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

const downloadAdminExcel = async (req, res, next) => {
  try {
    const data = await Admin.find()
      .populate({ path: 'userId', select: 'userName' })
      .populate({ path: 'expenseId', select: 'amount remarks' })
      .populate({ path: 'expenseIds', select: 'amount remarks' })
      .sort({ createdAt: -1 })
      .lean();

    if (!data.length) {
      return next(errorHandler(404, 'No settlement records found to export'));
    }

    const excelData = data.map((item) => {
      const { totalExpenseAmount, combinedRemarks } = summarizeSettlementExpenses(item);
      return {
        StaffName: item.userId?.userName || '—',
        SubscriptionAmount: item.subscriptionAmount ?? 0,
        ServiceAmount: item.serviceAmount ?? 0,
        AdvanceAmount: item.advanceAmount ?? 0,
        TotalCollectionAmount: item.collectionAmount ?? 0,
        ExpenseAmount: totalExpenseAmount,
        ReceivedAmount: item.recievedAmount ?? 0,
        CollectionDate: item.collectionDate
          ? new Date(item.collectionDate).toLocaleDateString('en-GB')
          : '—',
        Status: item.status === 'Recieved' ? 'Received' : item.status || '—',
        Remarks: combinedRemarks || '—',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Admin Collection');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename=Admin_Collection_Report.xlsx');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

export default {
  previewMonthlyBilling,
  getBillingRuns,
  generateSingleCustomerBill,
  makePayment,
  reversePayment,
  getBillById,
  getOverduePayments,
  getPendingPayments,
  getcurrentmonthcollection,
  getAllCollections,
  getMonthWiseReport,
  getTotalCollectionByAllPlans,
  getMonthlyCollectionByUser,
  downloadxl,
  generateMonthlyCollectionss,
  createExpense,
  updateExpense,
  deleteExpense,
  getTodayExpenseByUser,
  getDailySubmitedCollections,
  createDailycol,
  getAllAdminData,
  receiveCollection,
  downloadAdminExcel,
};
