import express from 'express';
import { verifyToken, verifyApproved, verifyAdmin } from '../uitils/verifyUser.js';
import planController from '../controllers/plan.controller.js';

const router = express.Router();

router.post('/createplan', verifyToken, verifyAdmin, planController.createPlan);
router.put('/editplan/:id', verifyToken, verifyAdmin, planController.editPlan);
router.delete('/deleteplan/:id', verifyToken, verifyAdmin, planController.deletePlan);
router.get('/getallplan', verifyToken, verifyApproved, planController.getAllPlan);

export default router;
