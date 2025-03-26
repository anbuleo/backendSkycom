import express from "express"
import {verifyToken} from "../uitils/verifyUser.js"
import customerController from "../controllers/customer.controller.js"
import multer from 'multer'

const router = express.Router()
const upload = multer({ dest: "uploads/" });

router.post('/createcustomer',verifyToken,customerController.createCustomer)
router.put('/changeplan/:id',verifyToken,customerController.changePlan)
router.delete('/deletecustomer/:id',verifyToken,customerController.deleteCustomer)
router.get('/getallcustomer',verifyToken,customerController.getAllCustomer)
router.get('/get20',verifyToken,customerController.getLast20Transactions)
router.post('/bulk-upload',verifyToken,upload.single("file"),customerController.bulkCreateCustomers)


export default router

