import express from 'express';
import { verifyToken, verifyApproved, verifyAdmin } from '../uitils/verifyUser.js';
import serviceController from '../controllers/service.controller.js';

const router = express.Router();

router.post('/add', verifyToken, verifyApproved, serviceController.addServiceCharge);
router.get('/list', verifyToken, verifyApproved, serviceController.listServiceCharges);
router.get(
  '/monthly-category-report',
  verifyToken,
  verifyApproved,
  serviceController.getMonthlyServiceCategoryReport
);
router.delete('/:id', verifyToken, verifyAdmin, serviceController.deleteServiceCharge);

export default router;
