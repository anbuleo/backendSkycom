import express from 'express';
import { verifyToken, verifyApproved, verifyAdmin } from '../uitils/verifyUser.js';
import collectionController from '../controllers/collection.controller.js';

const router = express.Router();

router.put('/payment', verifyToken, verifyApproved, collectionController.makePayment);
router.post('/reverse/:id', verifyToken, verifyAdmin, collectionController.reversePayment);
router.put('/receive/:id', verifyToken, verifyAdmin, collectionController.receiveCollection);
router.get('/bill/:id', verifyToken, verifyApproved, collectionController.getBillById);
router.get('/overdue', verifyToken, verifyApproved, collectionController.getOverduePayments);
router.get('/pending', verifyToken, verifyApproved, collectionController.getPendingPayments);
router.get('/getcurrentmonth', verifyToken, verifyApproved, collectionController.getcurrentmonthcollection);
router.get('/getmonthwisereport', verifyToken, verifyApproved, collectionController.getMonthWiseReport);
router.get('/gettotalbyplan', verifyToken, verifyApproved, collectionController.getTotalCollectionByAllPlans);
router.get('/getallcollection', verifyToken, verifyApproved, collectionController.getAllCollections);
router.get('/getmonthlycollectionbyuser', verifyToken, verifyApproved, collectionController.getMonthlyCollectionByUser);
router.get('/download-excel', verifyToken, verifyAdmin, collectionController.downloadxl);

// Senior Monthly Subscription Billing Engine routes
router.get('/billing-preview', verifyToken, verifyAdmin, collectionController.previewMonthlyBilling);
router.get('/billing-runs', verifyToken, verifyAdmin, collectionController.getBillingRuns);
router.post('/genratebill', verifyToken, verifyAdmin, collectionController.generateMonthlyCollectionss);
router.post('/generate-bill', verifyToken, verifyAdmin, collectionController.generateMonthlyCollectionss);
router.post(
  '/generate-customer-bill/:customerId',
  verifyToken,
  verifyAdmin,
  collectionController.generateSingleCustomerBill
);
router.post(
  '/sync-opening-balances',
  verifyToken,
  verifyAdmin,
  collectionController.syncOpeningBalances
);

router.post('/expense', verifyToken, verifyApproved, collectionController.createExpense);
router.put('/expense/:id', verifyToken, verifyApproved, collectionController.updateExpense);
router.delete('/expense/:id', verifyToken, verifyApproved, collectionController.deleteExpense);
router.get('/getexpense', verifyToken, verifyApproved, collectionController.getTodayExpenseByUser);
router.post('/submitreport', verifyToken, verifyApproved, collectionController.createDailycol);
router.get('/getreport', verifyToken, verifyApproved, collectionController.getDailySubmitedCollections);
router.get('/getalladmin', verifyToken, verifyAdmin, collectionController.getAllAdminData);
router.get('/download-admin-excel', verifyToken, verifyAdmin, collectionController.downloadAdminExcel);

export default router;
