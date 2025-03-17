import mongoose from "../common/db.connect.js";

const customerSchema = new mongoose.Schema({
    name: {type:String,required:true},
    mobile:{type:String,required:true, unique: true},
    planId: {type:mongoose.Schema.Types.ObjectId,ref:'plan'},
    address:{type:String,required:true},
    advanceAmount: { type: Number, default: 0 }, // Initial advance amount
    remainingBalance: { type: Number, default: 0 }, // Tracks unpaid or overpaid amount
    createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'user'}

})

const Customer = mongoose.model("customer",customerSchema)

export default Customer