import mongoose from "../common/db.connect.js";

const customerSchema = new mongoose.Schema({
    name: {type:String,required:true, unique: true},
    mobile:{type:String,required:true},
    planId: {type:mongoose.Schema.Types.ObjectId,ref:'plan'},
    address:{type:String,required:true},
    advanceAmount: { type: Number, default: 0 }, // Initial advance amount
    remainingBalance: { type: Number, default: 0 }, // Tracks unpaid or overpaid amount
    createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'user'},
    transactions: [
        {
          date: { type: Date, default:() => new Date() },
          type: { type: String, enum: ['due', 'payment','advance','remainbalance'], required: true },
          amount: { type: Number, required: true },
          collectedBy:{type:mongoose.Schema.Types.ObjectId,ref:'user'}
        }
      ]

})

const Customer = mongoose.model("customer",customerSchema)

export default Customer