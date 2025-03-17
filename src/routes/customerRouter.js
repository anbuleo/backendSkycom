import express from "express"
import {verifyToken} from "../uitils/verifyUser.js"
import customerController from "../controllers/customer.controller.js"

const router = express.Router()

router.post('/createcustomer',verifyToken,customerController.createCustomer)
router.put('/changeplan/:id',verifyToken,customerController.changePlan)
router.delete('/deletecustomer/:id',verifyToken,customerController.deleteCustomer)
router.get('/getallcustomer',verifyToken,customerController.getAllCustomer)


export default router

