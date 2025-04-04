import express from "express"
import { verifyToken } from "../uitils/verifyUser.js"
import collectionController, { generateMonthlyCollections } from "../controllers/collection.controller.js"


let router = express.Router()

router.put('/payment',verifyToken,collectionController.makePayment)
router.put('/receive/:id',verifyToken,collectionController.receiveCollection)
router.get('/getcurrentmonth',verifyToken,collectionController.getcurrentmonthcollection)
router.get('/getmonthwisereport',verifyToken,collectionController.getMonthWiseReport)
router.get('/gettotalbyplan',verifyToken,collectionController.getTotalCollectionByAllPlans)
router.get('/getallcollection',verifyToken,collectionController.getAllCollections)
router.get('/getmonthlycollectionbyuser',verifyToken,collectionController.getMonthlyCollectionByUser)
router.get('/download-excel',verifyToken,collectionController.downloadxl)
router.post('/genratebill',collectionController.generateMonthlyCollectionss)
router.post('/expense',verifyToken,collectionController.createExpense)
router.post('/submitreport',verifyToken,collectionController.createDailycol)
router.get('/getexpense',verifyToken,collectionController.getTodayExpenseByUser)
router.get('/getalladmin',verifyToken,collectionController.getAllAdminData)
router.get('/download-admin-excel',verifyToken,collectionController.downloadAdminExcel)
router.get('/getreport',verifyToken,collectionController.getDailySubmitedCollections)


export default router