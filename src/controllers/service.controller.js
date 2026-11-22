import ServiceCharge from '../models/serviceChargeModel.js';
import Customer from '../models/customerModel.js';
import Collection from '../models/collectionModel.js';
import { errorHandler } from '../uitils/errorHandler.js';
import {
  calculateGstBreakdown,
  extractStateCodeFromGstin,
  getOrCreateCompanySettings,
  round2,
} from '../uitils/gstUtils.js';
import { createGstInvoiceInternal } from './gst.controller.js';

const addServiceCharge = async (req, res, next) => {
  try {
    const {
      customerId,
      serviceName,
      description = '',
      hsnSac,
      amount,
      payNow = false,
      paymentMode = 'cash',
      transactionId = null,
      isGstApplicable,
      gstRate,
      generateGstInvoice,
      serviceDate,
    } = req.body;

    const cleanName = String(serviceName || '').trim();
    const baseAmount = round2(Number(amount));

    if (!customerId) return next(errorHandler(400, 'Please select a customer'));
    if (!cleanName) return next(errorHandler(400, 'Service name is required'));
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      return next(errorHandler(400, 'Service charge amount must be greater than 0'));
    }

    const customer = await Customer.findById(customerId);
    if (!customer) return next(errorHandler(404, 'Customer not found'));

    const isPaidNow = Boolean(payNow);
    const trimmedTxnId = transactionId ? String(transactionId).trim() : null;

    if (isPaidNow) {
      if (!['cash', 'online'].includes(paymentMode)) {
        return next(errorHandler(400, 'Invalid payment mode'));
      }
      if (paymentMode === 'online' && !trimmedTxnId) {
        return next(errorHandler(400, 'Transaction ID is required for online service payments'));
      }
    }

    const settings = await getOrCreateCompanySettings();
    const applyGst =
      typeof isGstApplicable === 'boolean' ? isGstApplicable : Boolean(customer.isGstCustomer);
    const effectiveGstRate = applyGst
      ? Number(gstRate ?? customer.gstRate ?? settings.defaultGstRate ?? 18)
      : 0;
    const effectiveHsn = String(
      hsnSac || customer.hsnSac || settings.defaultHsnSac || '998422'
    ).trim();

    const buyerStateCode = extractStateCodeFromGstin(
      customer.gstin,
      customer.stateCode || settings.stateCode || '33'
    );
    const tax = calculateGstBreakdown({
      taxableValue: baseAmount,
      gstRate: effectiveGstRate,
      buyerStateCode,
      sellerStateCode: settings.stateCode || '33',
    });

    const sDate = serviceDate ? new Date(serviceDate) : new Date();
    const month = sDate.getMonth() + 1;
    const year = sDate.getFullYear();

    // Create linked Collection record so unpaid services can be collected cleanly from Collect / StaffPWA
    const collection = await Collection.create({
      userId: req.user.id,
      customerId: customer._id,
      billType: 'service',
      description: `${cleanName}${description ? ` — ${description.trim()}` : ''}`,
      isGstBill: applyGst,
      taxableAmount: tax.taxableValue,
      taxAmount: tax.totalTax,
      amountDue: isPaidNow ? 0 : tax.grandTotal,
      amountPaid: isPaidNow ? tax.grandTotal : 0,
      dueDate: sDate,
      month,
      year,
      status: isPaidNow ? 'Paid' : 'Pending',
      paymentMode: isPaidNow ? paymentMode : 'cash',
      transactionId: isPaidNow && paymentMode === 'online' ? trimmedTxnId : null,
      payments: isPaidNow
        ? [
            {
              amount: tax.grandTotal,
              paymentMode,
              transactionId: paymentMode === 'online' ? trimmedTxnId : null,
              collectedBy: req.user.id,
              date: sDate,
            },
          ]
        : [],
    });

    const serviceCharge = await ServiceCharge.create({
      customerId: customer._id,
      serviceName: cleanName,
      description: String(description || '').trim(),
      hsnSac: effectiveHsn,
      baseAmount: tax.taxableValue,
      isGstApplicable: applyGst,
      gstRate: tax.gstRate,
      cgstAmount: tax.cgstAmount,
      sgstAmount: tax.sgstAmount,
      igstAmount: tax.igstAmount,
      totalAmount: tax.grandTotal,
      paymentStatus: isPaidNow ? 'Paid' : 'Pending',
      paymentMode: isPaidNow ? paymentMode : 'unpaid',
      transactionId: isPaidNow && paymentMode === 'online' ? trimmedTxnId : null,
      collectionId: collection._id,
      recordedBy: req.user.id,
      serviceDate: sDate,
    });

    collection.serviceChargeId = serviceCharge._id;

    // Generate GST invoice automatically when GST is applied (or explicitly requested)
    let gstInvoice = null;
    const shouldGenerateInvoice =
      applyGst && (generateGstInvoice === undefined ? true : Boolean(generateGstInvoice));

    if (shouldGenerateInvoice) {
      gstInvoice = await createGstInvoiceInternal({
        customer,
        items: [
          {
            particulars: `${cleanName}${description ? ` - ${description.trim()}` : ''}`,
            hsnSac: effectiveHsn,
            quantity: 1,
            rate: tax.taxableValue,
            amount: tax.taxableValue,
          },
        ],
        invoiceDate: sDate,
        invoiceType: 'service',
        gstRateOverride: effectiveGstRate,
        collectionId: collection._id,
        serviceChargeId: serviceCharge._id,
        initialAmountPaid: isPaidNow ? tax.grandTotal : 0,
        initialPaymentMode: isPaidNow ? paymentMode : 'unpaid',
        initialTransactionId: isPaidNow && paymentMode === 'online' ? trimmedTxnId : null,
        createdBy: req.user.id,
      });

      serviceCharge.gstInvoiceId = gstInvoice._id;
      serviceCharge.invoiceNumber = gstInvoice.invoiceNumber;
      await serviceCharge.save();

      collection.gstInvoiceId = gstInvoice._id;
      collection.invoiceNumber = gstInvoice.invoiceNumber;
    }

    await collection.save();

    // Always record in Customer History (transactions[]) + update customer balance
    const invoiceTag = gstInvoice ? ` • Invoice ${gstInvoice.invoiceNumber}` : '';
    const detailNote = `${cleanName}${description ? ` (${description.trim()})` : ''}${invoiceTag}`;

    if (isPaidNow) {
      customer.transactions.push({
        type: 'service',
        amount: tax.grandTotal,
        collectedBy: req.user.id,
        note: `${detailNote} [Paid - ${paymentMode.toUpperCase()}]`,
      });
      customer.transactions.push({
        type: 'payment',
        amount: tax.grandTotal,
        collectedBy: req.user.id,
        note: `Service Payment: ${detailNote}`,
      });
    } else {
      customer.remainingBalance = round2((Number(customer.remainingBalance) || 0) + tax.grandTotal);
      customer.transactions.push({
        type: 'service',
        amount: tax.grandTotal,
        collectedBy: req.user.id,
        note: `${detailNote} [Added to Due]`,
      });
    }

    await customer.save();

    res.status(201).json({
      success: true,
      message: isPaidNow
        ? `Service "${cleanName}" recorded & marked paid${gstInvoice ? ` (${gstInvoice.invoiceNumber})` : ''}`
        : `Service "${cleanName}" added to customer due${gstInvoice ? ` (${gstInvoice.invoiceNumber})` : ''}`,
      serviceCharge,
      collection,
      gstInvoice,
    });
  } catch (error) {
    next(error);
  }
};

const listServiceCharges = async (req, res, next) => {
  try {
    const { customerId, paymentStatus, search } = req.query;
    const filter = {};
    if (customerId) filter.customerId = customerId;
    if (paymentStatus && ['Paid', 'Pending'].includes(paymentStatus)) {
      filter.paymentStatus = paymentStatus;
    }

    let services = await ServiceCharge.find(filter)
      .populate('customerId', 'name mobile companyName isGstCustomer gstin')
      .populate('recordedBy', 'userName')
      .sort({ serviceDate: -1, createdAt: -1 })
      .limit(200)
      .lean();

    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      services = services.filter(
        (s) =>
          String(s.serviceName || '').toLowerCase().includes(q) ||
          String(s.description || '').toLowerCase().includes(q) ||
          String(s.customerId?.name || '').toLowerCase().includes(q) ||
          String(s.customerId?.mobile || '').toLowerCase().includes(q) ||
          String(s.invoiceNumber || '').toLowerCase().includes(q)
      );
    }

    res.status(200).json({
      success: true,
      services,
    });
  } catch (error) {
    next(error);
  }
};

const deleteServiceCharge = async (req, res, next) => {
  try {
    const { id } = req.params;
    const service = await ServiceCharge.findById(id);
    if (!service) return next(errorHandler(404, 'Service record not found'));

    if (service.paymentStatus === 'Paid') {
      return next(
        errorHandler(400, 'Paid service charges cannot be deleted. Reverse the payment first.')
      );
    }
    if (service.gstInvoiceId) {
      return next(
        errorHandler(
          400,
          'This service has a GST invoice attached. Cancel the GST invoice instead to preserve audit sequence.'
        )
      );
    }

    if (service.collectionId) {
      await Collection.findByIdAndDelete(service.collectionId);
    }

    const customer = await Customer.findById(service.customerId);
    if (customer) {
      customer.remainingBalance = round2(
        Math.max(0, (Number(customer.remainingBalance) || 0) - Number(service.totalAmount || 0))
      );
      customer.transactions.push({
        type: 'reversal',
        amount: service.totalAmount,
        collectedBy: req.user.id,
        note: `Removed unpaid service: ${service.serviceName}`,
      });
      await customer.save();
    }

    await ServiceCharge.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Unpaid service charge removed successfully',
    });
  } catch (error) {
    next(error);
  }
};

const getMonthlyServiceCategoryReport = async (req, res, next) => {
  try {
    const timezone = process.env.TZ || 'Asia/Kolkata';
    const filterMonth = req.query.month ? Number(req.query.month) : null;
    const filterYear = req.query.year ? Number(req.query.year) : null;

    const allRows = await ServiceCharge.aggregate([
      {
        $lookup: {
          from: 'collections',
          localField: 'collectionId',
          foreignField: '_id',
          as: 'col',
        },
      },
      { $unwind: { path: '$col', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          svcYear: { $year: { date: '$serviceDate', timezone } },
          svcMonth: { $month: { date: '$serviceDate', timezone } },
          collectedAmt: {
            $cond: [
              { $ifNull: ['$col._id', false] },
              { $ifNull: ['$col.amountPaid', 0] },
              { $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalAmount', 0] },
            ],
          },
          pendingAmt: {
            $cond: [
              { $ifNull: ['$col._id', false] },
              { $ifNull: ['$col.amountDue', 0] },
              { $cond: [{ $eq: ['$paymentStatus', 'Pending'] }, '$totalAmount', 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            year: '$svcYear',
            month: '$svcMonth',
            serviceName: '$serviceName',
          },
          count: { $sum: 1 },
          gstCount: { $sum: { $cond: ['$isGstApplicable', 1, 0] } },
          totalBase: { $sum: '$baseAmount' },
          totalBilled: { $sum: '$totalAmount' },
          totalCollected: { $sum: '$collectedAmt' },
          totalPending: { $sum: '$pendingAmt' },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1, totalCollected: -1, totalBilled: -1 } },
      {
        $project: {
          _id: 0,
          year: '$_id.year',
          month: '$_id.month',
          serviceName: '$_id.serviceName',
          count: 1,
          gstCount: 1,
          totalBase: { $round: ['$totalBase', 2] },
          totalBilled: { $round: ['$totalBilled', 2] },
          totalCollected: { $round: ['$totalCollected', 2] },
          totalPending: { $round: ['$totalPending', 2] },
        },
      },
    ]);

    const monthMap = new Map();
    allRows.forEach((r) => {
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      const existing = monthMap.get(key) || {
        year: r.year,
        month: r.month,
        totalCollected: 0,
        totalBilled: 0,
        count: 0,
      };
      existing.totalCollected = round2(existing.totalCollected + r.totalCollected);
      existing.totalBilled = round2(existing.totalBilled + r.totalBilled);
      existing.count += r.count;
      monthMap.set(key, existing);
    });

    const availableMonths = Array.from(monthMap.values()).sort(
      (a, b) => b.year - a.year || b.month - a.month
    );

    const rows = allRows.filter((r) => {
      if (filterYear && r.year !== filterYear) return false;
      if (filterMonth && r.month !== filterMonth) return false;
      return true;
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.totalCount += r.count;
        acc.totalBilled = round2(acc.totalBilled + r.totalBilled);
        acc.totalCollected = round2(acc.totalCollected + r.totalCollected);
        acc.totalPending = round2(acc.totalPending + r.totalPending);
        return acc;
      },
      { totalCount: 0, totalBilled: 0, totalCollected: 0, totalPending: 0 }
    );

    res.status(200).json({
      success: true,
      rows,
      availableMonths,
      totals,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  addServiceCharge,
  listServiceCharges,
  deleteServiceCharge,
  getMonthlyServiceCategoryReport,
};
