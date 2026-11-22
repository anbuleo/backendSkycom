import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { verifyToken, verifyApproved, verifyAdmin } from '../uitils/verifyUser.js';
import customerController from '../controllers/customer.controller.js';
import { errorHandler } from '../uitils/errorHandler.js';

const router = express.Router();

const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(errorHandler(400, 'Only Excel (.xlsx, .xls) or CSV files are allowed'));
    }
  },
});

router.post('/createcustomer', verifyToken, verifyApproved, customerController.createCustomer);
router.put('/changeplan/:id', verifyToken, verifyAdmin, customerController.changePlan);
router.put('/status/:id', verifyToken, verifyAdmin, customerController.updateCustomerStatus);
router.delete('/deletecustomer/:id', verifyToken, verifyAdmin, customerController.deleteCustomer);
router.get('/getallcustomer', verifyToken, verifyApproved, customerController.getAllCustomer);
router.get('/getcollection', verifyToken, verifyApproved, customerController.getCurrentMonthCollectionByStaff);
router.get('/get20', verifyToken, verifyApproved, customerController.getLast20Transactions);
router.get('/upload-template', verifyToken, verifyApproved, customerController.downloadUploadTemplate);
router.post('/bulk-upload', verifyToken, verifyApproved, upload.single('file'), customerController.bulkCreateCustomers);

export default router;
