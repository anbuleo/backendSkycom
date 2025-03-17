import express from 'express'
import {verifyToken} from "../uitils/verifyUser.js"
import planController from "../controllers/plan.controller.js"



let router = express.Router()

router.post('/createplan',verifyToken,planController.createPlan)
router.put('/editplan/:id',verifyToken,planController.editPlan)
router.delete('/deleteplan/:id',verifyToken,planController.deletePlan)
router.get('/getallplan',verifyToken,planController.getAllPlan)



export default router