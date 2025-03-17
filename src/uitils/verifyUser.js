import jwt from 'jsonwebtoken';
import { errorHandler } from './errorHandler.js';


export const verifyToken = (req,res,next) => {
    // let tokens = req.get('cookie').split("=")[1] //another way of parser the cookie in req
    
    // const token = req.cookies.access_token; // after installed npm package npm i cookie-parser
    const token =req.headers.authorization.split(" ")[1]
    // let a = req.cookies
    // console.log(token)


    
    if(!token) return next(errorHandler(401, 'Unauthorised'))

    let decode = jwt.decode(token)
    
    let currentTime  = Math.round((+new Date())/1000)
    if(currentTime > decode.exp) return next(errorHandler(400,'Session Expried login'))
   
    jwt.verify(token, process.env.JWT_SECRET,(err,user)=>{
       
        // console.log(currentTime,decode.exp)
        if(err ) return next(errorHandler(403,'Forbidden'))
        req.user = user
    
        next()
    })
}