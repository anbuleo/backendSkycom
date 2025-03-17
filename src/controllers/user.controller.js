import User from "../models/userModel.js";
import bcryptjs from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { errorHandler } from "../uitils/errorHandler.js"

let Salt = process.env.SALT

const signUp = async(req,res,next)=>{
    try {
        let {userName,email,password,mobile} = req.body;

        const userExist = await User.find({userName})

        if(userExist.length>0) return next(errorHandler(400,'user name already Exist'))

            let checkuserEmail = await User.find({email})
            if(checkuserEmail.length > 0) return next(errorHandler(400,'Email Already exist'))

            const hashedPassword = bcryptjs.hashSync(password,Number(Salt)) 
            let newUser = new User({userName,email,mobile,password:hashedPassword})

            await newUser.save()

            // if(newUser){
            //     const token = jwt.sign({id:newUser._id},process.env.JWT_SECRET)
            //     const {password:pass,...rest}= newUser._doc
            // }
            res.status(201).json({message:'user created success'})

        

        
    } catch (error) {
        console.log(error)
        next(error)
    }

}


const signin = async(req,res,next)=>{
    const {email,password} = req.body;

    try {
        let user  = await User.findOne({email});
        //console.log(user)
        if(!user) return next(errorHandler(404,'User Not Found'))
        const validPassword = bcryptjs.compareSync(password,user.password)
        if(!validPassword) return next(errorHandler(401,'Wrong credentials'))
        const token=jwt.sign({id : user._id},process.env.JWT_SECRET,{
            expiresIn:process.env.JWT_EXPIRE
        })
        const { password: pass, ...rest} = user._doc
        res.status(200).json({token,rest})

        
    } catch (error) {
        next(error)
    }
}

const getAlluser = async(req,res,next)=>{
    try {
        let user = await User.find()
        res.status(200).json({
            message:"user get Success",
            user
        })
    } catch (error) {
        next(error)
    }
}
const adduser = async(req,res,next)=>{
    try {
        let id= req.params.id
        
        let userId = req.user.id
        const isAdmin = await User.findById(userId)
        if(isAdmin.role !== 'admin')return next(errorHandler(400,'Admin only add user'))
            
            await User.findByIdAndUpdate(id,{approved:true},{new:true})
            res.status(200).json({
                message:'user Added success'
            })
    } catch (error) {
        next(error)
    }
}

export default {
    signUp,signin,getAlluser,adduser
}