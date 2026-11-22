import express from 'express';
import userController from '../controllers/user.controller.js';
import { verifyToken, verifyAdmin } from '../uitils/verifyUser.js';

const router = express.Router();

router.post('/signup', userController.signUp);
router.post('/signin', userController.signin);
router.post('/refresh', userController.refreshToken);
router.get('/me', verifyToken, userController.getCurrentUser);
router.put('/change-password', verifyToken, userController.changePassword);
router.get('/getalluser', verifyToken, verifyAdmin, userController.getAlluser);
router.put('/add/:id', verifyToken, verifyAdmin, userController.adduser);
router.put('/role/:id', verifyToken, verifyAdmin, userController.updateUserRole);
router.put('/reset-password/:id', verifyToken, verifyAdmin, userController.resetPassword);
router.delete('/:id', verifyToken, verifyAdmin, userController.deleteUser);

export default router;
