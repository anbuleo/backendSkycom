import Customer from "../models/customerModel.js"
import Plan from "../models/planModel.js"
import { errorHandler } from "../uitils/errorHandler.js"

import XLSX from "xlsx"



const createCustomer = async(req,res,next)=>{
    try {
        let {name,mobile,address,planId,advanceAmount,remainingBalance} = req.body
        let {id} = req.user
        let isMobile = await Customer.find({mobile})
        if(isMobile.length >0 ) return next(errorHandler(401,'mobile Number already registered'))

        let newCustomer = new Customer({name,mobile,address,advanceAmount,planId,createdBy:id,remainingBalance})
       await newCustomer.save()
       
       res.status(201).json({
        message:'Customer added Success',
        newCustomer
       })

    } catch (error) {
        next(error)
    }
}
const bulkCreateCustomers = async (req, res, next) => {
    try {
      if (!req.file) return next(errorHandler(400, "Please upload an Excel file"));
  
      // Read Excel file
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const customersData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const plans = await Plan.find();
      const planMap = {}; // Create a lookup object
  
      // Fill lookup object with plan names mapped to their IDs
      plans.forEach(plan => {
        planMap[plan.name.toLowerCase()] = plan._id; // Store in lowercase for case-insensitive matching
      });
  
      // Extract and format customer data
      const customers = customersData.map(row => {
        const planName = row["Package Name"] ? row["Package Name"].toLowerCase().trim() : "";
        return {
          name: row["Username"],
          mobile: String(row["Mobile"]).trim(), // Ensure mobile is a string
          address: row["Installation Address"],
          planId: planMap[planName] || null, // Replace plan name with ID, or set to null if not found
          advanceAmount: row["Advance Amount"] || 0,
          remainingBalance: row["Remaining Balance"] || 0,
          createdBy: req.user.id,
        };
      });
      const validCustomers = customers.filter(c => c.planId !== null);
      const invalidCustomers = customers.filter(c => c.planId === null);
      // Find existing customers by mobile number
      // Find existing customers by mobile number
      const existingMobiles = await Customer.find({ mobile: { $in: validCustomers.map(c => c.mobile) } });
      const existingNumbers = new Set(existingMobiles.map(c => c.mobile));
  
      // Separate new and duplicate customers
      const newCustomers = validCustomers.filter(c => !existingNumbers.has(c.mobile));
      const duplicateCustomers = validCustomers.filter(c => existingNumbers.has(c.mobile));
  
      // Insert only new customers
      let insertedCustomers = [];
      if (newCustomers.length > 0) {
        insertedCustomers = await Customer.insertMany(newCustomers);
      }
  
      res.status(201).json({
        message: `${insertedCustomers.length} customers added successfully`,
        inserted: insertedCustomers.length,
        duplicates: duplicateCustomers.length,
        invalidPlans: invalidCustomers.length,
        invalidCustomers, // List of customers with invalid plan names
        duplicateCustomers, // List of duplicate entries
      });
    } catch (error) {
      next(error);
    }
  };

const getAllCustomer = async(req,res,next)=>{
    try {
        let customer = await Customer.find()
        res.status(200).json({
            message:"All customer",
            customer

        })
    } catch (error) {
        next(error)
    }
}

const changePlan = async(req,res,next)=>{
    try {
        let id = req.params.id
        let {planId} = req.body
        let isPlan = await Plan.findById(planId)
        if(!isPlan ) return next(errorHandler(401,"plan Does not exist"))

        let isCustomer = await Customer.findByIdAndUpdate(id,{planId},{new:true})

        if(!isCustomer) return next(errorHandler(401,'customer Not found'))
        
            res.status(200).json({
                message:"plan changed Success"
            })
        
    } catch (error) {
        next(error)
    }
}

const deleteCustomer = async(req,res,next)=>{
    try {
        let id = req.params.id
         let customerExist = await Customer.findById(id)
                if( !customerExist) return next(errorHandler(401,'customer not found'))
         await Customer.findByIdAndDelete({_id:id})
        res.status(200).json({
            message:"customer deleted Success"
        })
    } catch (error) {
        next(error)
    }
}

export default {
    createCustomer,
    changePlan,
    deleteCustomer,
    getAllCustomer,
    bulkCreateCustomers
}