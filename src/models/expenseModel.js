import mongoose from '../common/db.connect.js'


const expenseSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    amount:{type:Number, required:true},
    remarks:{type:String,required:true},
    status:{type:String,enum:["claimed","unclaimed"],default:"unclaimed"},
    date: {  type: Date, default:() => new Date() }
    
})


const Expense = mongoose.model('expense',expenseSchema)

export default Expense