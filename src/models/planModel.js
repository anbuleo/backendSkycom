import mongoose from '../common/db.connect.js'


const planSchema = new mongoose.Schema({
    name:{
        type:String,
        required:true
    },
    amount :{
        type:Number,
        required:true
    }
})


const Plan = mongoose.model('plan',planSchema)

export default Plan