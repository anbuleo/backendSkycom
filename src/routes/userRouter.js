import express from "express"
import userController from "../controllers/user.controller.js"
import { verifyToken } from "../uitils/verifyUser.js"

let router = express.Router()


router.post('/signup',userController.signUp)
router.post('/signin',userController.signin)
router.get('/getalluser',verifyToken,userController.getAlluser)
router.put('/add/:id',verifyToken,userController.adduser)


export default router