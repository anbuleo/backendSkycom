import express from 'express';
import { verifyToken, verifyApproved, verifyAdmin } from '../uitils/verifyUser.js';
import gstController from '../controllers/gst.controller.js';

const router = express.Router();

router.get('/settings', verifyToken, verifyApproved, gstController.getCompanySettings);
router.put('/settings', verifyToken, verifyAdmin, gstController.updateCompanySettings);
router.get('/monthly-status', verifyToken, verifyApproved, gstController.getMonthlyGstStatus);
router.post('/generate-missing', verifyToken, verifyAdmin, gstController.generateMissingMonthlyGstBills);
router.get('/invoices', verifyToken, verifyApproved, gstController.listGstInvoices);
router.get('/invoices/:id', verifyToken, verifyApproved, gstController.getGstInvoiceById);
router.post('/invoices', verifyToken, verifyAdmin, gstController.createManualGstInvoice);
router.put('/invoices/:id/payment', verifyToken, verifyApproved, gstController.recordGstInvoicePayment);
router.put('/invoices/:id/cancel', verifyToken, verifyAdmin, gstController.cancelGstInvoice);
router.get('/download-audit-excel', verifyToken, verifyAdmin, gstController.downloadGstAuditExcel);

export default router;
