import express from 'express'
import env from 'dotenv'
import cors from 'cors'
import bodyParser from 'body-parser'
import Router from './src/routes/index.js'
import cron from "node-cron";
import {generateMonthlyCollections} from "./src/controllers/collection.controller.js"

env.config()


const app = express()
app.use(express.json())
app.use(bodyParser.json())

let urlFront = [process.env.FrontUri]

const cordOptions = {
    origin:urlFront,
    methods : ['GET','POST','PUT','DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}

app.use(cors(cordOptions))


let PORT = process.env.PORT;

// "0 0 1 * *"
cron.schedule("0 0 1 * *", async () => { // Runs at midnight on the 1st of every month
    console.log("Generating monthly collections...");
    await generateMonthlyCollections();
});

app.use('/api',Router)

app.listen(PORT,()=>console.log(`App Listening Port ${PORT}`))

app.use((err,req,res,next)=>{
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server Error';
    return res.status(statusCode).json({
        success : false,
        statusCode,
        message
    })
})






