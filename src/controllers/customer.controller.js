import Customer from "../models/customerModel.js"
import Plan from "../models/planModel.js"
import { errorHandler } from "../uitils/errorHandler.js"



const createCustomer = async(req,res,next)=>{
    try {
        let {name,mobile,address,planId,advanceAmount,remainingBalance} = req.body
        let {id} = req.user
        let isMobile = await Customer.find({mobile})
        if(isMobile.length >0 ) return next(errorHandler(401,'mobile Number already registered'))

        let newCustomer = new Customer({name,mobile,address,advanceAmount,planId,createdBy:id,remainingBalance})
       await newCustomer.save()
       
       res.status(201).json({
        message:'Customer added Success',
        newCustomer
       })

    } catch (error) {
        next(error)
    }
}

const getAllCustomer = async(req,res,next)=>{
    try {
        let customer = await Customer.find()
        res.status(200).json({
            message:"All customer",
            customer

        })
    } catch (error) {
        next(error)
    }
}

const changePlan = async(req,res,next)=>{
    try {
        let id = req.params.id
        let {planId} = req.body
        let isPlan = await Plan.findById(planId)
        if(!isPlan ) return next(errorHandler(401,"plan Does not exist"))

        let isCustomer = await Customer.findByIdAndUpdate(id,{planId},{new:true})

        if(!isCustomer) return next(errorHandler(401,'customer Not found'))
        
            res.status(200).json({
                message:"plan changed Success"
            })
        
    } catch (error) {
        next(error)
    }
}

const deleteCustomer = async(req,res,next)=>{
    try {
        let id = req.params.id
         let customerExist = await Customer.findById(id)
                if( !customerExist) return next(errorHandler(401,'customer not found'))
         await Customer.findByIdAndDelete({_id:id})
        res.status(200).json({
            message:"customer deleted Success"
        })
    } catch (error) {
        next(error)
    }
}

export default {
    createCustomer,
    changePlan,
    deleteCustomer,
    getAllCustomer
}