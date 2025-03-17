import mongoose from '../common/db.connect.js'


const userSchema = new mongoose.Schema({
    userName:{type:String,required:true,unique:true},
    mobile:{type:String,required:true,unique:true},
    email:{type:String,required:true,unique:true},
    password:{type:String,required:true},
    role:{type:String,default:"staff"},
    approved:{type:Boolean,default:false}


},{
    timestamps:true,
    versionKey:false
})

const User = mongoose.model('user',userSchema)


export default User