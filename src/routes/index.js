import express from 'express'
import userRouter from './userRouter.js'
import planRouter from "./planRouter.js"
import customerRouter from "./customerRouter.js"
import collectionRouter from "./collectionRouter.js"


const router = express.Router()

router.use('/user',userRouter)
router.use('/plan',planRouter)
router.use('/customer',customerRouter)
router.use('/collection',collectionRouter)

export default router
