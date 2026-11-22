import express from 'express';
import userRouter from './userRouter.js';
import planRouter from './planRouter.js';
import customerRouter from './customerRouter.js';
import collectionRouter from './collectionRouter.js';
import serviceRouter from './serviceRouter.js';
import gstRouter from './gstRouter.js';

const router = express.Router();

router.use('/user', userRouter);
router.use('/plan', planRouter);
router.use('/customer', customerRouter);
router.use('/collection', collectionRouter);
router.use('/service', serviceRouter);
router.use('/gst', gstRouter);

export default router;
