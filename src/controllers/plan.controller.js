import Plan from "../models/planModel.js"
import User from "../models/userModel.js"
import { errorHandler } from "../uitils/errorHandler.js"



const createPlan = async(req,res,next)=>{
        try {
            let {id}= req.user
            let {name,amount} = req.body
            let isAdmin = await User.findById(id)
            if(isAdmin.role !='admin') return next(errorHandler(401,'Admin only create a plan'))
            
                let isPlan = await Plan.find({name})
                if(isPlan.length >0 ) return next(errorHandler(401,'Plan Already exist'))

                
                let newPlan = new Plan({name,amount})

                await newPlan.save()

                res.status(201).json({
                    message:"Plan created success"
                })

                
            
        } catch (error) {
            next(error)
        }
}   


const deletePlan = async(req,res,next)=>{
    try {
        let id = req.params.id
        let planExist = await Plan.findById(id)
        if( !planExist) return next(errorHandler(401,'Plan not found'))

        let isPlan = await Plan.findByIdAndDelete({_id:id})
        res.status(200).json({
            message:'Plan deleted success'
        })
    } catch (error) {
        next(error)
    }
}

const editPlan = async(req,res,next)=>{
    try {
        let id = req.params.id
        let planExist = await Plan.findById(id)
        let updatePlan = await Plan.findByIdAndUpdate(id,req.body,{new:true})
       if(!updatePlan|| !planExist) return next(errorHandler(401,'Plan not found'))

        res.status(200).json({
            message:"Plan edited Success"
        })
    } catch (error) {
        next(error)
    }
}
const getAllPlan = async(req,res,next)=>{
    try {
        let plan = await Plan.find()
        if(!plan.length)return next(errorHandler(400,'No plan found'))

            res.status(200).json({
                plan,
                message:'plan gets success'
            })
    } catch (error) {
        next(error)
    }
}


export default {
    createPlan,
    deletePlan,
    editPlan,
    getAllPlan
}