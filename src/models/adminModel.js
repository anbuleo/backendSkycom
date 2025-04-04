import mongoose from "../common/db.connect.js";


const adminSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    collectionAmount:{type:Number,required:true},
    collectionDate:{type:Date,required:true},
    status:{type:String,enum: ["Pending", "Recieved"], default: "Pending"},
    expenseId:{type:mongoose.Schema.Types.ObjectId,ref:'expense',default:null},
    recievedAmount:{type:Number,required:true},
   
},
{
    timestamps:true,
    versionKey:false
})

const Admin = mongoose.model('admin',adminSchema)

export default Admin