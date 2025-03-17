import express from "express"
import { verifyToken } from "../uitils/verifyUser.js"
import collectionController from "../controllers/collection.controller.js"


let router = express.Router()

router.put('/payment',verifyToken,collectionController.makePayment)
router.get('/getcurrentmonth',verifyToken,collectionController.getcurrentmonthcollection)
router.get('/getmonthwisereport',verifyToken,collectionController.getMonthWiseReport)
router.get('/gettotalbyplan',verifyToken,collectionController.getTotalCollectionByAllPlans)
router.get('/getallcollection',verifyToken,collectionController.getAllCollections)
router.get('/getmonthlycollectionbyuser',verifyToken,collectionController.getMonthlyCollectionByUser)
router.get('/download-excel',verifyToken,collectionController.downloadxl)


export default router