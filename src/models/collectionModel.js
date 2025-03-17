import mongoose from "../common/db.connect.js"


const collectionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "customer", required: true },
    amountDue: { type: Number, required: true }, // The monthly charge
    amountPaid: { type: Number, default: 0 }, // Payment made
    dueDate: { type: Date, default: Date.now },
    month: { type: Number, required: true }, // 1 for Jan, 2 for Feb, etc.
    year: { type: Number, required: true },
    status: { type: String, enum: ["Pending", "Paid", "Overdue"], default: "Pending" },
    paymentMode: { type: String, enum: ["cash", "online"], default: "cash" },
    transactionId: {type:String,default:null}

},{
    timestamps:true,
    versionKey:false
})



const Collection = mongoose.model('collection',collectionSchema)

export default Collection