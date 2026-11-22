import fs from 'fs';
import Collection from '../models/collectionModel.js';
import Customer from '../models/customerModel.js';
import Plan from '../models/planModel.js';
import { errorHandler } from '../uitils/errorHandler.js';
import { extractStateCodeFromGstin, isValidGstin } from '../uitils/gstUtils.js';
import XLSX from 'xlsx';

const VALID_STATUSES = ['active', 'suspended', 'disconnected'];

const parseGstFields = (body) => {
  const isGstCustomer = Boolean(
    body.isGstCustomer === true ||
      String(body.isGstCustomer || '').toLowerCase() === 'true' ||
      String(body.isGstCustomer || '').toLowerCase() === 'yes'
  );
  const companyName = String(body.companyName || '').trim();
  const gstin = String(body.gstin || '').trim().toUpperCase();
  const billingAddress = String(body.billingAddress || '').trim();
  const stateCode = extractStateCodeFromGstin(gstin, String(body.stateCode || '33').trim() || '33');
  const gstRate =
    body.gstRate !== undefined && body.gstRate !== '' ? Math.max(0, Number(body.gstRate)) : 18;
  const hsnSac = String(body.hsnSac || '998422').trim() || '998422';
  const email = String(body.email || '').trim().toLowerCase();

  return {
    isGstCustomer,
    companyName,
    gstin,
    billingAddress,
    stateCode,
    gstRate,
    hsnSac,
    email,
  };
};

const createCustomer = async (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const mobile = String(req.body.mobile || '').trim();
    const address = req.body.address?.trim();
    const planId = req.body.planId;
    const status = VALID_STATUSES.includes(req.body.status) ? req.body.status : 'active';
    const advanceAmount = Math.max(0, Number(req.body.advanceAmount) || 0);
    const remainingBalance = Math.max(0, Number(req.body.remainingBalance) || 0);
    const { id } = req.user;

    if (!name || !mobile || !address || !planId) {
      return next(errorHandler(400, 'Name, mobile, address, and plan are required'));
    }

    const gstFields = parseGstFields(req.body);
    if (gstFields.isGstCustomer) {
      if (!gstFields.gstin || !isValidGstin(gstFields.gstin)) {
        return next(
          errorHandler(400, 'Please enter a valid 15-character GSTIN (e.g., 33AACCM8380N1Z1)')
        );
      }
    }

    const [existingCustomer, planExists] = await Promise.all([
      Customer.findOne({ name }),
      Plan.findById(planId),
    ]);

    if (existingCustomer) {
      return next(errorHandler(409, 'Customer name is already registered'));
    }
    if (!planExists) {
      return next(errorHandler(404, 'Selected plan does not exist'));
    }

    const newCustomer = new Customer({
      name,
      mobile,
      address,
      status,
      advanceAmount,
      planId,
      createdBy: id,
      remainingBalance,
      ...gstFields,
    });

    await newCustomer.save();

    res.status(201).json({
      success: true,
      message: 'Customer added successfully',
      newCustomer,
    });
  } catch (error) {
    next(error);
  }
};

const downloadUploadTemplate = async (req, res, next) => {
  try {
    const plans = await Plan.find().sort({ amount: 1 }).lean();
    const firstPlanName = plans[0]?.name || 'Fiber Basic';
    const secondPlanName = plans[1]?.name || firstPlanName;

    const sampleRows = [
      {
        Username: 'Ramesh Kumar',
        Mobile: '9876543210',
        'Installation Address': '12 MG Road, Dharapuram-638656',
        'Package Name': firstPlanName,
        'Advance Amount': 0,
        'Remaining Balance': 0,
        Status: 'active',
        'Is GST Customer': 'No',
        'Company Name': '',
        GSTIN: '',
        'Billing Address': '',
        Email: 'ramesh@example.com',
        'HSN/SAC': '998422',
      },
      {
        Username: 'Viva Communications',
        Mobile: '9655344226',
        'Installation Address': '9th Floor, No 151, Nungambakkam, Chennai-600034',
        'Package Name': secondPlanName,
        'Advance Amount': 0,
        'Remaining Balance': 0,
        Status: 'active',
        'Is GST Customer': 'Yes',
        'Company Name': 'VIVA COMMUNICATIONS PRIVATE LIMITED',
        GSTIN: '33AACCM8380N1Z1',
        'Billing Address':
          '9th Floor, No 151, New No 312, GEE GEE Emerald, Valluvarkottam High Road, Nungambakkam, Tamilnadu-600034',
        Email: 'accounts@vivacomm.in',
        'HSN/SAC': '998422',
      },
    ];

    const workbook = XLSX.utils.book_new();
    const customerSheet = XLSX.utils.json_to_sheet(sampleRows);
    customerSheet['!cols'] = [
      { wch: 24 },
      { wch: 15 },
      { wch: 42 },
      { wch: 20 },
      { wch: 15 },
      { wch: 18 },
      { wch: 12 },
      { wch: 16 },
      { wch: 36 },
      { wch: 18 },
      { wch: 48 },
      { wch: 24 },
      { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(workbook, customerSheet, 'Customers');

    const guideRows = [
      { Field: 'Username', Required: 'Yes', Notes: 'Unique customer name / subscriber ID' },
      { Field: 'Mobile', Required: 'Yes', Notes: '10-digit mobile number' },
      { Field: 'Installation Address', Required: 'Yes', Notes: 'Full installation address' },
      {
        Field: 'Package Name',
        Required: 'Yes',
        Notes: 'Must match one of the active plan names listed below',
      },
      { Field: 'Advance Amount', Required: 'No', Notes: 'Number (default 0)' },
      { Field: 'Remaining Balance', Required: 'No', Notes: 'Opening pending balance (default 0)' },
      { Field: 'Status', Required: 'No', Notes: 'active, suspended, or disconnected (default active)' },
      { Field: 'Is GST Customer', Required: 'No', Notes: 'Yes or No (default No)' },
      { Field: 'Company Name', Required: 'If GST', Notes: 'Legal business name printed on GST invoice' },
      { Field: 'GSTIN', Required: 'If GST', Notes: '15-character GSTIN (e.g. 33AACCM8380N1Z1)' },
      { Field: 'Billing Address', Required: 'No', Notes: 'Defaults to Installation Address if blank' },
      { Field: 'Email', Required: 'No', Notes: 'Optional buyer email' },
      { Field: 'HSN/SAC', Required: 'No', Notes: 'Defaults to 998422 (Bandwidth / ISP Services)' },
      { Field: '', Required: '', Notes: '' },
      { Field: 'AVAILABLE PLANS IN SYSTEM', Required: 'Monthly Rate', Notes: 'Speed (Mbps)' },
      ...plans.map((p) => ({
        Field: p.name,
        Required: `₹${p.amount}`,
        Notes: `${p.speed} Mbps`,
      })),
    ];

    const guideSheet = XLSX.utils.json_to_sheet(guideRows);
    guideSheet['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 56 }];
    XLSX.utils.book_append_sheet(workbook, guideSheet, 'Instructions & Plans');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=SkyComm_Customer_Upload_Format.xlsx'
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

const bulkCreateCustomers = async (req, res, next) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return next(errorHandler(400, 'Please upload an Excel file'));

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return next(errorHandler(400, 'Uploaded Excel file has no sheets'));
    }

    const customersData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    if (!customersData.length) {
      return next(errorHandler(400, 'Uploaded Excel sheet is empty'));
    }

    const plans = await Plan.find().lean();
    const planMap = {};
    plans.forEach((plan) => {
      planMap[plan.name.toLowerCase().trim()] = plan._id;
    });

    const invalidRows = [];
    const invalidCustomers = [];
    const validCandidates = [];

    for (const row of customersData) {
      const name = row['Username'] != null ? String(row['Username']).trim() : '';
      const mobile = row['Mobile'] != null ? String(row['Mobile']).trim() : '';
      const address =
        row['Installation Address'] != null
          ? String(row['Installation Address']).trim()
          : '';
      const planName =
        row['Package Name'] != null
          ? String(row['Package Name']).toLowerCase().trim()
          : '';
      const planId = planMap[planName] || null;
      const rawStatus =
        row['Status'] != null ? String(row['Status']).toLowerCase().trim() : 'active';
      const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : 'active';

      const gstRaw = String(row['Is GST Customer'] ?? '').toLowerCase().trim();
      const isGstCustomer = gstRaw === 'yes' || gstRaw === 'true' || gstRaw === '1';
      const gstin = String(row['GSTIN'] ?? '').trim().toUpperCase();
      const companyName = String(row['Company Name'] ?? '').trim();
      const billingAddress = String(row['Billing Address'] ?? '').trim();
      const email = String(row['Email'] ?? '').trim().toLowerCase();
      const hsnSac = String(row['HSN/SAC'] ?? '998422').trim() || '998422';

      if (!name || !mobile || !address) {
        invalidRows.push({
          name: name || 'Missing Username',
          mobile: mobile || 'Missing Mobile',
          reason: 'Missing required fields (Username, Mobile, or Installation Address)',
        });
        continue;
      }

      if (isGstCustomer && (!gstin || !isValidGstin(gstin))) {
        invalidRows.push({
          name,
          mobile,
          reason: `Invalid GSTIN "${gstin || 'empty'}" for GST customer`,
        });
        continue;
      }

      const candidate = {
        name,
        mobile,
        address,
        status,
        planId,
        planName: row['Package Name'] || '',
        advanceAmount: Math.max(0, Number(row['Advance Amount']) || 0),
        remainingBalance: Math.max(0, Number(row['Remaining Balance']) || 0),
        isGstCustomer,
        companyName,
        gstin,
        billingAddress,
        stateCode: extractStateCodeFromGstin(gstin, '33'),
        gstRate: 18,
        hsnSac,
        email,
        createdBy: req.user.id,
      };

      if (!planId) {
        invalidCustomers.push(candidate);
      } else {
        validCandidates.push(candidate);
      }
    }

    const existingDocs = await Customer.find({
      name: { $in: validCandidates.map((c) => c.name) },
    })
      .select('name')
      .lean();

    const seenNames = new Set(existingDocs.map((c) => c.name));
    const newCustomers = [];
    const duplicateCustomers = [];

    for (const candidate of validCandidates) {
      if (seenNames.has(candidate.name)) {
        duplicateCustomers.push(candidate);
      } else {
        seenNames.add(candidate.name);
        const { planName: _ignored, ...docToInsert } = candidate;
        newCustomers.push(docToInsert);
      }
    }

    let insertedCustomers = [];
    if (newCustomers.length > 0) {
      insertedCustomers = await Customer.insertMany(newCustomers);
    }

    res.status(201).json({
      success: true,
      message: `${insertedCustomers.length} customer(s) added successfully`,
      inserted: insertedCustomers.length,
      duplicates: duplicateCustomers.length,
      invalidPlans: invalidCustomers.length,
      invalidRowsCount: invalidRows.length,
      invalidCustomers,
      duplicateCustomers,
      invalidRows,
    });
  } catch (error) {
    next(error);
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }
  }
};

const getAllCustomer = async (req, res, next) => {
  try {
    const { search, status, isGstCustomer, page, limit } = req.query;
    const filter = {};

    if (status && VALID_STATUSES.includes(status)) {
      filter.status = status === 'active' ? { $in: ['active', null, undefined] } : status;
    }

    if (isGstCustomer === 'true') {
      filter.isGstCustomer = true;
    } else if (isGstCustomer === 'false') {
      filter.isGstCustomer = { $ne: true };
    }

    if (search && String(search).trim()) {
      const escaped = String(search)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { name: rx },
        { companyName: rx },
        { gstin: rx },
        { mobile: rx },
        { address: rx },
      ];
    }

    const baseQuery = Customer.find(filter)
      .populate({
        path: 'planId',
        select: 'name amount speed',
      })
      .populate({
        path: 'transactions.collectedBy',
        model: 'user',
        select: 'userName _id',
      })
      .sort({ name: 1 });

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const [total, customer] = await Promise.all([
        Customer.countDocuments(filter),
        baseQuery.skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      ]);

      return res.status(200).json({
        success: true,
        message: 'Customers fetched successfully',
        customer,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    }

    const customer = await baseQuery.lean();

    res.status(200).json({
      success: true,
      message: 'All customers fetched successfully',
      customer,
    });
  } catch (error) {
    next(error);
  }
};

const changePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { planId, name, mobile, address, status } = req.body;
    const advanceAmount = Math.max(0, Number(req.body.advanceAmount) || 0);
    const remainingBalance = Math.max(0, Number(req.body.remainingBalance) || 0);

    const [cust, isPlan] = await Promise.all([
      Customer.findById(id),
      Plan.findById(planId),
    ]);

    if (!cust) return next(errorHandler(404, 'Customer not found'));
    if (!isPlan) return next(errorHandler(404, 'Selected plan does not exist'));

    const updateSet = {
      planId,
      advanceAmount,
      remainingBalance,
    };

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return next(errorHandler(400, 'Invalid customer status'));
      }
      updateSet.status = status;
    }

    if (req.body.isGstCustomer !== undefined) {
      const gstFields = parseGstFields(req.body);
      if (gstFields.isGstCustomer && (!gstFields.gstin || !isValidGstin(gstFields.gstin))) {
        return next(
          errorHandler(400, 'Please enter a valid 15-character GSTIN (e.g., 33AACCM8380N1Z1)')
        );
      }
      Object.assign(updateSet, gstFields);
    }

    if (name !== undefined && String(name).trim() && String(name).trim() !== cust.name) {
      const trimmedName = String(name).trim();
      const duplicate = await Customer.findOne({ _id: { $ne: id }, name: trimmedName });
      if (duplicate) return next(errorHandler(409, 'Customer name is already taken'));
      updateSet.name = trimmedName;
    }

    if (mobile !== undefined && String(mobile).trim()) {
      updateSet.mobile = String(mobile).trim();
    }

    if (address !== undefined && String(address).trim()) {
      updateSet.address = String(address).trim();
    }

    const transactions = [];
    const oldAdvance = Number(cust.advanceAmount) || 0;
    const oldRemaining = Number(cust.remainingBalance) || 0;

    if (advanceAmount > oldAdvance) {
      transactions.push({
        type: 'advance',
        amount: advanceAmount - oldAdvance,
        collectedBy: req.user.id,
      });
    }

    if (remainingBalance !== oldRemaining) {
      transactions.push({
        type: 'remainbalance',
        amount: remainingBalance,
        collectedBy: req.user.id,
      });
    }

    const updateOp =
      transactions.length > 0
        ? { $set: updateSet, $push: { transactions: { $each: transactions } } }
        : { $set: updateSet };

    const updatedCustomer = await Customer.findByIdAndUpdate(id, updateOp, {
      new: true,
    });

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      customer: updatedCustomer,
    });
  } catch (error) {
    next(error);
  }
};

const updateCustomerStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return next(errorHandler(400, 'Status must be one of: active, suspended, disconnected'));
    }

    const updated = await Customer.findByIdAndUpdate(id, { status }, { new: true });
    if (!updated) return next(errorHandler(404, 'Customer not found'));

    res.status(200).json({
      success: true,
      message: `Customer status changed to ${status}`,
      customer: updated,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const customerExist = await Customer.findById(id);
    if (!customerExist) return next(errorHandler(404, 'Customer not found'));

    await Collection.deleteMany({ customerId: id });
    await Customer.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

const getLast20Transactions = async (req, res, next) => {
  try {
    const transactions = await Customer.aggregate([
      { $unwind: '$transactions' },
      { $match: { 'transactions.type': { $ne: 'due' } } },
      { $sort: { 'transactions.date': -1 } },
      { $limit: 20 },
      {
        $lookup: {
          from: 'users',
          localField: 'transactions.collectedBy',
          foreignField: '_id',
          as: 'collectedBy',
        },
      },
      {
        $unwind: { path: '$collectedBy', preserveNullAndEmptyArrays: true },
      },
      {
        $project: {
          _id: 0,
          customerName: '$name',
          date: '$transactions.date',
          type: '$transactions.type',
          amount: '$transactions.amount',
          note: '$transactions.note',
          collectedBy: {
            _id: '$collectedBy._id',
            userName: '$collectedBy.userName',
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      message: 'Latest 20 transactions fetched successfully',
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

const getCurrentMonthCollectionByStaff = async (req, res, next) => {
  try {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const lastDayOfMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    const timezone = process.env.TZ || 'Asia/Kolkata';

    // 1. Authoritative Subscription vs Service payment split from Collection.payments (excluding reversed entries)
    const collectionPayments = await Collection.aggregate([
      { $unwind: '$payments' },
      {
        $match: {
          'payments.reversed': { $ne: true },
          'payments.collectedBy': { $ne: null },
          'payments.date': { $gte: firstDayOfMonth, $lte: lastDayOfMonth },
        },
      },
      {
        $group: {
          _id: {
            day: { $dayOfMonth: { date: '$payments.date', timezone } },
            collectedBy: '$payments.collectedBy',
            type: {
              $cond: [{ $eq: ['$billType', 'service'] }, 'service', 'subscription'],
            },
          },
          totalCollected: { $sum: '$payments.amount' },
        },
      },
      { $match: { totalCollected: { $gt: 0 } } },
      {
        $lookup: {
          from: 'users',
          localField: '_id.collectedBy',
          foreignField: '_id',
          as: 'collectorInfo',
        },
      },
      { $unwind: { path: '$collectorInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          collectedBy: {
            _id: '$_id.collectedBy',
            userName: { $ifNull: ['$collectorInfo.userName', 'Unknown'] },
          },
          type: '$_id.type',
          totalCollected: { $round: ['$totalCollected', 2] },
        },
      },
    ]);

    // 2. Direct Advance credits collected from Customer.transactions
    const advanceEntries = await Customer.aggregate([
      { $unwind: '$transactions' },
      {
        $match: {
          'transactions.type': 'advance',
          'transactions.collectedBy': { $ne: null },
          'transactions.date': { $gte: firstDayOfMonth, $lte: lastDayOfMonth },
        },
      },
      {
        $group: {
          _id: {
            day: { $dayOfMonth: { date: '$transactions.date', timezone } },
            collectedBy: '$transactions.collectedBy',
          },
          totalCollected: { $sum: '$transactions.amount' },
        },
      },
      { $match: { totalCollected: { $gt: 0 } } },
      {
        $lookup: {
          from: 'users',
          localField: '_id.collectedBy',
          foreignField: '_id',
          as: 'collectorInfo',
        },
      },
      { $unwind: { path: '$collectorInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          collectedBy: {
            _id: '$_id.collectedBy',
            userName: { $ifNull: ['$collectorInfo.userName', 'Unknown'] },
          },
          type: { $literal: 'advance' },
          totalCollected: { $round: ['$totalCollected', 2] },
        },
      },
    ]);

    const result = [...collectionPayments, ...advanceEntries].sort((a, b) => {
      if (b.day !== a.day) return b.day - a.day;
      return String(a.type).localeCompare(String(b.type));
    });

    // Compute today's split specifically for the requesting user
    const todayDay = today.getDate();
    const myId = req.user?.id ? String(req.user.id) : null;
    const todaySplit = {
      subscriptionAmount: 0,
      serviceAmount: 0,
      advanceAmount: 0,
      totalCollected: 0,
    };

    if (myId) {
      result.forEach((row) => {
        if (row.day === todayDay && String(row.collectedBy?._id || '') === myId) {
          const amt = Number(row.totalCollected) || 0;
          if (row.type === 'service') todaySplit.serviceAmount += amt;
          else if (row.type === 'advance') todaySplit.advanceAmount += amt;
          else todaySplit.subscriptionAmount += amt;
        }
      });
      todaySplit.subscriptionAmount = Math.round(todaySplit.subscriptionAmount * 100) / 100;
      todaySplit.serviceAmount = Math.round(todaySplit.serviceAmount * 100) / 100;
      todaySplit.advanceAmount = Math.round(todaySplit.advanceAmount * 100) / 100;
      todaySplit.totalCollected =
        Math.round(
          (todaySplit.subscriptionAmount + todaySplit.serviceAmount + todaySplit.advanceAmount) *
            100
        ) / 100;
    }

    res.status(200).json({
      success: true,
      message: 'Current month staff-wise and day-wise collection split fetched',
      data: result,
      todaySplit,
    });
  } catch (error) {
    next(error);
  }
};

export default {
  createCustomer,
  downloadUploadTemplate,
  changePlan,
  updateCustomerStatus,
  deleteCustomer,
  getAllCustomer,
  bulkCreateCustomers,
  getLast20Transactions,
  getCurrentMonthCollectionByStaff,
};
